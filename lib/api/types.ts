/**
 * Shared API Contract Types — POST /api/generate
 *
 * This module is the declared public contract for types that cross the
 * frontend ↔ backend boundary. Request and response shapes are defined as
 * **explicit parallel types** with mappers (see `lib/api/mappers.ts`) — NOT
 * structural aliases of the domain types in `lib/pipeline/types`.
 *
 * WHY parallel shapes instead of `type X = PipelineResult & {...}`:
 *
 * A transparent alias like `GenerateSuccessResponseBody = PipelineResult`
 * means every future addition to the pipeline domain type (internal
 * telemetry, cost fields, model metadata, PII for analytics) is automatically
 * shipped over the wire with zero code review. The contract is aspirational,
 * not enforced.
 *
 * Parallel shapes invert this: the only way a new field reaches the wire is
 * by a human updating both the interface AND the mapper. That's the review
 * gate. The compile-time cost is one mapper function. The architectural win
 * is a real boundary.
 *
 * See docs/adr/ADR-006-api-wire-format-parallel-shapes.md for the full
 * rationale (reviewer pushback from PR #46, alternatives considered).
 *
 * WHY the request side uses `z.infer<typeof campaignBriefSchema>`:
 *
 * Per ADR-005, Zod IS the contract for the request body — the same schema
 * validates on both the server (route.ts) and the client (BriefForm via
 * `@hookform/resolvers/zod`). Using `z.infer` for the request type means
 * the runtime validator and the TypeScript type cannot drift: if the schema
 * changes, the type changes automatically.
 */

import type { z } from "zod";
import type { campaignBriefSchema } from "@/lib/pipeline/briefParser";
import type { AspectRatio, PipelineError } from "@/lib/pipeline/types";
import type { ApiError, ApiErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

/**
 * Request body shape for POST /api/generate.
 *
 * Derived from `campaignBriefSchema` via `z.infer` so the runtime validator
 * (used by the route handler AND by the frontend form via
 * `@hookform/resolvers/zod`) is the single source of truth. If the schema
 * changes, this type changes automatically.
 *
 * The name `GenerateRequestBody` (not `GenerateRequest`) emphasizes that
 * this is the HTTP body payload, not an RPC-style request object.
 */
export type GenerateRequestBody = z.infer<typeof campaignBriefSchema>;

// ---------------------------------------------------------------------------
// Response — success body (explicit parallel shape)
// ---------------------------------------------------------------------------

/**
 * A single creative in the success response.
 *
 * This is an **explicit parallel shape** to `CreativeOutput` in
 * `lib/pipeline/types.ts`. The fields listed here are the public contract.
 * Adding a field to `CreativeOutput` does NOT automatically ship it over
 * the wire — `toApiCreativeOutput` in `lib/api/mappers.ts` has to be
 * updated to copy it. That's the review gate.
 *
 * Why each field is public:
 * - `productName`, `productSlug`, `aspectRatio`, `dimensions` — identity
 * - `creativePath`, `thumbnailPath` — storage keys for local dev
 * - `creativeUrl`, `thumbnailUrl` — pre-signed URLs for S3 mode (optional
 *   because local dev uses paths, not URLs)
 * - `prompt` — DELIBERATE: Adobe evaluators want to see the prompts
 *   (Quinn Frampton: "show us HOW the AI did it"). The prompt is a
 *   first-class part of the public API, not telemetry.
 * - `generationTimeMs`, `compositingTimeMs` — DELIBERATE: needed by the
 *   D3 metrics dashboard (ADS-009) to visualize pipeline performance.
 */
export interface ApiCreativeOutput {
  productName: string;
  productSlug: string;
  aspectRatio: AspectRatio;
  dimensions: string;
  creativePath: string;
  thumbnailPath: string;
  creativeUrl?: string;
  thumbnailUrl?: string;
  prompt: string;
  generationTimeMs: number;
  compositingTimeMs: number;
}

/**
 * Success response body (HTTP 200) for POST /api/generate.
 *
 * Explicit parallel shape — not `PipelineResult & { requestId }`. Fields
 * are enumerated so future pipeline additions don't auto-ship.
 *
 * Note: `errors` may contain per-creative partial failures even on a 200
 * response (e.g., 5 of 6 images succeeded). Clients should check the
 * `errors` array to detect partial failure, not just HTTP status.
 */
export interface GenerateSuccessResponseBody {
  campaignId: string;
  creatives: ApiCreativeOutput[];
  totalTimeMs: number;
  totalImages: number;
  errors: PipelineError[];
  requestId: string;
}

// ---------------------------------------------------------------------------
// Response — error body
// ---------------------------------------------------------------------------

/**
 * Error response body for POST /api/generate (HTTP 4xx/5xx).
 *
 * Re-exported as `ApiError` directly — no alias. `ApiError` is shared by
 * ALL API routes (not just /generate), so keeping the canonical name
 * avoids the footgun where the same type is importable under two names
 * and callers split on which to import.
 *
 * Route handlers pin every error branch with `satisfies ApiError` to get
 * compile-time enforcement of the error contract, not just the happy path.
 */
export type { ApiError, ApiErrorCode };
