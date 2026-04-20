/**
 * Run summary — aggregate counts derived from a PipelineResult.
 *
 * The manifest (outputOrganizer) and the API response (mappers) both
 * need the same aggregate block: how many creatives, how many reused,
 * how many generated, how many failed. Deriving it in one place keeps
 * the two consumers in lockstep — if the counting rules ever change,
 * the change lives here.
 *
 * Pure function, no I/O, no framework dependencies. Lives in
 * `lib/pipeline/` so the organizer (framework-free) can import it
 * without pulling in anything from `lib/api/`.
 */

import type { CreativeOutput, PipelineError } from "./types";

/**
 * Run status classification.
 *
 * - `complete` — every requested creative succeeded, no errors at all.
 * - `partial`  — at least one creative succeeded AND at least one error
 *                occurred (per-creative or system-level). The pipeline
 *                returned usable output alongside a non-empty error list.
 * - `failed`   — zero creatives produced. The run is a total loss even
 *                if the manifest still got written (which it always does
 *                per the outputOrganizer contract).
 *
 * The reviewer's mental model maps cleanly: complete = green, partial =
 * amber, failed = red.
 */
export type RunStatus = "complete" | "partial" | "failed";

/**
 * Aggregated counts for a single pipeline run.
 *
 * This shape is intentionally flat — no nested objects — so it can be
 * JSON-serialized into the manifest and the API response without any
 * further projection. Every field is a primitive so it survives
 * `JSON.parse(JSON.stringify(x))` losslessly (see the logging test that
 * asserts JSON serializability of every emitted record).
 */
export interface RunSummary {
  /** Distinct products that produced at least one creative. */
  totalProducts: number;
  /** Total successful creatives across all products and ratios. */
  totalCreatives: number;
  /** Creatives whose asset was loaded from the library (sourceType === "reused"). */
  reusedAssets: number;
  /** Creatives whose asset was produced by DALL-E (sourceType === "generated"). */
  generatedAssets: number;
  /** Per-creative errors — errors scoped to a specific product × ratio. */
  failedCreatives: number;
  /** Total wall-clock time from pipeline start to result. */
  totalTimeMs: number;
  /** Run status classification — see RunStatus. */
  status: RunStatus;
}

/**
 * Compute the run summary for a pipeline result.
 *
 * Input is deliberately the three primitive arrays the pipeline already
 * exposes, not a full `PipelineResult`, so callers that only have a
 * partial view (e.g., the organizer before it has a final `PipelineResult`
 * in hand) can still call this.
 *
 * `totalProducts` counts DISTINCT product slugs in the successful creatives
 * — a product with 3 successful aspect ratios counts as 1, not 3. This
 * matches how a reviewer reads the output: *"you processed 2 products"*,
 * not *"you processed 6 product-ratio pairs"*.
 *
 * `failedCreatives` counts per-creative errors only (errors with both
 * `product` and `aspectRatio` defined). System errors (brief.json save
 * failure, timeout budget exceeded, validation failure) are NOT counted
 * here because they don't correspond to a specific creative slot.
 * The API response still surfaces them via the top-level `errors` array
 * for debugging.
 */
export function computeRunSummary(
  creatives: readonly CreativeOutput[],
  errors: readonly PipelineError[],
  totalTimeMs: number
): RunSummary {
  const distinctProductSlugs = new Set<string>();
  let reusedAssets = 0;
  let generatedAssets = 0;

  for (const creative of creatives) {
    distinctProductSlugs.add(creative.productSlug);
    if (creative.sourceType === "reused") {
      reusedAssets += 1;
    } else {
      generatedAssets += 1;
    }
  }

  let failedCreatives = 0;
  for (const error of errors) {
    // Per-creative errors are the ones tied to a specific product × ratio
    // pair. System errors (missing product/aspectRatio) are intentionally
    // excluded — see JSDoc above.
    if (error.product !== undefined && error.aspectRatio !== undefined) {
      failedCreatives += 1;
    }
  }

  const totalCreatives = creatives.length;
  // Note: `status: "failed"` is set even if system errors fired as long as
  // zero creatives came out, because from the reviewer's perspective
  // "0 creatives" is the headline regardless of the cause.
  const status: RunStatus =
    totalCreatives === 0
      ? "failed"
      : errors.length === 0
        ? "complete"
        : "partial";

  return {
    totalProducts: distinctProductSlugs.size,
    totalCreatives,
    reusedAssets,
    generatedAssets,
    failedCreatives,
    totalTimeMs,
    status,
  };
}
