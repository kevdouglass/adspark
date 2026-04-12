/**
 * Retry utility with exponential backoff for DALL-E API calls.
 *
 * WHY custom retry instead of OpenAI SDK's built-in:
 * - We need per-error-code control: retry 429/500, never retry 400 (content policy)
 * - We need to surface typed PipelineErrors, not generic SDK errors
 * - The SDK's maxRetries is all-or-nothing — no error classification
 *
 * See docs/architecture/orchestration.md for the full retry policy.
 */

import OpenAI from "openai";

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
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
 *   Attempt 1 failure → wait 1s → retry
 *   Attempt 2 failure → wait 2s → retry
 *   Attempt 3 failure → throw (no delay taken on final attempt)
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
