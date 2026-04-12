/**
 * Pipeline Orchestrator — Composes all pipeline components into a single
 * end-to-end workflow.
 *
 * This is the "main" of the pipeline. It coordinates:
 * 1. Brief parsing + validation
 * 2. Asset resolution
 * 3. Prompt construction
 * 4. Image generation (parallel)
 * 5. Text overlay compositing
 * 6. Output organization
 *
 * The orchestrator manages pipeline state transitions and collects errors
 * for partial failure handling (see docs/architecture/orchestration.md).
 *
 * WHY inject `client: OpenAI` + `storage: StorageProvider`:
 * - The orchestrator is a pure composition of domain functions.
 * - Dependencies are injected by the API route via lib/api/services.ts.
 * - This makes the orchestrator testable without real API keys or S3.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 */

import type OpenAI from "openai";
import type {
  CampaignBrief,
  PipelineResult,
  StorageProvider,
} from "./types";

// TODO [ADS-004]: Orchestrate the full pipeline

export async function runPipeline(
  _brief: CampaignBrief,
  _storage: StorageProvider,
  _client: OpenAI
): Promise<PipelineResult> {
  throw new Error("Not implemented — ADS-004");
}
