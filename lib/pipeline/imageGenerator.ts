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
      baseDelayMs: 1000,
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
 * Uses p-limit(5) to respect OpenAI Tier 1 rate limits (5 img/min).
 * Uses Promise.allSettled so one failure doesn't kill the entire batch.
 *
 * Returns both successful images AND typed errors for failed ones —
 * the caller (pipeline orchestrator) decides how to surface partial failures.
 */
export async function generateImages(
  tasks: GenerationTask[],
  client: OpenAI,
  concurrency: number = 5
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
