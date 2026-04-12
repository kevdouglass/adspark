/**
 * Backend Service Factory — creates pipeline dependencies per request.
 *
 * WHY per-request, not singleton:
 * Vercel serverless functions have no shared state across invocations.
 * A module-level singleton would appear to work locally but break
 * unpredictably on serverless (stale connections, memory leaks across
 * cold starts). Creating fresh instances per request is the correct pattern.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 */

import OpenAI from "openai";
import { createStorage } from "@/lib/storage";
import type { StorageProvider } from "@/lib/pipeline/types";

export interface RequestContext {
  requestId: string;
  /**
   * High-resolution timestamp from `performance.now()` at request start.
   * Monotonic, relative to process start — NOT a wall-clock epoch time.
   * Use only for intra-request duration math: `performance.now() - startedAtPerfMs`.
   * Do NOT serialize as a timestamp or send to external systems expecting epoch ms.
   */
  startedAtPerfMs: number;
}

/**
 * Create a new OpenAI client configured for DALL-E 3 pipeline use.
 *
 * - timeout: 30s per request (hung connection protection)
 * - maxRetries: 0 (we handle retries ourselves via withRetry for
 *   finer control over which errors are retryable)
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required. " +
        "Set it in .env.local for local dev or Vercel env vars for production."
    );
  }
  return new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
}

export function getStorage(): StorageProvider {
  return createStorage();
}

export function createRequestContext(): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    startedAtPerfMs: performance.now(),
  };
}

/**
 * Validate all required environment variables at route entry.
 * Fails fast with a descriptive error listing every missing variable
 * at once, rather than surfacing them one at a time during execution.
 *
 * Throws a `MissingConfigurationError` that API routes catch and map
 * to HTTP 500 with `MISSING_CONFIGURATION` code.
 */
export function validateRequiredEnv(): void {
  const missing: string[] = [];

  if (!process.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }

  // S3 vars are only required when STORAGE_MODE=s3
  if (process.env.STORAGE_MODE === "s3" && !process.env.S3_BUCKET) {
    missing.push("S3_BUCKET (required when STORAGE_MODE=s3)");
  }

  if (missing.length > 0) {
    throw new MissingConfigurationError(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Thrown when required env vars are missing.
 * API routes catch this and map to 500 INTERNAL_ERROR / MISSING_CONFIGURATION.
 */
export class MissingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigurationError";
  }
}
