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
 */

import type {
  CampaignBrief,
  PipelineResult,
  StorageProvider,
} from "./types";

// Placeholder — implementation in Checkpoint 1

export async function runPipeline(
  _brief: CampaignBrief,
  _storage: StorageProvider,
  _apiKey: string
): Promise<PipelineResult> {
  // TODO: Orchestrate the full pipeline
  throw new Error("Not implemented — Checkpoint 1");
}
