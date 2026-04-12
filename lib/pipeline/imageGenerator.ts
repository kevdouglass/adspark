/**
 * Image Generator — DALL-E 3 API integration with parallel execution and retry.
 *
 * Generates images for each product × aspect ratio combination. Uses
 * Promise.allSettled with p-limit for controlled concurrency.
 *
 * WHY inject `client: OpenAI` instead of `apiKey: string`:
 * - Dependency Inversion: pipeline depends on an instantiated client,
 *   not a primitive. The API route creates the client; the pipeline uses it.
 * - Testability: tests inject a mock client, not a fake API key.
 * - Configuration: timeout, maxRetries, baseURL set once at creation.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 * See docs/architecture/orchestration.md (retry policy, concurrency)
 */

import OpenAI from "openai";
import pLimit from "p-limit";
import type {
  GeneratedImage,
  GenerationTask,
  PipelineError,
  PipelineErrorCause,
} from "./types";
import { withRetry, isRetryableOpenAIError } from "./retry";

/**
 * Maximum number of concurrent DALL-E 3 requests.
 *
 * OpenAI DALL-E 3 Tier 1 quota is ~5 images per minute. Running 5 in
 * parallel per batch means a 6-image brief splits into two waves of
 * 5+1, which is the calibration baseline for `PIPELINE_BUDGET_MS` in
 * `lib/api/timeouts.ts`. If you change this value, recompute that
 * budget — the pipeline.ts JSDoc references this constant explicitly
 * so a diff here forces re-review of the timing math.
 *
 * Tier 2+ accounts can raise this to 10+ for single-wave generation
 * of 6-image briefs, which cuts wall-clock roughly in half. For a POC
 * targeting Tier 1 quotas, 5 is the safe ceiling.
 */
export const DALLE_CONCURRENCY_LIMIT = 5;

/**
 * Retry base delay (ms). Exponential backoff: attempt 1 fail → wait
 * 12s, attempt 2 fail → wait 24s, attempt 3 → throw.
 *
 * **Why 12 seconds and not 500ms:** OpenAI DALL-E 3 Tier 1 returns 429
 * with a `Retry-After` header that is typically 12-60 seconds (one
 * rate-limit bucket refill). At the previous 500ms base, both retries
 * fired *inside* the rate-limit window, generated two more 429s, and
 * exhausted all retries in ~1.5s — making the retry logic effectively
 * cosmetic against real Tier 1 rate spikes. 12s clears the typical
 * Retry-After window on the first retry.
 *
 * Trade-off: a 429 followed by one retry now costs ~12s of pipeline
 * budget instead of ~0.5s. With `PIPELINE_BUDGET_MS = 50_000`, a
 * worst-case scenario is one image hitting two retries (~36s wall
 * time) inside the 50s budget — tight but survivable. Most demo runs
 * will not hit any retries and pay zero overhead.
 *
 * If you observe sustained 429 cascades on Tier 1, the right move is
 * to lower `DALLE_CONCURRENCY_LIMIT` from 5 to 3, not to lower this
 * delay — sleeping less just guarantees more 429s.
 */
export const DALLE_RETRY_BASE_DELAY_MS = 12_000;

/**
 * Classify an upstream error into a typed PipelineErrorCause.
 *
 * This is where classification happens — at the error-producing site,
 * where we have the most context about what went wrong. The API layer
 * then maps the cause to an HTTP status without any string matching.
 *
 * See docs/adr/ADR-003-typed-error-cause-discriminants.md for rationale.
 */
export function classifyOpenAIError(error: unknown): PipelineErrorCause {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 400) return "content_policy";
    if (error.status === 429) return "rate_limited";
    if (error.status >= 500) return "upstream_error";
    return "upstream_error"; // Other 4xx
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "upstream_timeout";
  }
  if (error instanceof ImageGenerationError) {
    // PNG validation failure, empty response — treat as processing error
    return "processing_error";
  }
  return "unknown";
}

// PNG magic bytes per spec: 0x89 0x50 0x4E 0x47
// We inline this check in generateImage() via direct byte comparison
// (see `hasValidPngHeader` below) instead of a module-level Buffer constant.
// This avoids per-module allocation and matches the test assertion style.

/**
 * Generate a single image via DALL-E 3.
 *
 * Uses b64_json response format to avoid URL expiry risk — the image
 * bytes arrive in the API response itself, no second HTTP call needed.
 * See ADR-002 for the full trade-off analysis.
 */
export async function generateImage(
  client: OpenAI,
  task: GenerationTask
): Promise<GeneratedImage> {
  const start = performance.now();

  const response = await withRetry(
    () =>
      client.images.generate({
        model: "dall-e-3",
        prompt: task.prompt,
        size: task.dimensions.dalleSize,
        quality: "standard",
        response_format: "b64_json",
        n: 1,
      }),
    {
      maxAttempts: 3,
      baseDelayMs: DALLE_RETRY_BASE_DELAY_MS,
      shouldRetry: isRetryableOpenAIError,
    }
  );

  // OpenAI SDK types `data` as optional (`data?: Array<Image>`), so the
  // outer `?.` is required by TypeScript strict mode — not a type lie.
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new ImageGenerationError(
      "DALL-E returned no image data",
      task.product.slug,
      task.aspectRatio
    );
  }

  const imageBuffer = Buffer.from(b64, "base64");

  // Validate the decoded buffer is actually a PNG via inline magic-byte check
  const hasValidPngHeader =
    imageBuffer.length >= 4 &&
    imageBuffer[0] === 0x89 &&
    imageBuffer[1] === 0x50 &&
    imageBuffer[2] === 0x4e &&
    imageBuffer[3] === 0x47;

  if (!hasValidPngHeader) {
    throw new ImageGenerationError(
      "DALL-E returned corrupt image data (invalid PNG header)",
      task.product.slug,
      task.aspectRatio
    );
  }

  const generationTimeMs = Math.round(performance.now() - start);

  return { task, imageBuffer, generationTimeMs };
}

/**
 * Generate images for all tasks in parallel with concurrency limiting.
 *
 * Uses `p-limit(DALLE_CONCURRENCY_LIMIT)` to respect OpenAI Tier 1
 * rate limits. Uses `Promise.allSettled` so one failure doesn't kill
 * the batch.
 *
 * Returns both successful images AND typed errors for failed ones —
 * the caller (pipeline orchestrator) decides how to surface partial failures.
 */
export async function generateImages(
  tasks: GenerationTask[],
  client: OpenAI,
  concurrency: number = DALLE_CONCURRENCY_LIMIT
): Promise<{ images: GeneratedImage[]; errors: PipelineError[] }> {
  const limit = pLimit(concurrency);

  const results = await Promise.allSettled(
    tasks.map((task) =>
      limit(() => generateImage(client, task))
    )
  );

  const images: GeneratedImage[] = [];
  const errors: PipelineError[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      images.push(result.value);
    } else {
      const task = tasks[index];
      const error = result.reason;
      const isRetryable =
        error instanceof Error && isRetryableOpenAIError(error);
      const cause = classifyOpenAIError(error);

      errors.push({
        product: task.product.slug,
        aspectRatio: task.aspectRatio,
        stage: "generating",
        cause,
        message:
          error instanceof Error
            ? error.message
            : "Unknown image generation error",
        retryable: isRetryable,
      });
    }
  });

  return { images, errors };
}

/**
 * Typed error for image generation failures.
 * Carries product and aspect ratio context for partial failure reporting.
 * Supports `cause` chaining to preserve the original OpenAI APIError
 * (status code, request ID) for downstream debugging.
 *
 * Exported so the pipeline orchestrator (ADS-004) and API route (ADS-005)
 * can use `instanceof` for typed catch blocks and error response mapping.
 */
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly productSlug: string,
    public readonly aspectRatio: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ImageGenerationError";
  }
}
