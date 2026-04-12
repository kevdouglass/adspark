/**
 * Output Organizer — Saves composited creatives + thumbnails to storage
 * with organized folder structure and manifest.json for traceability.
 *
 * Folder structure (per docs/architecture/image-processing.md):
 *   {campaignId}/
 *   ├── brief.json              ← input copy for reproducibility
 *   ├── manifest.json           ← aggregate: requestId, paths, prompts, timing
 *   ├── {productSlug}/
 *   │   ├── 1x1/
 *   │   │   ├── creative.png    (1080×1080, PNG)
 *   │   │   └── thumbnail.webp  (400px wide, WebP 80%)
 *   │   ├── 9x16/ ...
 *   │   └── 16x9/ ...
 *
 * WHY write creatives before the manifest:
 * The manifest must never lie about state. If we write manifest.json first
 * and then a creative save fails, the manifest references a non-existent file.
 * Correct order: creatives + thumbnails first (parallel), manifest + brief last.
 *
 * WHY Promise.allSettled over Promise.all:
 * Matches the partial failure model from ADS-001 and ADS-002. If 11 of 12
 * saves succeed and 1 fails, we return 11 successes + 1 error rather than
 * throwing away the entire batch.
 *
 * See docs/architecture/image-processing.md for the complete spec.
 */

import sharp from "sharp";
import pLimit from "p-limit";
import type {
  AspectRatio,
  CampaignBrief,
  Creative,
  CreativeOutput,
  PipelineError,
  StorageProvider,
} from "./types";
import { ASPECT_RATIO_FOLDER } from "./types";
import type { RequestContext } from "@/lib/api/services";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Thumbnail width in pixels. Height preserves aspect ratio. */
const THUMBNAIL_WIDTH = 400;

/** WebP quality for thumbnails — balance of file size and visual quality */
const THUMBNAIL_QUALITY = 80;

/**
 * Concurrency cap for Sharp thumbnail generation.
 * Prevents memory spikes when processing large batches — each in-flight
 * Sharp operation pins its source buffer in RAM. At 5 concurrent × ~8MB
 * per 1080×1920 PNG = ~40MB peak, comfortable within Vercel's 1024MB limit.
 */
const THUMBNAIL_CONCURRENCY = 5;

const CONTENT_TYPE_PNG = "image/png";
const CONTENT_TYPE_WEBP = "image/webp";
const CONTENT_TYPE_JSON = "application/json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrganizeOutputResult {
  creatives: CreativeOutput[];
  manifestPath: string;
  briefPath: string;
  /** Per-creative failures (product × aspectRatio tied) */
  errors: PipelineError[];
  /** System-level failures not tied to a specific creative */
  systemErrors: Array<{ stage: string; message: string; retryable: boolean }>;
}

interface StorageSaveTask {
  key: string;
  data: Buffer;
  contentType: string;
  creative: Creative;
  kind: "creative" | "thumbnail";
}

interface SaveOutcome {
  task: StorageSaveTask;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// ADS-003a: Thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a WebP thumbnail from a PNG creative buffer.
 * Resizes to THUMBNAIL_WIDTH while preserving aspect ratio.
 *
 * Uses `fit: 'inside'` to explicitly preserve aspect ratio without cropping —
 * the output height is computed automatically from the source aspect ratio.
 */
async function generateThumbnail(creativeBuffer: Buffer): Promise<Buffer> {
  return sharp(creativeBuffer)
    .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// ADS-003b: Storage key construction
// ---------------------------------------------------------------------------

/**
 * Build a path-safe storage key for a creative or thumbnail.
 *
 * Uses ASPECT_RATIO_FOLDER mapping to convert "1:1" → "1x1" (colons are
 * invalid in Windows paths and problematic in S3 keys).
 */
function buildStorageKey(
  campaignId: string,
  productSlug: string,
  aspectRatio: AspectRatio,
  filename: string
): string {
  return `${campaignId}/${productSlug}/${ASPECT_RATIO_FOLDER[aspectRatio]}/${filename}`;
}

// ---------------------------------------------------------------------------
// ADS-003c: Manifest construction
// ---------------------------------------------------------------------------

/**
 * Manifest schema — matches docs/architecture/image-processing.md spec.
 * Fields: ratio (display format), dimensions (pixels), model, textOverlay,
 * path, thumbnailPath, prompt, generationTimeMs, compositingTimeMs.
 */
interface ManifestCreative {
  ratio: AspectRatio;
  dimensions: string;
  path: string;
  thumbnailPath: string;
  prompt: string;
  model: string;
  textOverlay: string;
  generationTimeMs: number;
  compositingTimeMs: number;
}

interface ManifestProduct {
  name: string;
  slug: string;
  creatives: ManifestCreative[];
}

interface Manifest {
  requestId: string;
  campaignId: string;
  generatedAt: string;
  totalTimeMs: number;
  totalImages: number;
  products: ManifestProduct[];
  /** Errors tied to specific creative failures (product × ratio) */
  creativeErrors: PipelineError[];
  /** System-level errors not tied to a specific creative (brief.json save, etc.) */
  systemErrors: Array<{ stage: string; message: string; retryable: boolean }>;
}

const DALLE_MODEL_NAME = "dall-e-3";

/**
 * Build a manifest JSON from successful creative outputs.
 * Groups creatives by product for client-friendly rendering.
 * Matches the spec schema in docs/architecture/image-processing.md.
 */
function buildManifest(
  campaignId: string,
  requestContext: RequestContext,
  creativeOutputs: CreativeOutput[],
  campaignMessage: string,
  creativeErrors: PipelineError[],
  systemErrors: Array<{ stage: string; message: string; retryable: boolean }>
): Manifest {
  const productMap = new Map<string, ManifestProduct>();

  for (const output of creativeOutputs) {
    if (!productMap.has(output.productSlug)) {
      productMap.set(output.productSlug, {
        name: output.productName,
        slug: output.productSlug,
        creatives: [],
      });
    }

    productMap.get(output.productSlug)!.creatives.push({
      ratio: output.aspectRatio,
      dimensions: output.dimensions,
      path: output.creativePath,
      thumbnailPath: output.thumbnailPath,
      prompt: output.prompt,
      model: DALLE_MODEL_NAME,
      textOverlay: campaignMessage,
      generationTimeMs: output.generationTimeMs,
      compositingTimeMs: output.compositingTimeMs,
    });
  }

  const totalTimeMs = Math.round(
    performance.now() - requestContext.startedAtPerfMs
  );

  return {
    requestId: requestContext.requestId,
    campaignId,
    generatedAt: new Date().toISOString(),
    totalTimeMs,
    totalImages: creativeOutputs.length,
    products: Array.from(productMap.values()),
    creativeErrors,
    systemErrors,
  };
}

// ---------------------------------------------------------------------------
// ADS-003d: Main organizeOutput function
// ---------------------------------------------------------------------------

/**
 * Organize composited creatives into storage with manifest and reproducibility copy.
 *
 * Steps:
 *   1. Generate thumbnails in parallel (Sharp resize → WebP)
 *   2. Build storage save tasks for creatives + thumbnails
 *   3. Save all files via Promise.allSettled (partial failure isolation)
 *   4. Build CreativeOutput[] from successful saves, PipelineError[] from failures
 *   5. Build and save manifest.json LAST (reflects final state)
 *   6. Save brief.json copy for reproducibility
 *
 * Returns OrganizeOutputResult with creatives, manifest path, and collected errors.
 * Throws OrganizationError only on catastrophic failures (manifest write failure).
 */
export async function organizeOutput(
  campaignId: string,
  brief: CampaignBrief,
  creatives: Creative[],
  storage: StorageProvider,
  requestContext: RequestContext
): Promise<OrganizeOutputResult> {
  const errors: PipelineError[] = [];

  // Step 1: Generate thumbnails with capped concurrency
  // p-limit caps parallel Sharp operations to THUMBNAIL_CONCURRENCY to
  // prevent memory spikes when processing large batches of creatives.
  const thumbnailLimit = pLimit(THUMBNAIL_CONCURRENCY);
  const thumbnailResults = await Promise.allSettled(
    creatives.map((creative) =>
      thumbnailLimit(async () => ({
        creative,
        thumbnailBuffer: await generateThumbnail(creative.imageBuffer),
      }))
    )
  );

  // Step 2: Build save tasks from successful thumbnail generations
  const saveTasks: StorageSaveTask[] = [];

  thumbnailResults.forEach((result, index) => {
    const creative = creatives[index];
    if (result.status === "fulfilled") {
      const { thumbnailBuffer } = result.value;
      saveTasks.push({
        key: buildStorageKey(
          campaignId,
          creative.product.slug,
          creative.aspectRatio,
          "creative.png"
        ),
        data: creative.imageBuffer,
        contentType: CONTENT_TYPE_PNG,
        creative,
        kind: "creative",
      });
      saveTasks.push({
        key: buildStorageKey(
          campaignId,
          creative.product.slug,
          creative.aspectRatio,
          "thumbnail.webp"
        ),
        data: thumbnailBuffer,
        contentType: CONTENT_TYPE_WEBP,
        creative,
        kind: "thumbnail",
      });
    } else {
      errors.push({
        product: creative.product.slug,
        aspectRatio: creative.aspectRatio,
        stage: "organizing",
        cause: "processing_error",
        message: `Thumbnail generation failed: ${result.reason instanceof Error ? result.reason.message : "unknown"}`,
        retryable: false,
      });
    }
  });

  // Step 3: Save all files in parallel with partial failure isolation
  const saveResults = await Promise.allSettled(
    saveTasks.map(async (task): Promise<SaveOutcome> => {
      try {
        await storage.save(task.key, task.data, task.contentType);
        return { task, success: true };
      } catch (e) {
        return {
          task,
          success: false,
          error: e instanceof Error ? e.message : "unknown storage error",
        };
      }
    })
  );

  // Step 4: Collect CreativeOutput[] from successful saves
  // A creative is "complete" only if BOTH its creative.png AND thumbnail.webp saved
  const saveStatus = new Map<
    string,
    { creativeSaved: boolean; thumbnailSaved: boolean }
  >();

  saveResults.forEach((result, index) => {
    const task = saveTasks[index];
    const statusKey = `${task.creative.product.slug}:${task.creative.aspectRatio}`;
    const existing = saveStatus.get(statusKey) ?? {
      creativeSaved: false,
      thumbnailSaved: false,
    };

    const outcome = result.status === "fulfilled" ? result.value : null;
    const succeeded = outcome?.success === true;

    if (task.kind === "creative") {
      existing.creativeSaved = succeeded;
    } else {
      existing.thumbnailSaved = succeeded;
    }
    saveStatus.set(statusKey, existing);

    if (!succeeded) {
      // The save task always resolves fulfilled (inner try/catch returns
      // SaveOutcome). A rejected promise here would indicate a bug in the
      // task wrapper itself — surface as "internal error".
      const errorMessage = outcome?.error ?? "internal save wrapper failure";
      errors.push({
        product: task.creative.product.slug,
        aspectRatio: task.creative.aspectRatio,
        stage: "organizing",
        cause: "storage_error",
        message: `Failed to save ${task.kind} (${task.key}): ${errorMessage}`,
        retryable: true,
      });
    }
  });

  // Detect half-save state: flag orphaned files so the orchestrator knows
  // the creative is not recoverable and the storage has leftover state.
  // A creative must have BOTH creative.png AND thumbnail.webp saved to be usable.
  for (const creative of creatives) {
    const statusKey = `${creative.product.slug}:${creative.aspectRatio}`;
    const status = saveStatus.get(statusKey);
    if (!status) continue;

    const creativeSaved = status.creativeSaved;
    const thumbnailSaved = status.thumbnailSaved;

    if (creativeSaved && !thumbnailSaved) {
      errors.push({
        product: creative.product.slug,
        aspectRatio: creative.aspectRatio,
        stage: "organizing",
        cause: "storage_error",
        message: `Orphaned creative.png saved but thumbnail.webp failed — creative marked unusable`,
        retryable: true,
      });
    } else if (!creativeSaved && thumbnailSaved) {
      errors.push({
        product: creative.product.slug,
        aspectRatio: creative.aspectRatio,
        stage: "organizing",
        cause: "storage_error",
        message: `Orphaned thumbnail.webp saved but creative.png failed — creative marked unusable`,
        retryable: true,
      });
    }
  }

  // Build CreativeOutput[] for successful pairs — parallelize getUrl() calls
  // with Promise.all (originally called serially in a for-loop, now batched).
  const successfulPairs = creatives.filter((creative) => {
    const status = saveStatus.get(
      `${creative.product.slug}:${creative.aspectRatio}`
    );
    return status?.creativeSaved === true && status?.thumbnailSaved === true;
  });

  const creativeOutputs: CreativeOutput[] = await Promise.all(
    successfulPairs.map(async (creative): Promise<CreativeOutput> => {
      const creativePath = buildStorageKey(
        campaignId,
        creative.product.slug,
        creative.aspectRatio,
        "creative.png"
      );
      const thumbnailPath = buildStorageKey(
        campaignId,
        creative.product.slug,
        creative.aspectRatio,
        "thumbnail.webp"
      );

      const [creativeUrl, thumbnailUrl] = await Promise.all([
        storage.getUrl(creativePath),
        storage.getUrl(thumbnailPath),
      ]);

      return {
        productName: creative.product.name,
        productSlug: creative.product.slug,
        aspectRatio: creative.aspectRatio,
        dimensions: `${creative.dimensions.width}x${creative.dimensions.height}`,
        creativePath,
        thumbnailPath,
        creativeUrl,
        thumbnailUrl,
        prompt: creative.prompt,
        generationTimeMs: creative.generationTimeMs,
        compositingTimeMs: creative.compositingTimeMs,
      };
    })
  );

  // Step 5: Save brief.json FIRST (before manifest)
  // Rule: manifest writes LAST so it never lies about state. Brief.json is
  // non-critical — its failure is collected into systemErrors and included
  // in the manifest we write next. This keeps the on-disk manifest truthful.
  const systemErrors: Array<{
    stage: string;
    message: string;
    retryable: boolean;
  }> = [];

  const briefPath = `${campaignId}/brief.json`;
  const briefBuffer = Buffer.from(JSON.stringify(brief, null, 2), "utf-8");

  try {
    await storage.save(briefPath, briefBuffer, CONTENT_TYPE_JSON);
  } catch (e) {
    systemErrors.push({
      stage: "organizing",
      message: `Failed to save brief.json copy: ${e instanceof Error ? e.message : "unknown"}`,
      retryable: true,
    });
  }

  // Step 6: Build and save manifest.json LAST (reflects final state)
  // creativeErrors are per-creative failures; systemErrors includes brief.json
  // failure (if any) since it was attempted before this step.
  const manifest = buildManifest(
    campaignId,
    requestContext,
    creativeOutputs,
    brief.campaign.message,
    errors,
    systemErrors
  );
  const manifestPath = `${campaignId}/manifest.json`;
  const manifestBuffer = Buffer.from(
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  try {
    await storage.save(manifestPath, manifestBuffer, CONTENT_TYPE_JSON);
  } catch (e) {
    throw new OrganizationError(
      `Failed to write manifest.json for campaign ${campaignId}`,
      { cause: e }
    );
  }

  return {
    creatives: creativeOutputs,
    manifestPath,
    briefPath,
    errors,
    systemErrors,
  };
}

/**
 * Typed error for output organization failures.
 * Thrown only for catastrophic failures (manifest write). Partial save
 * failures are reported via the `errors` array in OrganizeOutputResult.
 */
export class OrganizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OrganizationError";
  }
}
