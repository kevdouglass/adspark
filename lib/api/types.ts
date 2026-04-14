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
import type {
  AspectRatio,
  CreativeSourceType,
  PipelineErrorCause,
  PipelineStage,
} from "@/lib/pipeline/types";
import type { RunSummary } from "@/lib/pipeline/runSummary";

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
  /**
   * DELIBERATE: surfaces the reuse vs generate distinction over the wire
   * so the UI can render a "Reused" / "Generated" badge on each card and
   * the reviewer can see which branch produced each creative without
   * opening the manifest. Added in Block C of interview prep — closes
   * the assignment's "reuse input assets when available" visibility gap.
   */
  sourceType: CreativeSourceType;
}

/**
 * A single pipeline error in the success response.
 *
 * Parallel shape to `PipelineError` in `lib/pipeline/types.ts`. Even though
 * every field is a literal-union or string today, we enumerate them here
 * so future additions to `PipelineError` (e.g., `internalStackTrace`,
 * `rawUpstreamResponse`, debug metadata) do NOT auto-ship over the wire.
 *
 * The mapper `toApiPipelineError` in `lib/api/mappers.ts` copies each
 * field explicitly — that's the review gate, same pattern as
 * `toApiCreativeOutput`.
 */
export interface ApiPipelineError {
  product?: string;
  aspectRatio?: AspectRatio;
  stage: PipelineStage;
  cause: PipelineErrorCause;
  message: string;
  retryable: boolean;
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
  errors: ApiPipelineError[];
  requestId: string;
  /**
   * Aggregated run summary — distinct product count, reused vs generated
   * counts, failed creatives, status, total time. Derived by the mapper
   * via `computeRunSummary()` (same helper the manifest uses, so the
   * manifest and the wire response can never disagree).
   *
   * The UI's `RunSummaryPanel` reads this directly for the at-a-glance
   * count row above the gallery. See `components/RunSummaryPanel.tsx`.
   *
   * NOTE: `RunSummary` is imported from `lib/pipeline/runSummary.ts`,
   * which is a plain data shape with no framework dependencies — safe to
   * expose over the wire. If future pipeline-only fields ever get added
   * to `RunSummary`, update this JSDoc and the mapper alongside them.
   */
  summary: RunSummary;
}

// ---------------------------------------------------------------------------
// Upload flow wire types (SPIKE-003 / INVESTIGATION-003)
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /api/upload` (step 1 — init).
 *
 * The client sends the filename + content type + optional campaign id;
 * the server validates, builds a safe storage key, and returns an
 * upload target URL (step 2). The body is small JSON — no binary here.
 *
 * The `contentType` field is constrained to the image MIMEs the
 * pipeline can consume (PNG / JPEG / WebP). Any other value is
 * rejected with 400 INVALID_BRIEF before the server builds the key.
 */
export interface UploadInitRequestBody {
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  /**
   * Optional — when provided, the storage key includes the campaign id
   * for grouping (`assets/<campaignId>/<timestamp>-<name>.<ext>`).
   * Falls back to `"adhoc"` if omitted.
   */
  campaignId?: string;
}

/**
 * Response body for `POST /api/upload` (step 1 — init).
 *
 * The client does a follow-up PUT to `uploadUrl` with the raw image
 * bytes. In S3 mode, `uploadUrl` is a pre-signed S3 PUT URL — the
 * browser talks directly to S3, bypassing the Next.js function. In
 * local mode, `uploadUrl` points back at `PUT /api/upload?key=...` which
 * writes via `LocalStorage.save()`.
 *
 * CRITICAL: the client must save `key` (NOT `uploadUrl`) into the
 * brief's `product.existingAsset` field. Signed URLs expire; keys
 * don't. The reuse branch in `assetResolver.resolveOne` expects a
 * storage key. See INVESTIGATION-003 §Deep audit E.
 *
 * See ADR-006 — this is an API-layer type with no domain projection,
 * so a plain interface is fine (no parallel-shapes mapper needed).
 */
export interface UploadInitResponseBody {
  /** URL the client should PUT the bytes to. Local or pre-signed S3. */
  uploadUrl: string;
  /**
   * The storage key — save this to `product.existingAsset` after the
   * PUT succeeds. NOT the URL.
   */
  key: string;
  /** HTTP method for the follow-up upload. Always "PUT" in this design. */
  method: "PUT";
  /** Headers the client must send on the follow-up PUT (e.g. Content-Type). */
  headers: Record<string, string>;
  /**
   * URL the frontend can use to preview the uploaded asset after the
   * PUT completes. In local mode this is `/api/files/<key>`. In S3 mode
   * this is NOT populated — the GET URL is minted at brief submission
   * time via `S3Storage.getUrl()`, not at upload time.
   */
  assetUrl: string | null;
}

// ---------------------------------------------------------------------------
// Response — error body
// ---------------------------------------------------------------------------

/**
 * Error responses use the canonical `ApiError` type from `./errors`, which
 * is the module that owns both the type and the helper functions
 * (`buildApiError`, `mapPipelineErrorToApiError`, etc.). This module does
 * NOT re-export `ApiError`, so there is exactly one import path for the
 * type — no footgun where two import paths resolve to the same symbol
 * and teams split on which to use.
 *
 * Route handlers import `ApiError` directly from `@/lib/api/errors` and
 * pin every error branch with `satisfies ApiError` to get compile-time
 * enforcement of the error contract on both the happy path AND the error
 * branches.
 */
