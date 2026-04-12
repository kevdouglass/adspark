/**
 * Shared API Contract Types — POST /api/generate
 *
 * This module is the single source of truth for the types that cross
 * the frontend ↔ backend boundary. Frontend components import from here
 * to get typed request/response shapes without reaching into the pipeline
 * layer directly.
 *
 * WHY a dedicated contract module:
 * The pipeline layer (`lib/pipeline/`) owns the domain types — those are
 * internal implementation details. The API layer re-exports the subset
 * that's part of the public contract, with alias names that match what
 * the HTTP endpoint actually accepts and returns. If the pipeline
 * internals change, this module stays stable as long as the wire format
 * doesn't change.
 *
 * WHY re-export ApiError from here:
 * So a frontend file only has to import from one place:
 *
 *   import type {
 *     GenerateRequest,
 *     GenerateSuccessResponse,
 *     ApiError,
 *   } from "@/lib/api/types";
 *
 * No need to remember that errors live in `lib/api/errors` while request
 * types live elsewhere. One import path for everything API-related.
 */

import type { ApiError, ApiErrorCode } from "./errors";
import type { CampaignBrief, PipelineResult } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/**
 * Request body for POST /api/generate.
 *
 * Aliased from CampaignBrief so the frontend form imports a name that
 * matches the HTTP endpoint it's calling, not the domain concept it
 * happens to serialize to. If the wire format diverges from the domain
 * type later (e.g., a metadata envelope), this alias becomes a real
 * wrapper without rippling through every caller.
 */
export type GenerateRequest = CampaignBrief;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/**
 * Success response body (HTTP 200) for POST /api/generate.
 *
 * Matches the shape returned by `app/api/generate/route.ts` when
 * `result.creatives.length > 0` — the full PipelineResult plus the
 * correlation requestId added by the route handler.
 *
 * Note: even on success, `errors` may contain per-creative partial
 * failures (e.g., 5 of 6 images succeeded). Clients must check the
 * `errors` array to detect partial failure, not just the HTTP status.
 */
export type GenerateSuccessResponse = PipelineResult & {
  requestId: string;
};

/**
 * Error response body for POST /api/generate (HTTP 4xx/5xx).
 *
 * Aliased from ApiError for symmetry with GenerateSuccessResponse — a
 * frontend client handling the response discriminates on HTTP status
 * and then narrows the body to one of these two types.
 */
export type GenerateErrorResponse = ApiError;

/**
 * Union of all possible response body shapes for POST /api/generate.
 *
 * Frontend clients that want to type-narrow on the response body
 * (without relying on HTTP status) can use this union with a structural
 * check like `"code" in response` — only the error shape has a `code`
 * field. Prefer status-based discrimination where possible since it
 * matches how the server decides which shape to send.
 */
export type GenerateResponseBody =
  | GenerateSuccessResponse
  | GenerateErrorResponse;

// ---------------------------------------------------------------------------
// Re-exports for single-import convenience
// ---------------------------------------------------------------------------

export type { ApiError, ApiErrorCode };
