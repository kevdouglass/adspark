/**
 * Unit tests for the frontend API client (lib/api/client.ts).
 *
 * The client is the HTTP boundary — it wraps `fetch` and translates
 * network/parse/status failures into a typed `GenerateOutcome` Result
 * union. These tests mock `globalThis.fetch` so no real network traffic
 * happens, and they exercise every branch of the error-classification
 * logic.
 *
 * What these tests prove:
 * 1. Happy path: HTTP 200 with a well-formed body → `{ ok: true, data }`
 * 2. Server-side ApiError (4xx/5xx with ApiError envelope) passes through
 *    unchanged → `{ ok: false, error }`
 * 3. Server-side error with a non-ApiError body (HTML, string, null)
 *    becomes a generic `INTERNAL_ERROR`
 * 4. `response.json()` failure (non-JSON body) → `INTERNAL_ERROR`
 * 5. `fetch` rejection with `TimeoutError` → `CLIENT_TIMEOUT`
 * 6. `fetch` rejection with any other error → `CLIENT_NETWORK_ERROR`
 * 7. Client-side errors use a `client-<uuid>` correlation id
 * 8. The exported `generateCreatives` conforms to the `GenerateFn`
 *    contract (accepts the `onStageChange` option even though it doesn't
 *    fire it on a sync endpoint)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateCreatives,
  generateCreativesWithOptions,
} from "@/lib/api/client";
import { VALID_BRIEF, SUCCESS_RESULT } from "./fixtures/pipelineFixtures";
import type { ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Mock setup — replace globalThis.fetch for every test
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helpers — construct Response-like objects for the mock to return
// ---------------------------------------------------------------------------

/**
 * Build a Response with a JSON body. Note: we use the real `Response`
 * class rather than a duck-typed object so `response.ok` and
 * `response.json()` behave exactly like the browser implementation.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a Response whose body is NOT valid JSON — simulates an HTML
 * error page from an upstream infrastructure layer.
 */
function htmlResponse(status: number, html: string): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

// ---------------------------------------------------------------------------
// Group 1: Happy path
// ---------------------------------------------------------------------------

describe("generateCreatives — happy path", () => {
  it("returns ok:true with the parsed success body on HTTP 200", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, SUCCESS_RESULT));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data).toEqual(SUCCESS_RESULT);
    }
  });

  it("posts to /api/generate with correct method and headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, SUCCESS_RESULT));

    await generateCreatives(VALID_BRIEF);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/generate");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(VALID_BRIEF);
  });

  it("accepts the onStageChange option without firing it (sync endpoint)", async () => {
    // The sync POC endpoint doesn't stream stages, so onStageChange is
    // never called. But the contract must accept the option without
    // throwing — future streaming implementations will fire it.
    fetchMock.mockResolvedValue(jsonResponse(200, SUCCESS_RESULT));
    const onStageChange = vi.fn();

    const outcome = await generateCreatives(VALID_BRIEF, { onStageChange });

    expect(outcome.ok).toBe(true);
    expect(onStageChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group 2: Server-side errors (ApiError envelope passes through)
// ---------------------------------------------------------------------------

describe("generateCreatives — server-side ApiError responses", () => {
  it("passes through a 400 INVALID_BRIEF error unchanged", async () => {
    const serverError: ApiError = {
      code: "INVALID_BRIEF",
      message: "Campaign brief validation failed",
      requestId: "server-abc-123",
      details: ["campaign.id: Campaign ID is required"],
    };
    fetchMock.mockResolvedValue(jsonResponse(400, serverError));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual(serverError);
      // Server-assigned requestId should be preserved — this is the ID
      // the user will quote in bug reports. Client MUST NOT overwrite it.
      expect(outcome.error.requestId).toBe("server-abc-123");
    }
  });

  it("passes through a 422 CONTENT_POLICY_VIOLATION unchanged", async () => {
    const serverError: ApiError = {
      code: "CONTENT_POLICY_VIOLATION",
      message: "Prompt rejected by content policy",
      requestId: "server-def-456",
    };
    fetchMock.mockResolvedValue(jsonResponse(422, serverError));

    const outcome = await generateCreatives(VALID_BRIEF);

    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CONTENT_POLICY_VIOLATION");
      expect(outcome.error.requestId).toBe("server-def-456");
    }
  });

  it("passes through a 500 STORAGE_ERROR unchanged", async () => {
    const serverError: ApiError = {
      code: "STORAGE_ERROR",
      message: "Failed to save generated creatives",
      requestId: "server-ghi-789",
    };
    fetchMock.mockResolvedValue(jsonResponse(500, serverError));

    const outcome = await generateCreatives(VALID_BRIEF);

    if (!outcome.ok) {
      expect(outcome.error.code).toBe("STORAGE_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3: Server errors with non-ApiError bodies
// ---------------------------------------------------------------------------

describe("generateCreatives — malformed server responses", () => {
  it("falls back to INTERNAL_ERROR when HTTP 500 returns an HTML body", async () => {
    // Infrastructure layer (Vercel default error page, NGINX 502, etc.)
    // that doesn't produce our ApiError envelope.
    fetchMock.mockResolvedValue(
      htmlResponse(500, "<html>Server Error</html>")
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      // Client-generated correlation id format
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  it("falls back to INTERNAL_ERROR when HTTP 500 returns a plain string body (non-JSON)", async () => {
    // Response whose body is a non-JSON string. response.json() will
    // throw when we try to parse it.
    fetchMock.mockResolvedValue(
      new Response("not json at all", { status: 500 })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("falls back to INTERNAL_ERROR when HTTP 400 returns a JSON body that is not an ApiError shape", async () => {
    // Well-formed JSON but wrong shape — e.g., a raw Zod error dump,
    // a legacy error format, or a framework default.
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "something went wrong", notOurShape: true })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      // Confirm the non-matching body did NOT pass through — requestId
      // should be client-generated, not the absent server-side id.
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  it("falls back to INTERNAL_ERROR when HTTP 200 returns non-JSON (degenerate backend)", async () => {
    // Extreme edge case: server says 200 but the body isn't JSON. This
    // shouldn't happen against our real backend, but we want a clean
    // error rather than a silent `as TSuccess` cast of garbage.
    fetchMock.mockResolvedValue(
      new Response("{ not json }", { status: 200 })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: Network and timeout errors
// ---------------------------------------------------------------------------

describe("generateCreatives — network + timeout errors", () => {
  it("returns CLIENT_NETWORK_ERROR when fetch rejects with a generic error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_NETWORK_ERROR");
      expect(outcome.error.requestId).toMatch(/^client-/);
      // Generic message — never leak the raw fetch error to the user
      expect(outcome.error.message).not.toContain("fetch failed");
    }
  });

  it("returns CLIENT_TIMEOUT when fetch rejects with a TimeoutError DOMException", async () => {
    // AbortSignal.timeout() rejects with a DOMException whose name is
    // "TimeoutError". We simulate that exact shape.
    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError"
    );
    fetchMock.mockRejectedValue(timeoutError);

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_TIMEOUT");
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  it("respects a custom timeoutMs via generateCreativesWithOptions", async () => {
    // Use the lower-level entry point with a short timeout to exercise
    // the option path without waiting for the default 55s.
    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError"
    );
    fetchMock.mockRejectedValue(timeoutError);

    const outcome = await generateCreativesWithOptions(VALID_BRIEF, {
      timeoutMs: 100,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_TIMEOUT");
      // The message should mention the custom timeout value
      expect(outcome.error.message).toContain("100ms");
    }
  });

  it("generates a unique client-side requestId for each error (correlation)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const outcome1 = await generateCreatives(VALID_BRIEF);
    const outcome2 = await generateCreatives(VALID_BRIEF);

    if (!outcome1.ok && !outcome2.ok) {
      expect(outcome1.error.requestId).not.toBe(outcome2.error.requestId);
      expect(outcome1.error.requestId).toMatch(/^client-/);
      expect(outcome2.error.requestId).toMatch(/^client-/);
    }
  });
});
