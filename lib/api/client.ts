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
 * WHY `AbortSignal.timeout(55_000)`:
 *
 * Vercel's serverless functions have a 60-second execution ceiling. The
 * client timeout is 55s so the client-side timeout fires BEFORE the
 * server hits its hard wall — this gives us a cleaner `CLIENT_TIMEOUT`
 * error than whatever garbage a killed serverless function returns.
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
} from "./types";
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
 * Default request timeout in milliseconds. 55s leaves a 5s buffer below
 * Vercel's 60s serverless hard limit so our client-side timeout fires
 * BEFORE the server gets killed — cleaner error than a 504 from Vercel.
 */
export const DEFAULT_GENERATE_TIMEOUT_MS = 55_000;

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
