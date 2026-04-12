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
  errors: PipelineError[];
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
 */
async function generateThumbnail(creativeBuffer: Buffer): Promise<Buffer> {
  return sharp(creativeBuffer)
    .resize(THUMBNAIL_WIDTH)
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

interface ManifestCreative {
  aspectRatio: AspectRatio;
  dimensions: string;
  creativePath: string;
  thumbnailPath: string;
  prompt: string;
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
  totalCreatives: number;
  products: ManifestProduct[];
  errors: PipelineError[];
}

/**
 * Build a manifest JSON from successful creative outputs.
 * Groups creatives by product for client-friendly rendering.
 */
function buildManifest(
  campaignId: string,
  requestContext: RequestContext,
  creativeOutputs: CreativeOutput[],
  errors: PipelineError[]
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
      aspectRatio: output.aspectRatio,
      dimensions: output.dimensions,
      creativePath: output.creativePath,
      thumbnailPath: output.thumbnailPath,
      prompt: output.prompt,
      generationTimeMs: output.generationTimeMs,
      compositingTimeMs: output.compositingTimeMs,
    });
  }

  return {
    requestId: requestContext.requestId,
    campaignId,
    generatedAt: new Date().toISOString(),
    totalCreatives: creativeOutputs.length,
    products: Array.from(productMap.values()),
    errors,
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

  // Step 1: Generate thumbnails in parallel
  const thumbnailResults = await Promise.allSettled(
    creatives.map(async (creative) => ({
      creative,
      thumbnailBuffer: await generateThumbnail(creative.imageBuffer),
    }))
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
      const errorMessage =
        outcome?.error ??
        (result.status === "rejected"
          ? result.reason instanceof Error
            ? result.reason.message
            : "unknown"
          : "unknown");
      errors.push({
        product: task.creative.product.slug,
        aspectRatio: task.creative.aspectRatio,
        stage: "organizing",
        message: `Failed to save ${task.kind} (${task.key}): ${errorMessage}`,
        retryable: true,
      });
    }
  });

  const creativeOutputs: CreativeOutput[] = [];
  for (const creative of creatives) {
    const statusKey = `${creative.product.slug}:${creative.aspectRatio}`;
    const status = saveStatus.get(statusKey);
    if (!status?.creativeSaved || !status?.thumbnailSaved) {
      continue;
    }

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

    creativeOutputs.push({
      productName: creative.product.name,
      productSlug: creative.product.slug,
      aspectRatio: creative.aspectRatio,
      dimensions: `${creative.dimensions.width}x${creative.dimensions.height}`,
      creativePath,
      thumbnailPath,
      creativeUrl: await storage.getUrl(creativePath),
      thumbnailUrl: await storage.getUrl(thumbnailPath),
      prompt: creative.prompt,
      generationTimeMs: creative.generationTimeMs,
      compositingTimeMs: creative.compositingTimeMs,
    });
  }

  // Step 5: Build and save manifest.json LAST (reflects final state)
  // Errors from thumbnail generation and storage saves are included in the manifest.
  const manifest = buildManifest(
    campaignId,
    requestContext,
    creativeOutputs,
    errors
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

  // Step 6: Save brief.json copy for reproducibility
  // Non-critical: failure is logged in errors[] but doesn't throw.
  const briefPath = `${campaignId}/brief.json`;
  const briefBuffer = Buffer.from(JSON.stringify(brief, null, 2), "utf-8");

  try {
    await storage.save(briefPath, briefBuffer, CONTENT_TYPE_JSON);
  } catch (e) {
    errors.push({
      product: "_manifest",
      aspectRatio: "1:1",
      stage: "organizing",
      message: `Failed to save brief.json copy: ${e instanceof Error ? e.message : "unknown"}`,
      retryable: true,
    });
  }

  return {
    creatives: creativeOutputs,
    manifestPath,
    briefPath,
    errors,
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
