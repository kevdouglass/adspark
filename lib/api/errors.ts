/**
 * API Error Envelope — Standardized error shape for all API routes.
 *
 * Every error response from every API route MUST match this shape.
 * This is a public contract — frontend consumers, error monitoring,
 * and retry logic all depend on the stable `code` field.
 *
 * Mapping from pipeline errors to HTTP responses uses a compile-time
 * exhaustive switch on the typed `cause` discriminant — no string
 * matching, no silent drift. See docs/adr/ADR-003-typed-error-cause-discriminants.md
 */

import type {
  PipelineError,
  PipelineErrorCause,
} from "@/lib/pipeline/types";

/**
 * Standard API error response envelope.
 * All API routes return this shape on 4xx/5xx responses.
 */
export interface ApiError {
  /** Stable machine-readable error code for client handling (e.g., "INVALID_BRIEF") */
  code: ApiErrorCode;
  /** Human-readable error message safe to display to end users */
  message: string;
  /** Optional field-level details (e.g., Zod validation errors) */
  details?: string[];
  /** Request correlation ID — include in bug reports and log searches */
  requestId: string;
}

/**
 * Stable error codes — public API contract.
 *
 * Adding a new code is a non-breaking change.
 * Removing or renaming a code is a breaking change and requires version bump.
 *
 * The `CLIENT_*` codes are CLIENT-ORIGINATED — they are never produced by
 * the pipeline or the server, and the server-side `mapPipelineErrorToApiError`
 * exhaustive switch intentionally does NOT handle them. They exist so the
 * frontend can distinguish "request never reached the server" (network,
 * timeout) from "server rejected or errored" — different error-UI messaging.
 */
export type ApiErrorCode =
  // 400-class: client-supplied bad input (server-originated)
  | "INVALID_JSON"
  | "INVALID_BRIEF"
  | "REQUEST_TOO_LARGE"
  | "CONTENT_POLICY_VIOLATION"
  // 404-class: resource not found (server-originated). Used by the file-
  // serving route and any future /api/campaigns/[id]-style lookups. A
  // dedicated code lets clients branch on "not found" without routing
  // 404s through the 500-class INTERNAL_ERROR bucket (which triggers
  // retries, Sentry alerts, etc.).
  | "NOT_FOUND"
  // 500-class: server errors (server-originated)
  | "MISSING_CONFIGURATION"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "STORAGE_ERROR"
  | "PROCESSING_ERROR"
  | "INTERNAL_ERROR"
  // Client-only: never produced server-side, never consumed by the pipeline
  // error mapper. These let the UI distinguish network failures from server
  // errors so retry/diagnostic messaging can differ.
  | "CLIENT_NETWORK_ERROR"
  | "CLIENT_TIMEOUT"
  // Client-only: user intentionally cancelled (component unmount, explicit
  // AbortController.abort()). Semantically distinct from a network failure —
  // the UI should usually treat this as a silent no-op, not an error state.
  | "CLIENT_ABORTED";

/**
 * Runtime-queryable set of all valid ApiErrorCode values.
 *
 * Used by the client's `isApiErrorShape` check to reject server responses
 * that match the structural shape of `ApiError` but carry an unknown
 * `code` value. Without this guard, a malicious or misconfigured server
 * could bypass the enumerated type system and a downstream
 * `switch(error.code)` would silently miss the unknown variant.
 *
 * If you add a new variant to `ApiErrorCode`, add it here too — TypeScript
 * will NOT flag a missing entry (a `Set<ApiErrorCode>` literal doesn't
 * force exhaustiveness). The `KNOWN_API_ERROR_CODES` name is deliberate
 * to make a missing entry easier to find on grep.
 */
export const KNOWN_API_ERROR_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "INVALID_JSON",
  "INVALID_BRIEF",
  "REQUEST_TOO_LARGE",
  "CONTENT_POLICY_VIOLATION",
  "NOT_FOUND",
  "MISSING_CONFIGURATION",
  "UPSTREAM_ERROR",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_TIMEOUT",
  "STORAGE_ERROR",
  "PROCESSING_ERROR",
  "INTERNAL_ERROR",
  "CLIENT_NETWORK_ERROR",
  "CLIENT_TIMEOUT",
  "CLIENT_ABORTED",
]);

/**
 * Request body size limit (50KB).
 *
 * Campaign briefs are small JSON documents — a realistic brief is under 5KB
 * (2 products, campaign metadata, aspect ratios). 50KB gives 10x headroom
 * while still preventing DoS via oversized payloads.
 *
 * Enforced by reading the body stream and counting bytes — NOT just by
 * checking the Content-Length header, which can be omitted or lied about.
 */
export const MAX_REQUEST_BODY_BYTES = 50 * 1024;

/**
 * Generic fallback message for 500 responses when the original error
 * might leak internal details (API keys, stack traces, config names).
 * The real error message is logged server-side with the requestId.
 */
const GENERIC_INTERNAL_ERROR_MESSAGE =
  "An internal server error occurred. Please contact support with the requestId.";

/**
 * Exhaustiveness check — TypeScript will error at compile time if any
 * PipelineErrorCause variant is missing from the switch.
 *
 * See: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking
 */
function assertUnreachable(value: never): never {
  throw new Error(
    `Unhandled PipelineErrorCause: ${JSON.stringify(value)}. ` +
      `Add a case in mapPipelineErrorToApiError() — see ADR-003.`
  );
}

/**
 * Map a PipelineError (domain layer) to an ApiError (API contract).
 *
 * Compile-time exhaustive: every variant of PipelineErrorCause must be
 * handled here, or TypeScript fails the build. This is the authoritative
 * mapping table — route handlers never construct ApiError manually from
 * pipeline errors.
 *
 * Note: we use the pipeline error's `message` directly for user-facing
 * errors because Zod validation errors and DALL-E content policy messages
 * are already safe to display. We do NOT use it for `unknown` causes where
 * the message might contain internal details.
 */
export function mapPipelineErrorToApiError(
  pipelineError: PipelineError,
  requestId: string
): { status: number; body: ApiError } {
  const cause = pipelineError.cause;

  switch (cause) {
    case "invalid_input":
      return {
        status: 400,
        body: {
          code: "INVALID_BRIEF",
          message: pipelineError.message,
          requestId,
        },
      };

    case "content_policy":
      return {
        status: 422,
        body: {
          code: "CONTENT_POLICY_VIOLATION",
          message:
            "The campaign prompt was rejected by the image generation provider's content policy. Please revise the product description or campaign message.",
          requestId,
        },
      };

    case "rate_limited":
      return {
        status: 503,
        body: {
          code: "UPSTREAM_RATE_LIMITED",
          message:
            "The image generation service is rate-limited. Please retry in a few seconds.",
          requestId,
        },
      };

    case "upstream_timeout":
      return {
        status: 504,
        body: {
          code: "UPSTREAM_TIMEOUT",
          message:
            "The image generation service did not respond in time. Please retry.",
          requestId,
        },
      };

    case "upstream_error":
      return {
        status: 502,
        body: {
          code: "UPSTREAM_ERROR",
          message:
            "The image generation service encountered an error. Please retry in a few seconds.",
          requestId,
        },
      };

    case "storage_error":
      return {
        status: 500,
        body: {
          code: "STORAGE_ERROR",
          message:
            "Failed to save generated creatives to storage. The generation completed but output was not persisted.",
          requestId,
        },
      };

    case "processing_error":
      return {
        status: 500,
        body: {
          code: "PROCESSING_ERROR",
          message:
            "Failed to process the generated image (resize, overlay, or thumbnail).",
          requestId,
        },
      };

    case "unknown":
      return {
        status: 500,
        body: {
          code: "INTERNAL_ERROR",
          message: GENERIC_INTERNAL_ERROR_MESSAGE,
          requestId,
        },
      };

    default:
      return assertUnreachable(cause);
  }
}

/**
 * Build an ApiError response for a specific error code.
 * Used when the error doesn't originate from the pipeline (e.g., oversized
 * request body, malformed JSON, missing env var).
 */
export function buildApiError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: string[]
): ApiError {
  return details ? { code, message, requestId, details } : { code, message, requestId };
}

/**
 * Sanitize a raw error message for inclusion in an HTTP response body.
 * Returns a generic message instead of the raw error to prevent internal
 * details (stack traces, env var names, API keys echoed in URLs) from
 * leaking to clients. The real message should still be logged server-side.
 */
export function sanitizeErrorMessage(_error: unknown): string {
  return GENERIC_INTERNAL_ERROR_MESSAGE;
}

// ---------------------------------------------------------------------------
// Binary body reader with stream-level byte cap (SPIKE-003 Adjustment 2)
// ---------------------------------------------------------------------------

/**
 * Maximum upload body size in bytes. 10 MB is generous for a single image:
 * a real DALL-E 1024×1024 PNG is ~2-3 MB; a 9:16 vertical at 1080×1920 tops
 * out around 5 MB. The cap prevents memory exhaustion from a compromised or
 * buggy client. Mirrors `MAX_FILE_SIZE_BYTES` in `app/api/files/[...path]/route.ts`
 * so the serving path and the upload path agree on the ceiling.
 *
 * IMPORTANT for Vercel Hobby tier: Vercel's Edge runtime caps request bodies
 * at 4.5 MB, so this 10 MB value is advisory when running on Vercel Hobby.
 * The `route.ts` upload handler declares `runtime = "nodejs"` which has
 * no hard Vercel body cap on Pro, but Hobby still applies. Documented in
 * SPIKE-003 §Risk register.
 */
export const MAX_UPLOAD_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Read a Request body into a Buffer with a hard byte limit enforced at
 * the stream level.
 *
 * Sibling to `readBodyWithLimit` (which decodes to UTF-8 text for JSON
 * bodies). This variant returns the raw bytes — required by the upload
 * PUT route, which accepts image binary payloads.
 *
 * WHY a stream-level cap instead of `Content-Length` or `arrayBuffer()`:
 *
 * - `Content-Length` headers are client-supplied and can be omitted via
 *   chunked transfer encoding or simply lied about. Trusting the header
 *   lets a malicious client claim 100 bytes and then stream 10 GB.
 * - `await request.arrayBuffer()` reads the ENTIRE body into memory before
 *   any size check fires. A 10 GB body would allocate a 10 GB buffer and
 *   crash the server process before the caller gets a chance to reject it.
 *
 * The stream-chunk loop below reads incrementally, tracks the cumulative
 * byte count, and cancels the reader (releasing the underlying socket) the
 * instant the cap is exceeded. No allocation larger than the cap can happen.
 *
 * Returns a discriminated union so callers handle both paths explicitly —
 * matches the existing `readBodyWithLimit` shape.
 */
export async function readBinaryBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; data: Buffer }
  | { ok: false; reason: "too_large" | "read_error" | "empty" }
> {
  if (!request.body) {
    return { ok: false, reason: "empty" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Cancel the underlying stream immediately so bytes stop flowing.
        // We intentionally swallow any cancel() rejection because the
        // important thing is that we stop reading — the caller's response
        // will include the 413 either way.
        reader.cancel().catch(() => {
          // ignore cancel errors
        });
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_error" };
  }

  if (totalBytes === 0) {
    return { ok: false, reason: "empty" };
  }

  // Concatenate the stream chunks into a single Buffer. Pre-allocating
  // with `Buffer.alloc(totalBytes)` is O(n) in total bytes and avoids
  // the repeated reallocation that `Buffer.concat` on a large array
  // can incur.
  const merged = Buffer.alloc(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: merged };
}
