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
import { generateImages, DALLE_CONCURRENCY_LIMIT } from "./imageGenerator";
import { overlayText, ImageProcessingError } from "./textOverlay";
import { organizeOutput } from "./outputOrganizer";
import { PIPELINE_BUDGET_MS } from "@/lib/api/timeouts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optional callback fired when the pipeline transitions between stages.
 * Used by the frontend PipelineProgress component (ADS-008) to render
 * real-time status. For MVP, the callback is optional — the pipeline
 * works identically with or without it.
 *
 * Callbacks may be sync or async — the pipeline awaits the returned value,
 * so async callbacks are supported (e.g., for SSE/WebSocket emitters).
 */
export type StageChangeCallback = (
  stage: PipelineStage
) => void | Promise<void>;

export interface RunPipelineOptions {
  onStageChange?: StageChangeCallback;
}

// ---------------------------------------------------------------------------
// Internal constants — sentinel values for system-level errors
// ---------------------------------------------------------------------------

/**
 * Total pipeline timeout budget before we bail out with partial results (ms).
 *
 * Imported from `lib/api/timeouts.ts` which owns all three staggered
 * timeouts (pipeline < client < Vercel). A prior version of this fix
 * set the pipeline budget equal to the client's 55s timeout, creating
 * a race where the client's AbortSignal could fire at the same moment
 * the server prepared its graceful partial-result response. The
 * staggered 50/55/60 layout documented in `timeouts.ts` guarantees the
 * server wins the race every time.
 *
 * Realistic wall-clock math for a 6-image demo (2 products × 3 ratios)
 * at DALL-E 3 Tier 1 p75 latency, assuming `DALLE_CONCURRENCY_LIMIT = 5`:
 *
 *   - Wave 1 (5 images in parallel, p75): ~22s
 *   - Wave 2 (1 image alone, p75): ~22s
 *   - Compositing (parallel canvas): ~3s
 *   - Organizing (storage + manifest): ~3s
 *   - TOTAL realistic p75: ~50s
 *
 * KNOWN LIMITATIONS (documented for honesty, not hand-waved):
 *
 * 1. The retry layer (`lib/pipeline/retry.ts`) can add up to ~1.5s to
 *    a single image on a 429 rate-limit with `baseDelayMs=500`. A
 *    pathological run where wave 1 hits multiple rate limits can still
 *    trip this check and return partial results. Tier 2+ accounts see
 *    ~12s p75 latency and rarely hit the ceiling.
 *
 * 2. The budget check fires AFTER generation (line below). Compositing
 *    (~3s) and organizing (~3s) still have to run. The budget does NOT
 *    reserve space for them — it assumes the 5s stagger to the client
 *    timeout is enough headroom for the downstream stages to finish.
 *    If a future change makes compositing or organizing materially
 *    more expensive, recompute the budget.
 *
 * See `lib/api/timeouts.ts` for the full stagger story.
 */
const PIPELINE_TIMEOUT_BUDGET_MS = PIPELINE_BUDGET_MS;

// `DALLE_CONCURRENCY_LIMIT` is imported solely so the budget math above
// is grep-linked to its dependency. Any change to the concurrency value
// will show up as a diff hunk in this file, forcing a re-review of the
// budget math. `void` silences the unused-variable lint without runtime cost.
void DALLE_CONCURRENCY_LIMIT;

/**
 * Sentinel product slug for validation errors not tied to a specific product.
 * (PipelineError.product is optional — we use this when setting it explicitly.)
 */
const VALIDATION_ERROR_STAGE = "validating" as const;

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
  await emitStage("validating", onStageChange);
  // API route has already validated, but defensive re-check catches
  // any direct callers (tests, scripts) that bypass the boundary.
  const parseResult = parseBrief(brief);
  if (!parseResult.success) {
    // Validation errors are system-level (not tied to a specific product/ratio)
    // so product and aspectRatio are omitted.
    return {
      campaignId: brief.campaign.id,
      creatives: [],
      totalTimeMs: elapsedMs(ctx),
      totalImages: 0,
      errors: parseResult.errors.map(
        (message): PipelineError => ({
          stage: VALIDATION_ERROR_STAGE,
          cause: "invalid_input",
          message,
          retryable: false,
        })
      ),
    };
  }
  const validatedBrief = parseResult.brief;

  // ------------------------------------------------------------------------
  // Stage 2: Resolving assets
  // ------------------------------------------------------------------------
  await emitStage("resolving", onStageChange);
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
  // Stage 3: Building generation tasks (defensive — wrap in try/catch)
  // ------------------------------------------------------------------------
  // buildGenerationTasks is pure and should not throw under validated input,
  // but we catch defensively to uphold the "never throw except catastrophic"
  // contract. A throw here surfaces as a validation error, not a crash.
  let allTasks;
  try {
    allTasks = buildGenerationTasks(
      validatedBrief.campaign,
      validatedBrief.products,
      validatedBrief.aspectRatios
    );
  } catch (e) {
    allErrors.push({
      stage: "validating",
      cause: "invalid_input",
      message: `Failed to build generation tasks: ${e instanceof Error ? e.message : "unknown"}`,
      retryable: false,
    });
    return buildPartialResult(validatedBrief, [], allErrors, ctx);
  }

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
  await emitStage("generating", onStageChange);
  const generationResult = await generateImages(tasksNeedingGeneration, client);
  allErrors.push(...generationResult.errors);

  // Build GeneratedImage[] for reused assets (0ms generation time).
  // Typed guard: if the buffer is missing, this is a programmer error
  // (tasksWithReusedAssets was filtered from the same map), so we throw
  // a typed error rather than silently producing a corrupt GeneratedImage.
  const reusedImages: GeneratedImage[] = tasksWithReusedAssets.map((task) => {
    const buffer = reusedAssetBuffers.get(task.product.slug);
    if (!buffer) {
      throw new Error(
        `Internal invariant violation: reused buffer missing for product "${task.product.slug}" after filter`
      );
    }
    return {
      task,
      imageBuffer: buffer,
      generationTimeMs: 0, // Reused, not generated
    };
  });

  const allGeneratedImages: GeneratedImage[] = [
    ...generationResult.images,
    ...reusedImages,
  ];

  // Timeout budget warning — record an error for the audit trail when
  // generation exceeds the budget, but DO NOT short-circuit compositing.
  //
  // Prior behavior: when the budget tripped, the pipeline discarded every
  // successfully-generated image and returned zero creatives. The "partial
  // results" message was a lie — the user paid for the DALL-E calls but
  // received nothing. Even worse, compositing (~3s for 6 images in parallel)
  // and organizing (~3s) are cheap, so skipping them saved almost no time
  // while throwing away all of the expensive upstream work.
  //
  // New behavior: emit an upstream_timeout WARNING into the error list so
  // it surfaces in the response for observability, but continue running
  // compositing + organizing on whatever images did generate. The caller
  // (API route) then decides how to present this — currently, any non-zero
  // creatives count returns HTTP 200 with the errors embedded in the body.
  //
  // Production safety: the three-layer stagger (50s pipeline < 55s client
  // < 60s Vercel) still protects the outer request. If compositing + organize
  // take longer than the 5s stagger window, the client's AbortSignal fires
  // and the user sees a clean CLIENT_TIMEOUT error. The worst case is strictly
  // better than before — we never lose successfully-generated work.
  const elapsedAfterGeneration = elapsedMs(ctx);
  if (elapsedAfterGeneration > PIPELINE_TIMEOUT_BUDGET_MS) {
    allErrors.push({
      stage: "generating",
      cause: "upstream_timeout",
      message: `Pipeline timeout budget exceeded (${elapsedAfterGeneration}ms > ${PIPELINE_TIMEOUT_BUDGET_MS}ms). Continuing to composite and organize the ${allGeneratedImages.length} images that did generate.`,
      retryable: true,
    });
  }

  // ------------------------------------------------------------------------
  // Stage 5: Compositing text overlays
  // ------------------------------------------------------------------------
  await emitStage("compositing", onStageChange);
  const composited = await compositeCreatives(
    allGeneratedImages,
    validatedBrief.campaign.message
  );
  allErrors.push(...composited.errors);

  // ------------------------------------------------------------------------
  // Stage 6: Organizing output (ALWAYS runs, even with 0 creatives)
  // ------------------------------------------------------------------------
  // Rationale: manifest.json is the audit trail. Even if all creatives
  // failed compositing, we still write the manifest to record what happened.
  // This prevents silent loss of the error record.
  return await organizeAndReturn(
    validatedBrief,
    composited.creatives,
    allErrors,
    storage,
    ctx,
    onStageChange
  );
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
        cause: "processing_error",
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
 * Build a partial PipelineResult when the pipeline short-circuits at
 * validation or task-building time (before any storage writes happen).
 * Used ONLY for failures that occur before organizeOutput runs.
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

/**
 * Run the organizing stage and build the final PipelineResult.
 *
 * ALWAYS writes the manifest — even when creatives is empty — so we
 * never silently lose the audit trail on total pipeline failure.
 *
 * organizeOutput() throws OrganizationError only on catastrophic manifest
 * write failure. Any other storage error is collected into the returned
 * errors array. We fold organized.systemErrors into the pipeline's allErrors
 * via the shared PipelineError shape.
 */
async function organizeAndReturn(
  brief: CampaignBrief,
  composited: Creative[],
  allErrors: PipelineError[],
  storage: StorageProvider,
  ctx: RequestContext,
  onStageChange?: StageChangeCallback
): Promise<PipelineResult> {
  await emitStage("organizing", onStageChange);
  const organized = await organizeOutput(
    brief.campaign.id,
    brief,
    composited,
    storage,
    ctx
  );
  allErrors.push(...organized.errors);
  allErrors.push(...organized.systemErrors.map(toPipelineError));

  await emitStage("complete", onStageChange);

  return {
    campaignId: brief.campaign.id,
    creatives: organized.creatives,
    totalTimeMs: elapsedMs(ctx),
    totalImages: organized.creatives.length,
    errors: allErrors,
  };
}

/**
 * Convert an organizer system error into a PipelineError.
 * System errors omit product/aspectRatio because they aren't tied to
 * a specific creative — see PipelineError JSDoc for the contract.
 */
function toPipelineError(systemError: {
  stage: string;
  message: string;
  retryable: boolean;
}): PipelineError {
  return {
    stage: systemError.stage as PipelineError["stage"],
    cause: "storage_error",
    message: systemError.message,
    retryable: systemError.retryable,
  };
}

/**
 * Emit a stage transition if a callback is provided.
 *
 * Null-guards inside the helper (not at each call site) because the pipeline
 * has 7+ stage transitions — inlining the `if (callback)` check everywhere
 * would be noise. The helper keeps callers clean: `await emitStage("generating", onStageChange)`.
 *
 * Async: awaits the callback result so async emitters (SSE, WebSocket,
 * logging pipelines) complete before the pipeline advances to the next stage.
 * A sync callback returning void resolves immediately with no overhead.
 */
async function emitStage(
  stage: PipelineStage,
  callback?: StageChangeCallback
): Promise<void> {
  if (callback) {
    await callback(stage);
  }
}

/** Compute elapsed time from request start. */
function elapsedMs(ctx: RequestContext): number {
  return Math.round(performance.now() - ctx.startedAtPerfMs);
}
