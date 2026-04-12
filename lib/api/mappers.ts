/**
 * API Response Mappers — Projects domain types to public wire shapes.
 *
 * This module owns the translation between `lib/pipeline/types` (internal
 * domain) and `lib/api/types` (public contract). Every field that crosses
 * the boundary is named explicitly here — there's no spread operator that
 * auto-ships unreviewed fields.
 *
 * WHY a dedicated mappers module (not inline in route.ts):
 * - Keeps the route handler thin (per ADR-002)
 * - One place to review when the wire format changes
 * - Trivially unit-testable without mounting the route
 * - Mirrors the pattern already used by `mapPipelineErrorToApiError` in
 *   `lib/api/errors.ts`
 *
 * See docs/adr/ADR-006-api-wire-format-parallel-shapes.md for rationale.
 */

import type {
  CreativeOutput,
  PipelineResult,
} from "@/lib/pipeline/types";
import type {
  ApiCreativeOutput,
  GenerateSuccessResponseBody,
} from "./types";

/**
 * Project a single `CreativeOutput` to its public `ApiCreativeOutput` shape.
 *
 * Named field-by-field on purpose: if a new field is added to the domain
 * `CreativeOutput` (e.g., `costUsd`, `modelVersion`, internal telemetry),
 * it will NOT be copied here without a code change. This function IS the
 * review gate.
 */
function toApiCreativeOutput(creative: CreativeOutput): ApiCreativeOutput {
  return {
    productName: creative.productName,
    productSlug: creative.productSlug,
    aspectRatio: creative.aspectRatio,
    dimensions: creative.dimensions,
    creativePath: creative.creativePath,
    thumbnailPath: creative.thumbnailPath,
    creativeUrl: creative.creativeUrl,
    thumbnailUrl: creative.thumbnailUrl,
    prompt: creative.prompt,
    generationTimeMs: creative.generationTimeMs,
    compositingTimeMs: creative.compositingTimeMs,
  };
}

/**
 * Project a `PipelineResult` + requestId to the public success response body.
 *
 * Used by `POST /api/generate` for 200 responses. Fields are enumerated
 * explicitly so future pipeline additions don't auto-ship over the wire.
 *
 * The return type is `GenerateSuccessResponseBody`, so TypeScript will
 * catch any mismatch at compile time — if the public contract changes
 * (field added/removed/renamed), this function must be updated or the
 * build breaks.
 */
export function toGenerateSuccessResponseBody(
  result: PipelineResult,
  requestId: string
): GenerateSuccessResponseBody {
  return {
    campaignId: result.campaignId,
    creatives: result.creatives.map(toApiCreativeOutput),
    totalTimeMs: result.totalTimeMs,
    totalImages: result.totalImages,
    errors: result.errors,
    requestId,
  };
}
