/**
 * Retry utility with exponential backoff for DALL-E API calls.
 *
 * WHY custom retry instead of OpenAI SDK's built-in:
 * - We need per-error-code control: retry 429/500, never retry 400 (content policy)
 * - We need to surface typed PipelineErrors, not generic SDK errors
 * - We need AbortSignal integration for pipeline timeout budgets
 * - The SDK's maxRetries is all-or-nothing — no error classification
 *
 * See docs/architecture/orchestration.md for the full retry policy.
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  shouldRetry: () => true,
};

/**
 * Execute a function with exponential backoff retry.
 *
 * Delay schedule: baseDelayMs * 2^(attempt-1)
 *   Attempt 1 failure → wait 1s
 *   Attempt 2 failure → wait 2s
 *   Attempt 3 failure → throw
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, shouldRetry } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  // Unreachable — the loop always throws on the last attempt
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an OpenAI API error is retryable.
 *
 * Retryable (transient):
 *   429 — Rate limited. Exponential backoff will resolve.
 *   500, 502, 503 — Server error. May resolve on retry.
 *   Network errors — Timeout, DNS, connection reset.
 *
 * NOT retryable (permanent):
 *   400 — Content policy violation. The prompt was rejected.
 *         Retrying the same prompt will get the same result.
 *   401 — Invalid API key. No amount of retrying fixes auth.
 *   404 — Model not found. Configuration error.
 */
export function isRetryableOpenAIError(error: unknown): boolean {
  if (error instanceof Error) {
    // OpenAI SDK errors have a `status` property
    const status = (error as { status?: number }).status;

    if (status !== undefined) {
      // 429, 5xx are retryable
      if (status === 429 || status >= 500) return true;
      // 400, 401, 403, 404 are not
      return false;
    }

    // Network errors (timeout, DNS, connection reset) are retryable
    if (
      error.name === "AbortError" ||
      error.name === "TypeError" ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ETIMEDOUT")
    ) {
      return true;
    }
  }

  // Unknown error shape — don't retry (fail fast, surface to caller)
  return false;
}
