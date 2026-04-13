/**
 * Retry utility with exponential backoff for DALL-E API calls.
 *
 * WHY custom retry instead of OpenAI SDK's built-in:
 * - We need per-error-code control: retry 429/500, never retry 400 (content policy)
 * - We need to surface typed PipelineErrors, not generic SDK errors
 * - The SDK's maxRetries is all-or-nothing — no error classification
 * - We need an AbortSignal seam so a pipeline-level budget timeout can
 *   cancel an in-flight retry chain (the container has no Vercel 300s
 *   function kill — the pipeline is now the outer boundary).
 *
 * See docs/architecture/orchestration.md for the full retry policy.
 */

import OpenAI from "openai";

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
  /**
   * Optional abort signal. When it fires, any pending backoff sleep
   * is cancelled immediately and the loop throws an AbortError —
   * stopping wasted wall time on retries that will outlive the caller.
   * The `fn()` itself is responsible for honoring the signal separately
   * (OpenAI SDK accepts `{ signal }` on per-request options).
   */
  signal?: AbortSignal;
  /**
   * Optional per-attempt hook. Called once per attempt AFTER the
   * attempt resolves (success or failure) but BEFORE the backoff
   * sleep. Used by `imageGenerator.ts` to emit `dalle.retry.attempt`
   * events into the structured log stream.
   */
  onAttempt?: (info: {
    attempt: number;
    error?: unknown;
    willRetry: boolean;
    nextDelayMs: number;
  }) => void;
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, "signal" | "onAttempt">> &
  Pick<RetryConfig, "signal" | "onAttempt"> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  // Default: fail fast. Callers must explicitly opt into retry by providing
  // a shouldRetry function (e.g., isRetryableOpenAIError). This prevents
  // accidentally retrying non-retryable errors like 400 content policy.
  shouldRetry: () => false,
};

/**
 * Execute a function with exponential backoff retry.
 *
 * Delay schedule: baseDelayMs * 2^(attempt-1)
 *   Attempt 1 failure → wait baseDelayMs → retry
 *   Attempt 2 failure → wait 2×baseDelayMs → retry
 *   Attempt 3 failure → throw (no delay taken on final attempt)
 *
 * Abort semantics: if `config.signal` fires at any point, the next
 * backoff sleep is cancelled and the loop throws `AbortError`. An
 * attempt already in flight is NOT interrupted by withRetry itself —
 * that's the `fn()` author's responsibility (they forward the signal
 * to their own fetch/SDK call).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, shouldRetry, signal, onAttempt } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw abortError();
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      const retryable = shouldRetry(error) && !signal?.aborted;
      const willRetry = !isLastAttempt && retryable;
      const nextDelayMs = willRetry
        ? baseDelayMs * Math.pow(2, attempt - 1)
        : 0;

      onAttempt?.({ attempt, error, willRetry, nextDelayMs });

      if (!willRetry) {
        throw error;
      }

      await sleepWithAbort(nextDelayMs, signal);
    }
  }

  // Unreachable — the loop always throws on the last attempt
  throw lastError;
}

/**
 * Sleep for `ms` milliseconds, or reject early with an AbortError
 * if the signal fires during the wait. Centralizes the timer cleanup
 * so a fired signal doesn't leak a pending setTimeout into the event
 * loop (which would keep the Node process alive in the container).
 */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Construct an AbortError in a way that satisfies both
 * `error.name === "AbortError"` checks (used by `isRetryableOpenAIError`)
 * and `DOMException`-based instanceof checks used by the Web Streams
 * and Fetch standards. Node 20+ has `DOMException` globally.
 */
function abortError(): Error {
  return new DOMException("Aborted by pipeline budget", "AbortError");
}

/**
 * Determine if an OpenAI API error is retryable.
 *
 * Retryable (transient):
 *   429 — Rate limited. Exponential backoff will resolve.
 *   500, 502, 503 — Server error. May resolve on retry.
 *   Network errors — DNS failure, connection reset (NOT timeout — see below).
 *
 * NOT retryable (permanent or budget-unsafe):
 *   400 — Content policy violation. Same prompt = same rejection.
 *   401 — Invalid API key. Auth is broken.
 *   404 — Model not found. Configuration error.
 *   AbortError — Client timeout (30s). Retrying a 30s timeout 3 times = 90s,
 *                which exceeds the Vercel 60s function limit. Surface immediately
 *                and let the orchestrator decide whether to abort or continue
 *                with partial results.
 */
export function isRetryableOpenAIError(error: unknown): boolean {
  // Use OpenAI SDK's typed error class for proper narrowing
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === 429 || status >= 500) return true;
    return false;
  }

  if (error instanceof Error) {
    // AbortError = client timeout. Do NOT retry — 3 × 30s = 90s blows the budget.
    if (error.name === "AbortError") return false;

    // Network errors (DNS, connection reset) are retryable
    if (
      error.name === "TypeError" ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ETIMEDOUT")
    ) {
      return true;
    }
  }

  // Unknown error shape — don't retry (fail fast)
  return false;
}
