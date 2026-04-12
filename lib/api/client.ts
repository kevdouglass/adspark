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
 * ADR-006 was written to close. We trust HTTP-2xx bodies. For non-2xx
 * bodies we use a narrow `isApiError` duck-type check because those can
 * legitimately vary (e.g., Next.js default 500 pages).
 *
 * SCOPE: Only `generateCreatives` is implemented. The ticket (ADS-026)
 * originally listed `uploadAsset` and `getCampaign` but those are out of
 * scope per CLAUDE.md's "Don't design for hypothetical future requirements":
 * - uploadAsset depends on S3 pre-signed URL flow (ADS-010, not scheduled)
 * - getCampaign depends on `/api/campaigns/[id]` which doesn't exist
 * Follow-up tickets will add them when they're actually needed.
 */

import type {
  GenerateRequestBody,
  GenerateSuccessResponseBody,
} from "./types";
import type { ApiError } from "./errors";
import type {
  GenerateFn,
  GenerateFnOptions,
  GenerateOutcome,
} from "@/lib/hooks/usePipelineState";

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
 * Generic message when the server replies with a non-JSON body on error.
 * This typically means the request hit an infrastructure layer (load
 * balancer, serverless runtime) that isn't running our error-envelope code.
 */
const NON_JSON_ERROR_MESSAGE =
  "The server returned an unexpected response. Please try again.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Narrow runtime check for the `ApiError` shape. Used only on non-2xx
 * response bodies where we need to differentiate "our server's error
 * envelope" from "some other layer returned HTML or a string."
 *
 * This is deliberately duck-typing, not Zod: the ApiError shape is
 * small (4 fields, 1 optional) and any structural match IS an ApiError
 * for our purposes. Zod here would add ~13KB for zero practical gain
 * over checking three field names.
 */
function isApiErrorShape(value: unknown): value is ApiError {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.code === "string" &&
    typeof obj.message === "string" &&
    typeof obj.requestId === "string"
  );
}

/**
 * Build a client-side `ApiError` for errors that never reached the server.
 *
 * `crypto.randomUUID()` gives a unique correlation id with a `client-`
 * prefix so logs can distinguish "client never talked to server" from
 * "server assigned this id." Modern browsers and Node 14+ both support it.
 */
function buildClientError(
  code: "CLIENT_NETWORK_ERROR" | "CLIENT_TIMEOUT" | "INTERNAL_ERROR",
  message: string
): ApiError {
  return {
    code,
    message,
    requestId: `client-${crypto.randomUUID()}`,
  };
}

// ---------------------------------------------------------------------------
// postJson — reusable POST-with-Result-union helper
// ---------------------------------------------------------------------------

interface PostJsonOptions {
  /**
   * Request timeout in milliseconds. Defaults to DEFAULT_GENERATE_TIMEOUT_MS.
   * Tests pass a small value to exercise the timeout path without waiting.
   */
  timeoutMs?: number;
  /**
   * Optional external AbortSignal. If provided, the internal timeout signal
   * is NOT created — the caller owns cancellation. Useful for React
   * components that want to abort on unmount.
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (caught) {
    // Distinguish timeout from network failure. `AbortSignal.timeout()`
    // rejects with a DOMException whose name is "TimeoutError". Other
    // fetch failures (network, DNS, CORS, aborted externally) fall through
    // to a generic network error.
    if (caught instanceof DOMException && caught.name === "TimeoutError") {
      return {
        ok: false,
        error: buildClientError(
          "CLIENT_TIMEOUT",
          `Request timed out after ${timeoutMs}ms. The server may still be processing — check again in a moment.`
        ),
      };
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
    return {
      ok: false,
      error: buildClientError("INTERNAL_ERROR", NON_JSON_ERROR_MESSAGE),
    };
  }

  // HTTP 2xx — trust the shape per ADR-006 rationale.
  if (response.ok) {
    return { ok: true, data: parsedBody as TSuccess };
  }

  // HTTP 4xx/5xx — should be an ApiError envelope. If it is, pass through.
  if (isApiErrorShape(parsedBody)) {
    return { ok: false, error: parsedBody };
  }

  // Error status but non-ApiError body — infrastructure-layer error
  // (Vercel, NGINX, etc.). Generic fallback with the status for debugging.
  return {
    ok: false,
    error: buildClientError(
      "INTERNAL_ERROR",
      `Server returned HTTP ${response.status} with an unexpected body.`
    ),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a campaign brief to POST /api/generate and return the outcome.
 *
 * Conforms to the `GenerateFn` contract from ADS-025 — the provider in
 * `usePipelineState` calls this exact signature, and consumers of the hook
 * never see HTTP.
 *
 * The `onStageChange` option is part of the contract but NOT fired by this
 * sync implementation — the current POST /api/generate endpoint is
 * one-shot (validating → ... → complete) without streaming. A future SSE
 * variant will call onStageChange for each stage transition.
 */
export const generateCreatives: GenerateFn = async (
  brief: GenerateRequestBody,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: GenerateFnOptions
): Promise<GenerateOutcome> => {
  return postJson<GenerateSuccessResponseBody>("/api/generate", brief);
};

/**
 * Lower-level variant for tests and advanced callers that want to pass a
 * custom timeout or AbortSignal. The provider uses the higher-level
 * `generateCreatives` above.
 */
export async function generateCreativesWithOptions(
  brief: GenerateRequestBody,
  options: PostJsonOptions = {}
): Promise<GenerateOutcome> {
  return postJson<GenerateSuccessResponseBody>("/api/generate", brief, options);
}
