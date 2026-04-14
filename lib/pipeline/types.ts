/**
 * Domain types for the AdSpark creative generation pipeline.
 *
 * These types define the data contracts between pipeline components.
 * They have ZERO framework dependencies — no Next.js, no React, no AWS SDK.
 * This is the domain layer: pure data structures that model the problem space.
 */

// ---------------------------------------------------------------------------
// Input Types — What the user provides
// ---------------------------------------------------------------------------

export interface CampaignBrief {
  campaign: Campaign;
  products: Product[];
  aspectRatios: AspectRatio[];
  outputFormats: OutputFormats;
}

export const VALID_SEASONS = ["summer", "winter", "spring", "fall"] as const;
export type Season = (typeof VALID_SEASONS)[number];

export interface Campaign {
  id: string;
  name: string;
  message: string;
  targetRegion: string;
  targetAudience: string;
  tone: string;
  season: Season;
}

export interface Product {
  name: string;
  slug: string;
  description: string;
  category: string;
  keyFeatures: string[];
  color: string;
  existingAsset: string | null;
}

export type AspectRatio = "1:1" | "9:16" | "16:9";

export interface OutputFormats {
  creative: "png";
  thumbnail: "webp";
}

// ---------------------------------------------------------------------------
// Pipeline Types — Internal state as creatives flow through the pipeline
// ---------------------------------------------------------------------------

/** A single image generation task for one product × one aspect ratio */
export interface GenerationTask {
  product: Product;
  aspectRatio: AspectRatio;
  prompt: string;
  dimensions: ImageDimensions;
}

export interface ImageDimensions {
  width: number;
  height: number;
  /**
   * DALL-E 3 API size parameter. This is an infrastructure detail that lives
   * in the domain type as a pragmatic trade-off for a POC — in production,
   * this would move to the image generator layer and be derived from width/height.
   * See docs/adr/ADR-001-nextjs-full-stack-typescript.md for context.
   */
  dalleSize: "1024x1024" | "1024x1792" | "1792x1024";
}

/**
 * How an image buffer reached the compositing stage.
 *
 * - `generated` — produced by a fresh DALL-E 3 call (`generationTimeMs > 0`)
 * - `reused`    — loaded from the asset library (seed dirs or local output)
 *                 via `assetResolver.resolveOne` (`generationTimeMs === 0`)
 *
 * Propagated from `GeneratedImage` → `Creative` → `CreativeOutput` → manifest
 * → API response → UI badge. The assignment's "reuse input assets when
 * available" requirement is invisible without this — see
 * `examples/campaigns/coastal-sun-protection/` for the canonical demo.
 *
 * --- shape decisions ---
 *
 * This is modeled as an `as const` object plus a derived union type rather
 * than a TypeScript `enum`. Three reasons:
 *
 *   1. **Wire format stays a plain string.** `JSON.stringify` produces
 *      `"reused"` / `"generated"` directly — no enum reverse-lookup object,
 *      no numeric serialization, no surprises in the manifest. A reviewer
 *      grepping `manifest.json` sees the literal word they expect.
 *
 *   2. **Zero-cost at read sites.** Existing code that writes
 *      `sourceType: "generated"` or compares `creative.sourceType === "reused"`
 *      still type-checks unchanged, because the union `CreativeSourceType`
 *      is `"reused" | "generated"`. Callers can use either the constants
 *      (`CreativeSource.Reused`) or the literals (`"reused"`) interchangeably.
 *
 *   3. **Runtime iterability.** `CREATIVE_SOURCE_VALUES` gives us
 *      `["reused", "generated"]` for UI filter rendering, test assertions,
 *      Zod schemas (`z.enum(CREATIVE_SOURCE_VALUES)`), and any future
 *      consumer that needs to enumerate every variant at runtime.
 *
 * The two *write* sites (where a literal is produced, not consumed) are
 * `lib/pipeline/imageGenerator.ts` and `lib/pipeline/pipeline.ts` — both
 * use the `CreativeSource.*` constants below. Every read site continues
 * to use plain string comparisons.
 */
export const CreativeSource = {
  Reused: "reused",
  Generated: "generated",
} as const;

/**
 * Derived union type — stays `"reused" | "generated"` so existing
 * literal-based code keeps working. TypeScript narrows correctly against
 * both the constants and plain string literals.
 */
export type CreativeSourceType =
  (typeof CreativeSource)[keyof typeof CreativeSource];

/**
 * Runtime iterator — every valid `CreativeSourceType` value in a stable
 * insertion order. Typed as `readonly [CreativeSourceType, ...]` so it
 * can be passed directly to `z.enum()` without a cast.
 */
export const CREATIVE_SOURCE_VALUES = Object.values(
  CreativeSource
) as readonly CreativeSourceType[];

/** Result of DALL-E 3 image generation (before text overlay) */
export interface GeneratedImage {
  task: GenerationTask;
  imageBuffer: Buffer;
  generationTimeMs: number;
  /** See CreativeSourceType — distinguishes a DALL-E call from an asset reuse. */
  sourceType: CreativeSourceType;
}

/** Final composited creative (after text overlay) */
/**
 * A final composited creative — the output of text overlay, before storage.
 * The thumbnail is generated by the output organizer (ADS-003), not here —
 * the creative only carries the full-resolution buffer at this stage.
 */
export interface Creative {
  product: Product;
  aspectRatio: AspectRatio;
  dimensions: ImageDimensions;
  prompt: string;
  imageBuffer: Buffer;
  generationTimeMs: number;
  compositingTimeMs: number;
  /** Carried from the upstream GeneratedImage — see CreativeSourceType. */
  sourceType: CreativeSourceType;
}

// ---------------------------------------------------------------------------
// Output Types — What the pipeline returns
// ---------------------------------------------------------------------------

export interface PipelineResult {
  campaignId: string;
  creatives: CreativeOutput[];
  totalTimeMs: number;
  totalImages: number;
  errors: PipelineError[];
}

export interface CreativeOutput {
  productName: string;
  productSlug: string;
  aspectRatio: AspectRatio;
  dimensions: string;
  /** Storage key/path — always present regardless of storage mode */
  creativePath: string;
  /** Storage key/path — always present regardless of storage mode */
  thumbnailPath: string;
  /** Pre-signed URL for S3 mode. Undefined in local mode — use creativePath instead. */
  creativeUrl?: string;
  /** Pre-signed URL for S3 mode. Undefined in local mode — use thumbnailPath instead. */
  thumbnailUrl?: string;
  prompt: string;
  generationTimeMs: number;
  compositingTimeMs: number;
  /** Carried from the upstream Creative — see CreativeSourceType. */
  sourceType: CreativeSourceType;
}

/**
 * Typed classification of what caused a pipeline error.
 *
 * Used by the API layer to map errors to HTTP status codes via a
 * compile-time exhaustive switch (see `lib/api/errors.ts`). Adding a
 * new variant forces every consumer to handle it or TypeScript errors.
 *
 * See docs/adr/ADR-003-typed-error-cause-discriminants.md for rationale.
 */
export type PipelineErrorCause =
  /** DALL-E 400 — prompt rejected for safety/policy reasons, non-retryable */
  | "content_policy"
  /** 429 from any upstream (OpenAI, S3) — retryable with backoff */
  | "rate_limited"
  /** AbortSignal timeout fired (client-level) — non-retryable at orchestrator level */
  | "upstream_timeout"
  /** 5xx from any upstream — retryable */
  | "upstream_error"
  /** Brief validation failed (Zod errors) — non-retryable */
  | "invalid_input"
  /** Storage provider failure (S3 PutObject, filesystem write) — retryable */
  | "storage_error"
  /** Sharp / @napi-rs/canvas failure during compositing — non-retryable */
  | "processing_error"
  /** Unclassified error — fallback only */
  | "unknown";

/**
 * Unified error shape for all pipeline stages.
 *
 * `product` and `aspectRatio` are optional because some errors are
 * system-level (e.g., brief.json save failure, timeout budget exceeded,
 * validation failure) and not tied to a specific product × ratio pair.
 *
 * `cause` is required for compile-time exhaustiveness in the API error
 * mapping table. Use `"unknown"` only when classification isn't possible.
 *
 * Consumers MUST handle both variants:
 * - Creative errors: product + aspectRatio both defined
 * - System errors: product and/or aspectRatio undefined
 */
export interface PipelineError {
  product?: string;
  aspectRatio?: AspectRatio;
  stage: PipelineStage;
  cause: PipelineErrorCause;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// State Types — Pipeline progress tracking
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "validating"
  | "resolving"
  | "generating"
  | "compositing"
  | "organizing"
  | "complete"
  | "failed";

export interface PipelineProgress {
  stage: PipelineStage;
  totalTasks: number;
  completedTasks: number;
  currentTask?: string;
  errors: PipelineError[];
}

// ---------------------------------------------------------------------------
// Storage Interface — Implemented by S3Storage and LocalStorage
// ---------------------------------------------------------------------------

export interface StorageProvider {
  save(key: string, data: Buffer, contentType: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
  load(key: string): Promise<Buffer | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps aspect ratios to pixel dimensions and DALL-E 3 size parameters */
export const ASPECT_RATIO_CONFIG: Record<AspectRatio, ImageDimensions> = {
  "1:1": { width: 1080, height: 1080, dalleSize: "1024x1024" },
  "9:16": { width: 1080, height: 1920, dalleSize: "1024x1792" },
  "16:9": { width: 1200, height: 675, dalleSize: "1792x1024" },
};

export const DEFAULT_ASPECT_RATIOS: AspectRatio[] = ["1:1", "9:16", "16:9"];

/**
 * Path-safe folder names for each aspect ratio.
 * Colons (1:1) are invalid in Windows paths and problematic in S3 keys.
 * Use these for file/folder naming, not the display-format ratios.
 */
export const ASPECT_RATIO_FOLDER: Record<AspectRatio, string> = {
  "1:1": "1x1",
  "9:16": "9x16",
  "16:9": "16x9",
};
