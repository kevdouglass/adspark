/**
 * Pipeline Orchestrator — Composes all pipeline components into a single
 * end-to-end workflow.
 *
 * This is the "main" of the pipeline. It coordinates:
 *   1. Brief parsing + validation (already done at API boundary, defensive re-check)
 *   2. Asset resolution (check existing assets, mark for generation)
 *   3. Generation task building (product × ratio combinations)
 *   4. Image generation via DALL-E 3 (parallel, partial failure isolated)
 *   5. Text overlay compositing (parallel per successful image)
 *   6. Output organization (save creatives, thumbnails, manifest)
 *
 * The orchestrator manages pipeline state transitions and aggregates errors
 * from every stage into a single PipelineResult.
 *
 * WHY inject client + storage + ctx:
 * Pure composition over classes. Dependencies flow in from the API route
 * via lib/api/services.ts. Makes the orchestrator trivially testable:
 * mock the OpenAI client and a StorageProvider, call runPipeline, assert.
 *
 * PARTIAL FAILURE GUARANTEE:
 * The pipeline NEVER returns an empty result when some creatives succeed.
 * If 5/6 images generate but 1 fails, we return the 5 + error for the 1.
 * Only catastrophic failures (manifest write) throw OrganizationError.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 * See docs/architecture/orchestration.md (state machine, retry, partial failure)
 */

import type OpenAI from "openai";
import type {
  CampaignBrief,
  Creative,
  GeneratedImage,
  PipelineError,
  PipelineResult,
  PipelineStage,
  StorageProvider,
} from "./types";
import type { RequestContext } from "@/lib/api/services";
import { parseBrief } from "./briefParser";
import { resolveAssets } from "./assetResolver";
import { buildGenerationTasks } from "./promptBuilder";
import { generateImages } from "./imageGenerator";
import { overlayText, ImageProcessingError } from "./textOverlay";
import { organizeOutput } from "./outputOrganizer";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optional callback fired when the pipeline transitions between stages.
 * Used by the frontend PipelineProgress component (ADS-008) to render
 * real-time status. For MVP, the callback is optional — the pipeline
 * works identically with or without it.
 */
export type StageChangeCallback = (stage: PipelineStage) => void;

export interface RunPipelineOptions {
  onStageChange?: StageChangeCallback;
}

/**
 * Run the full creative generation pipeline end-to-end.
 *
 * Accepts a validated CampaignBrief, an OpenAI client, a StorageProvider,
 * and a RequestContext for timing + correlation. Returns a PipelineResult
 * with all successful creatives and aggregated errors from every stage.
 */
export async function runPipeline(
  brief: CampaignBrief,
  storage: StorageProvider,
  client: OpenAI,
  ctx: RequestContext,
  options: RunPipelineOptions = {}
): Promise<PipelineResult> {
  const { onStageChange } = options;
  const allErrors: PipelineError[] = [];

  // ------------------------------------------------------------------------
  // Stage 1: Validating
  // ------------------------------------------------------------------------
  emitStage("validating", onStageChange);
  // API route has already validated, but defensive re-check catches
  // any direct callers (tests, scripts) that bypass the boundary.
  const parseResult = parseBrief(brief);
  if (!parseResult.success) {
    return {
      campaignId: brief.campaign.id,
      creatives: [],
      totalTimeMs: elapsedMs(ctx),
      totalImages: 0,
      errors: parseResult.errors.map((message) => ({
        product: "_brief",
        aspectRatio: "1:1",
        stage: "validating",
        message,
        retryable: false,
      })),
    };
  }
  const validatedBrief = parseResult.brief;

  // ------------------------------------------------------------------------
  // Stage 2: Resolving assets
  // ------------------------------------------------------------------------
  emitStage("resolving", onStageChange);
  const assetResolutions = await resolveAssets(validatedBrief.products, storage);

  // Products with existing assets skip DALL-E generation.
  // Build a map: product.slug → existing Buffer (for reused assets)
  const reusedAssetBuffers = new Map<string, Buffer>();
  for (const resolution of assetResolutions) {
    if (resolution.hasExistingAsset && resolution.existingAssetBuffer) {
      reusedAssetBuffers.set(
        resolution.product.slug,
        resolution.existingAssetBuffer
      );
    }
  }

  // ------------------------------------------------------------------------
  // Stage 3: Building generation tasks
  // ------------------------------------------------------------------------
  // buildGenerationTasks produces one task per product × aspect ratio.
  // For products with a reused asset, we still build the task (for the prompt
  // metadata) but skip the DALL-E call in the next stage.
  const allTasks = buildGenerationTasks(
    validatedBrief.campaign,
    validatedBrief.products,
    validatedBrief.aspectRatios
  );

  // Partition tasks: which need DALL-E generation, which can reuse
  const tasksNeedingGeneration = allTasks.filter(
    (task) => !reusedAssetBuffers.has(task.product.slug)
  );
  const tasksWithReusedAssets = allTasks.filter((task) =>
    reusedAssetBuffers.has(task.product.slug)
  );

  // ------------------------------------------------------------------------
  // Stage 4: Generating images via DALL-E 3
  // ------------------------------------------------------------------------
  emitStage("generating", onStageChange);
  const generationResult = await generateImages(tasksNeedingGeneration, client);
  allErrors.push(...generationResult.errors);

  // Build GeneratedImage[] for reused assets (0ms generation time)
  const reusedImages: GeneratedImage[] = tasksWithReusedAssets.map((task) => ({
    task,
    imageBuffer: reusedAssetBuffers.get(task.product.slug)!,
    generationTimeMs: 0, // Reused, not generated
  }));

  const allGeneratedImages: GeneratedImage[] = [
    ...generationResult.images,
    ...reusedImages,
  ];

  // Timeout budget check: if we've used more than 40s on generation,
  // skip compositing retries and return what we have.
  if (elapsedMs(ctx) > 40_000) {
    allErrors.push({
      product: "_pipeline",
      aspectRatio: "1:1",
      stage: "generating",
      message: `Pipeline timeout budget exceeded (${elapsedMs(ctx)}ms > 40000ms). Returning partial results.`,
      retryable: true,
    });
    return buildPartialResult(validatedBrief, [], allErrors, ctx);
  }

  // ------------------------------------------------------------------------
  // Stage 5: Compositing text overlays
  // ------------------------------------------------------------------------
  emitStage("compositing", onStageChange);
  const composited = await compositeCreatives(
    allGeneratedImages,
    validatedBrief.campaign.message
  );
  allErrors.push(...composited.errors);

  if (composited.creatives.length === 0) {
    // Nothing succeeded — return partial result without organizing
    return buildPartialResult(validatedBrief, [], allErrors, ctx);
  }

  // ------------------------------------------------------------------------
  // Stage 6: Organizing output
  // ------------------------------------------------------------------------
  emitStage("organizing", onStageChange);
  const organized = await organizeOutput(
    validatedBrief.campaign.id,
    validatedBrief,
    composited.creatives,
    storage,
    ctx
  );
  allErrors.push(...organized.errors);

  // Note: organized.systemErrors are not creative-specific, so we don't
  // push them to creative errors. They'd surface through the manifest.
  // For simplicity in the POC, we include them in the response errors.
  organized.systemErrors.forEach((systemError) => {
    allErrors.push({
      product: "_system",
      aspectRatio: "1:1",
      stage: "organizing",
      message: systemError.message,
      retryable: systemError.retryable,
    });
  });

  // ------------------------------------------------------------------------
  // Stage 7: Complete
  // ------------------------------------------------------------------------
  emitStage("complete", onStageChange);

  return {
    campaignId: validatedBrief.campaign.id,
    creatives: organized.creatives,
    totalTimeMs: elapsedMs(ctx),
    totalImages: organized.creatives.length,
    errors: allErrors,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Composite text overlays onto all generated images in parallel.
 *
 * For each GeneratedImage, calls overlayText() to draw the campaign message,
 * then constructs a Creative object with timing metadata. Uses Promise.allSettled
 * so one compositing failure doesn't kill the batch.
 */
async function compositeCreatives(
  images: GeneratedImage[],
  campaignMessage: string
): Promise<{ creatives: Creative[]; errors: PipelineError[] }> {
  const results = await Promise.allSettled(
    images.map(async (image): Promise<Creative> => {
      const compositingStart = performance.now();
      const compositedBuffer = await overlayText(
        image.imageBuffer,
        campaignMessage,
        image.task.dimensions
      );
      const compositingTimeMs = Math.round(
        performance.now() - compositingStart
      );

      return {
        product: image.task.product,
        aspectRatio: image.task.aspectRatio,
        dimensions: image.task.dimensions,
        prompt: image.task.prompt,
        imageBuffer: compositedBuffer,
        generationTimeMs: image.generationTimeMs,
        compositingTimeMs,
      };
    })
  );

  const creatives: Creative[] = [];
  const errors: PipelineError[] = [];

  results.forEach((result, index) => {
    const image = images[index];
    if (result.status === "fulfilled") {
      creatives.push(result.value);
    } else {
      const isProcessingError = result.reason instanceof ImageProcessingError;
      errors.push({
        product: image.task.product.slug,
        aspectRatio: image.task.aspectRatio,
        stage: "compositing",
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown compositing error",
        retryable: !isProcessingError, // Processing errors are typically permanent
      });
    }
  });

  return { creatives, errors };
}

/**
 * Build a partial PipelineResult when the pipeline short-circuits
 * (timeout budget exceeded, nothing composited successfully).
 */
function buildPartialResult(
  brief: CampaignBrief,
  creatives: PipelineResult["creatives"],
  errors: PipelineError[],
  ctx: RequestContext
): PipelineResult {
  return {
    campaignId: brief.campaign.id,
    creatives,
    totalTimeMs: elapsedMs(ctx),
    totalImages: creatives.length,
    errors,
  };
}

/** Emit a stage transition if a callback is provided. */
function emitStage(
  stage: PipelineStage,
  callback?: StageChangeCallback
): void {
  if (callback) {
    callback(stage);
  }
}

/** Compute elapsed time from request start. */
function elapsedMs(ctx: RequestContext): number {
  return Math.round(performance.now() - ctx.startedAtPerfMs);
}
