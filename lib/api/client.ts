/**
 * Frontend API Client — Typed fetch wrapper for AdSpark's backend.
 *
 * This module owns all `fetch` calls from the client. Components import
 * `generateCreatives` (and future endpoint functions) and never see the
 * HTTP layer directly — no duplicated error handling, no scattered
 * `response.ok ? ... : ...` ladders in React components.
 *
 * WHY a Result union instead of throwing:
 *
 * This client conforms to the `GenerateFn` contract defined in
 * `lib/hooks/usePipelineState.tsx`. That contract is deliberately
 * return-based (`{ ok: true, data } | { ok: false, error }`) instead
 * of throw-based so the provider's orchestration code doesn't have to
 * classify exceptions at runtime — the client classifies once, here.
 *
 * WHY `AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS)`:
 *
 * This client is the MIDDLE layer in the three-layer timeout stagger
 * (pipeline 50s < client 55s < Vercel 60s). The value itself — and the
 * reasoning for the stagger — lives in `lib/api/timeouts.ts`, which is
 * the single source of truth. Never hard-code 55_000 here; any change
 * to the budget belongs in `timeouts.ts` so the invariant test there
 * catches a mis-ordering.
 *
 * WHY no Zod validation on the response:
 *
 * Per ADR-006, the backend already enumerates the wire format via
 * `toGenerateSuccessResponseBody` in `lib/api/mappers.ts`. Re-validating
 * here would duplicate the schema and create the exact drift risk
 * ADR-006 was written to close. We apply a minimum sanity check (body is
 * a non-null object) and trust the shape. For non-2xx bodies we use an
 * `isApiErrorShape` check that validates the `code` field against the
 * `KNOWN_API_ERROR_CODES` set — structural match alone isn't enough, the
 * code must be one of our enumerated values.
 *
 * WHY no response-size cap today:
 *
 * `response.json()` loads the entire body into memory. For a compromised
 * backend this is a DoS vector. Acceptable for the POC because the real
 * backend caps its responses at ~5MB and we're calling ONE trusted
 * endpoint. A production version would stream-read with a size ceiling.
 *
 * SCOPE: Only `generateCreatives` is implemented. Per CLAUDE.md's "don't
 * design for hypothetical future requirements":
 * - uploadAsset depends on ADS-010 (S3 pre-signed URLs) and ADS-013
 * - getCampaign depends on `/api/campaigns/[id]` which doesn't exist
 * Follow-up tickets will add them when they're actually needed.
 */

import type {
  GenerateRequestBody,
  GenerateSuccessResponseBody,
  UploadInitRequestBody,
  UploadInitResponseBody,
} from "./types";
import { CLIENT_REQUEST_TIMEOUT_MS } from "./timeouts";
import { KNOWN_API_ERROR_CODES, type ApiError } from "./errors";
import type {
  GenerateFn,
  GenerateOutcome,
} from "@/lib/hooks/usePipelineState";
import type { PipelineStage } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/**
 * Default request timeout in milliseconds. Re-exported alias for
 * `CLIENT_REQUEST_TIMEOUT_MS` so callers of this module don't need
 * to reach into `./timeouts` directly. The value is owned by
 * `lib/api/timeouts.ts` — see that file for the stagger rationale
 * (pipeline 50s < client 55s < Vercel 60s).
 */
export const DEFAULT_GENERATE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;

/**
 * Generic message shown when the fetch itself fails (DNS failure,
 * connection refused, offline). We never pipe a raw network error message
 * to the user because it can leak internal details (proxy config, hosts).
 */
const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Please check your connection and try again.";

/**
 * Generic message when the server replies with a non-JSON body, a
 * null/primitive JSON body, or a well-formed JSON body that doesn't
 * match the `ApiError` shape.
 *
 * All three of these paths are infrastructure-level failures (load
 * balancer error page, truncated response, wrong framework default)
 * and the user experience is the same: "something generic broke,
 * try again." We don't leak the status code into the message — that's
 * developer detail, goes to console.error instead.
 */
const UNEXPECTED_SERVER_RESPONSE_MESSAGE =
  "The server returned an unexpected response. Please try again.";

/**
 * Generic message when the user intentionally cancels a request (component
 * unmount, explicit AbortController.abort()). The UI will usually swallow
 * this silently rather than display it — hence the neutral phrasing.
 */
const ABORTED_MESSAGE = "Request was cancelled.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a client-side correlation id with a defensive fallback for
 * environments where `crypto.randomUUID()` is unavailable (insecure HTTP
 * origins, older browsers, test environments without a crypto polyfill).
 *
 * Calling `crypto.randomUUID()` without guarding would throw inside
 * `buildClientError`, and that throw would escape `postJson`'s try/catch
 * as a rejected promise — breaking the Result-union contract exactly at
 * the moment error handling must work. The fallback is not
 * cryptographically strong but is unique enough for client-side log
 * correlation across a single session.
 */
function generateClientId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + high-entropy random. Collision is astronomically
  // unlikely for correlation within a single session; we're not using this
  // for cryptography.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Runtime check for the `ApiError` shape — validates both the structural
 * presence of required fields AND that the `code` field is a member of
 * the `KNOWN_API_ERROR_CODES` set. A server sending
 * `{code: "SOMETHING_MADE_UP", message, requestId}` will FAIL this check,
 * forcing the client to fall back to a generic `INTERNAL_ERROR` rather
 * than passing an unknown enum value downstream to `switch(error.code)`.
 *
 * This is stricter than pure duck-typing (a prior version of the client
 * was flagged in review for letting arbitrary `code` strings through).
 */
function isApiErrorShape(value: unknown): value is ApiError {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.code !== "string") return false;
  if (typeof obj.message !== "string") return false;
  if (typeof obj.requestId !== "string") return false;
  // Validate `code` is a known enum value — rejects typos, made-up codes,
  // and forward-incompatible codes from a newer server.
  if (!KNOWN_API_ERROR_CODES.has(obj.code as ApiError["code"])) {
    return false;
  }
  // `details` is optional, but if present must be string[].
  if (obj.details !== undefined) {
    if (
      !Array.isArray(obj.details) ||
      obj.details.some((d) => typeof d !== "string")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build a client-side `ApiError` for errors that never reached the server.
 *
 * Uses `generateClientId()` with a `client-` prefix so logs can distinguish
 * "client never talked to server" from "server assigned this id."
 */
function buildClientError(
  code:
    | "CLIENT_NETWORK_ERROR"
    | "CLIENT_TIMEOUT"
    | "CLIENT_ABORTED"
    | "INTERNAL_ERROR",
  message: string
): ApiError {
  return {
    code,
    message,
    requestId: `client-${generateClientId()}`,
  };
}

/**
 * Harden a server-supplied `ApiError` before passing it to the caller.
 *
 * A compromised or misconfigured server could send `requestId: "client-forged"`
 * and poison the namespace that the client uses to distinguish its own
 * errors from server errors. Strip the `client-` prefix on any server
 * error we accept, replacing it with `srv-rewritten-*` so the original
 * value is still visible for debugging but cannot be mistaken for a
 * genuine client-origin id.
 *
 * For a POC deployed to a trusted Vercel backend this is theoretical,
 * but enforcing the namespace now is a one-line fix with zero runtime
 * cost, and it's a defensive posture that scales.
 */
function hardenServerError(error: ApiError): ApiError {
  if (error.requestId.startsWith("client-")) {
    return {
      ...error,
      requestId: `srv-rewritten-${error.requestId}`,
    };
  }
  return error;
}

// ---------------------------------------------------------------------------
// postJson — reusable POST-with-Result-union helper
// ---------------------------------------------------------------------------

interface PostJsonOptions {
  /**
   * Request timeout in milliseconds. Defaults to DEFAULT_GENERATE_TIMEOUT_MS.
   * Tests pass a small value to exercise the timeout path without waiting.
   *
   * Note: if `signal` is also provided, the caller owns cancellation
   * entirely — this timeout value is ignored.
   */
  timeoutMs?: number;
  /**
   * Optional external AbortSignal. If provided, the internal timeout
   * signal is NOT created — the caller owns cancellation. Useful for
   * React components that want to abort on unmount.
   */
  signal?: AbortSignal;
}

/**
 * POST a JSON body and return a Result union discriminating success vs.
 * error. Generic over the expected success body shape.
 *
 * The Result union matches the `GenerateOutcome` type in
 * `lib/hooks/usePipelineState.tsx` so the return value can be passed
 * directly to the hook's state machine.
 */
async function postJson<TSuccess>(
  path: string,
  body: unknown,
  options: PostJsonOptions = {}
): Promise<{ ok: true; data: TSuccess } | { ok: false; error: ApiError }> {
  const callerSignal = options.signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  // Prefer the caller's signal when provided — they own cancellation.
  // Otherwise install our own timeout.
  const signal = callerSignal ?? AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (caught) {
    // Classification order matters:
    // 1. AbortError — user/caller cancelled (component unmount, explicit abort)
    // 2. TimeoutError — our internal timeout fired
    // 3. Everything else — network failure
    if (caught instanceof DOMException) {
      if (caught.name === "AbortError") {
        return {
          ok: false,
          error: buildClientError("CLIENT_ABORTED", ABORTED_MESSAGE),
        };
      }
      if (caught.name === "TimeoutError") {
        // Only interpolate the timeout value when we OWN the timeout —
        // if the caller supplied their own signal, we don't actually
        // know what their timeout budget was.
        const timeoutMessage = callerSignal
          ? "Request timed out. The server may still be processing — check again in a moment."
          : `Request timed out after ${timeoutMs}ms. The server may still be processing — check again in a moment.`;
        return {
          ok: false,
          error: buildClientError("CLIENT_TIMEOUT", timeoutMessage),
        };
      }
    }
    return {
      ok: false,
      error: buildClientError("CLIENT_NETWORK_ERROR", NETWORK_ERROR_MESSAGE),
    };
  }

  // Try to parse the body as JSON. Fails for HTML error pages, empty
  // responses, and any non-JSON content-type the backend produces.
  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    // Log the status to console.error so developers can tell "HTML 502
    // from the load balancer" from "empty body from a broken handler"
    // without leaking it to the user.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[apiClient] HTTP ${response.status} returned a non-JSON body`
      );
    }
    return {
      ok: false,
      error: buildClientError(
        "INTERNAL_ERROR",
        UNEXPECTED_SERVER_RESPONSE_MESSAGE
      ),
    };
  }

  // MINIMUM sanity check: the body must be a non-null object. Guards
  // against a well-formed JSON primitive like `null`, `0`, `"ok"`, or
  // `[]` being silently cast to TSuccess. Without this, `parsedBody as
  // TSuccess` would accept garbage — and we already enforce "no Zod
  // validation on 2xx bodies" per ADR-006, so the object-ness check is
  // the only floor between the server and the React component tree.
  if (parsedBody === null || typeof parsedBody !== "object") {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[apiClient] HTTP ${response.status} returned a non-object JSON body:`,
        parsedBody
      );
    }
    return {
      ok: false,
      error: buildClientError(
        "INTERNAL_ERROR",
        UNEXPECTED_SERVER_RESPONSE_MESSAGE
      ),
    };
  }

  // HTTP 2xx — trust the shape per ADR-006 rationale. The parsedBody has
  // already been confirmed as a non-null object above.
  if (response.ok) {
    return { ok: true, data: parsedBody as TSuccess };
  }

  // HTTP 4xx/5xx — should be an ApiError envelope with a KNOWN code.
  if (isApiErrorShape(parsedBody)) {
    return { ok: false, error: hardenServerError(parsedBody) };
  }

  // Error status but non-ApiError body — infrastructure-layer error
  // (Vercel, NGINX, a newer server sending an unknown code). Generic
  // fallback; the status goes to console.error for dev debugging but
  // NOT into the user-facing message.
  if (process.env.NODE_ENV !== "production") {
    console.error(
      `[apiClient] HTTP ${response.status} returned an unrecognized error body:`,
      parsedBody
    );
  }
  return {
    ok: false,
    error: buildClientError(
      "INTERNAL_ERROR",
      UNEXPECTED_SERVER_RESPONSE_MESSAGE
    ),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options accepted by `generateCreatives`.
 *
 * Unifies the `GenerateFnOptions` contract (used by the provider) with
 * the test-escape-hatch options (`timeoutMs`, `signal`). A single
 * function surface is simpler than maintaining two with disjoint option
 * bags — previous reviewers flagged the split as confusing.
 *
 * `onStageChange` is accepted but NOT fired by this sync implementation
 * (the POST /api/generate endpoint is one-shot). A future SSE/WebSocket
 * variant will call it.
 */
export interface GenerateCreativesOptions {
  /** Per-call timeout override. Defaults to 55 seconds. */
  timeoutMs?: number;
  /** Optional external AbortSignal (e.g., for component unmount). */
  signal?: AbortSignal;
  /**
   * Stage progress callback. Not fired by the current sync client —
   * future streaming clients will dispatch each pipeline stage here.
   * Accepted but unused; keeps the contract forward-compatible.
   */
  onStageChange?: (stage: PipelineStage) => void;
}

/**
 * Submit a campaign brief to POST /api/generate and return the outcome.
 *
 * Conforms to the `GenerateFn` contract from ADS-025 via structural
 * compatibility — `GenerateCreativesOptions` is a superset of
 * `GenerateFnOptions`, so the provider can drop this in without any type
 * gymnastics. The `_typeCheck` assertion below proves this at compile time.
 */
export async function generateCreatives(
  brief: GenerateRequestBody,
  options: GenerateCreativesOptions = {}
): Promise<GenerateOutcome> {
  // `onStageChange` is deliberately ignored — see JSDoc on
  // GenerateCreativesOptions. Referencing it explicitly here would be
  // cleaner than an eslint-disable, but the sync endpoint genuinely has
  // nothing to call it with. The field stays on the type so callers
  // can pass it today without breaking when the streaming variant lands.
  void options.onStageChange;
  return postJson<GenerateSuccessResponseBody>("/api/generate", brief, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

/**
 * Compile-time assertion that `generateCreatives` conforms to the
 * `GenerateFn` contract from ADS-025. If the two signatures ever diverge,
 * this assignment will fail to type-check — catching drift immediately
 * at build time, not at integration time.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _generateFnConformanceCheck: GenerateFn = generateCreatives;

// ---------------------------------------------------------------------------
// Upload client — two-step init + PUT (SPIKE-003 / INVESTIGATION-003)
// ---------------------------------------------------------------------------

/**
 * The result the caller gets back from a successful `uploadAsset`. The
 * `key` field is the ONE THING the caller should save into the brief's
 * `product.existingAsset` field. Signed URLs (which the key is derived
 * from) expire; keys don't. See INVESTIGATION-003 §Risk register.
 */
export interface UploadAssetResult {
  key: string;
  bytes: number;
}

/**
 * Mirror of `UploadInitRequestBody.contentType` for client-side type
 * narrowing in the guard below. Kept local rather than re-exported from
 * `./types` because the client module already owns the HTTP boundary.
 */
const ALLOWED_UPLOAD_MIME_RE = /^image\/(png|webp|jpeg)$/;

/** Local copy of the route's 10 MB cap. Duplicated intentionally: the
 * route is the authority, but client-side validation lets us fail fast
 * BEFORE the round-trip so users get a useful error without waiting.
 * If the server cap ever diverges, the server is still the final word. */
const CLIENT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Upload an image via the two-step init + PUT flow.
 *
 * 1. POST `/api/upload` with `{filename, contentType, campaignId}` — the
 *    server builds a safe storage key and returns an `uploadUrl` (local:
 *    our own `?key=...` route; S3: pre-signed PUT URL).
 * 2. PUT the file body to `uploadUrl` with the returned `headers`. In
 *    local mode the body hits our PUT handler; in S3 mode the body
 *    goes directly to S3 via the pre-signed URL, bypassing our function.
 * 3. Return the storage `key`. The caller saves this to
 *    `product.existingAsset` and submits the brief — the pipeline's
 *    `assetResolver` will find the uploaded file on `storage.exists(key)`.
 *
 * Throws on any failure. The caller (typically a React component) wraps
 * this in a try/catch for error display. Using throws here rather than a
 * Result union is intentional: upload is a one-shot mutation and the UI
 * just wants to know "did it work or not." `generateCreatives` returns
 * a Result because it feeds into the `usePipelineState` reducer; upload
 * is a simpler surface and a throw keeps the call site short.
 */
export async function uploadAsset(
  file: File,
  options: { campaignId?: string; signal?: AbortSignal } = {}
): Promise<UploadAssetResult> {
  // --- client-side guards: fail fast before the network round trip ---
  if (!ALLOWED_UPLOAD_MIME_RE.test(file.type)) {
    throw new Error(
      `Unsupported file type: ${file.type || "(missing)"}. Expected image/png, image/jpeg, or image/webp.`
    );
  }
  if (file.size === 0) {
    throw new Error("File is empty.");
  }
  if (file.size > CLIENT_MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the upload limit is ${CLIENT_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
    );
  }

  // --- Step 1: POST /api/upload (init) ---
  const initBody: UploadInitRequestBody = {
    filename: file.name,
    contentType: file.type as UploadInitRequestBody["contentType"],
    campaignId: options.campaignId,
  };
  const initResult = await postJson<UploadInitResponseBody>(
    "/api/upload",
    initBody,
    { signal: options.signal }
  );
  if (!initResult.ok) {
    // Forward the server's error message verbatim — `postJson` has
    // already hardened the ApiError envelope and stripped any leaky
    // internals via `isApiErrorShape`.
    throw new Error(initResult.error.message);
  }

  // --- Step 2: PUT the bytes ---
  // The browser sends the raw File as the body. Content-Type is
  // whatever the init handler told us to use (matches what we declared
  // above, so the magic-byte check on the server side will pass unless
  // the File object's `.type` is a lie — in which case server rejects
  // it and we surface a clean error).
  let putResponse: Response;
  try {
    putResponse = await fetch(initResult.data.uploadUrl, {
      method: initResult.data.method,
      headers: initResult.data.headers,
      body: file,
      signal: options.signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Upload was cancelled.");
    }
    throw new Error(
      "Could not reach the upload endpoint. Please check your connection and try again."
    );
  }

  if (!putResponse.ok) {
    // Try to parse the server's ApiError body for a useful message.
    // Fall back to a generic message if the body is missing or garbage.
    let serverMessage = `Upload failed with status ${putResponse.status}.`;
    try {
      const errBody = await putResponse.json();
      if (errBody && typeof errBody.message === "string") {
        serverMessage = errBody.message;
      }
    } catch {
      // ignore — the fallback message is already set
    }
    throw new Error(serverMessage);
  }

  return { key: initResult.data.key, bytes: file.size };
}
