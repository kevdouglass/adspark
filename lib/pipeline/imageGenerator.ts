/**
 * Image Generator — DALL-E 3 API integration with parallel execution and retry.
 *
 * Generates images for each product × aspect ratio combination. Uses Promise.all()
 * with p-limit for controlled concurrency (respects OpenAI rate limits).
 *
 * WHY inject `client: OpenAI` instead of `apiKey: string`:
 * - Dependency Inversion: the pipeline depends on an instantiated client,
 *   not a primitive. The API route creates the client; the pipeline uses it.
 * - Testability: tests inject a mock client, not a fake API key.
 * - Configuration: timeout, maxRetries, baseURL are set once at client creation
 *   (in lib/api/services.ts), not scattered across pipeline functions.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 * See docs/architecture/orchestration.md for retry policy and concurrency details.
 */

import type OpenAI from "openai";
import type { GeneratedImage, GenerationTask } from "./types";

// TODO [ADS-001]: Implement DALL-E 3 API calls with p-limit concurrency and retry

export async function generateImages(
  _tasks: GenerationTask[],
  _client: OpenAI
): Promise<GeneratedImage[]> {
  throw new Error("Not implemented — ADS-001");
}
