/**
 * Unit tests for the frontend API client (lib/api/client.ts).
 *
 * The client is the HTTP boundary — it wraps `fetch` and translates
 * network/parse/status failures into a typed `GenerateOutcome` Result
 * union. These tests mock `globalThis.fetch` via `vi.stubGlobal` so no
 * real network traffic happens, and they exercise every branch of the
 * error-classification logic.
 *
 * What these tests prove:
 * 1. Happy path: HTTP 200 with a well-formed object body → `{ ok: true, data }`
 * 2. Minimum sanity check: 200 with `null`, primitive, or array body → INTERNAL_ERROR
 * 3. Server-side ApiError (4xx/5xx with known code) passes through unchanged
 * 4. Server-side error with unknown `code` → INTERNAL_ERROR (strict enum check)
 * 5. Server-side error with non-ApiError body (HTML, wrong shape) → INTERNAL_ERROR
 * 6. `response.json()` failure (non-JSON body) → INTERNAL_ERROR
 * 7. External `AbortSignal` cancellation → `CLIENT_ABORTED`
 * 8. `AbortSignal.timeout` firing → `CLIENT_TIMEOUT`
 * 9. Generic fetch rejection → `CLIENT_NETWORK_ERROR`
 * 10. `crypto.randomUUID` unavailable → fallback id still works, no throw
 * 11. Server-forged `client-*` requestId → rewritten to `srv-rewritten-*`
 * 12. `onStageChange` option accepted but not fired (sync endpoint)
 * 13. Sanitization: no raw exception messages in user-facing error
 * 14. Correlation IDs: unique per error, `client-` prefix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateCreatives } from "@/lib/api/client";
import { VALID_BRIEF, SUCCESS_RESULT } from "./fixtures/pipelineFixtures";
import type { ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Mock setup — stubGlobal ensures proper cleanup across parallel test files
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helpers — construct Response-like objects for the mock to return
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
    fetchMock.mockResolvedValue(jsonResponse(200, SUCCESS_RESULT));
    const onStageChange = vi.fn();

    const outcome = await generateCreatives(VALID_BRIEF, { onStageChange });

    expect(outcome.ok).toBe(true);
    expect(onStageChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group 2: Minimum sanity check on 2xx bodies (H1 fix)
// ---------------------------------------------------------------------------

describe("generateCreatives — 2xx sanity check", () => {
  it("rejects HTTP 200 with body `null` as INTERNAL_ERROR (not silent cast)", async () => {
    // JSON.parse('null') === null. Valid JSON, valid response body, but
    // obviously not a GenerateSuccessResponseBody. Must NOT be cast to
    // TSuccess and returned as ok:true.
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  it("rejects HTTP 200 with a primitive body (string) as INTERNAL_ERROR", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, "ok"));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("rejects HTTP 200 with a primitive body (number) as INTERNAL_ERROR", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, 0));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("rejects HTTP 200 with non-JSON body as INTERNAL_ERROR", async () => {
    fetchMock.mockResolvedValue(
      new Response("{ not json }", { status: 200 })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("accepts HTTP 200 with an array body — array is typeof object", async () => {
    // Note: arrays ARE objects in JS (`typeof [] === 'object'`). The
    // sanity check only catches null/primitives. If the backend ever
    // returns `[]` as a 200 body, the client will pass it through; the
    // hook would then try to access `.creatives` on an array, which
    // would be `undefined` and surface as a downstream error. This test
    // LOCKS IN that behavior so a future "also reject arrays" change
    // is a deliberate decision, not accidental.
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    const outcome = await generateCreatives(VALID_BRIEF);

    // Current contract: arrays pass through the sanity check.
    expect(outcome.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Server-side ApiError passthrough (with strict code validation)
// ---------------------------------------------------------------------------

describe("generateCreatives — server-side ApiError responses", () => {
  it("passes through a 400 INVALID_BRIEF error unchanged (server requestId preserved)", async () => {
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
      expect(outcome.error.requestId).toBe("server-abc-123");
    }
  });

  it("passes through a 422 CONTENT_POLICY_VIOLATION", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        code: "CONTENT_POLICY_VIOLATION",
        message: "Prompt rejected by content policy",
        requestId: "server-def-456",
      })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CONTENT_POLICY_VIOLATION");
      expect(outcome.error.requestId).toBe("server-def-456");
    }
  });

  it("passes through a 500 STORAGE_ERROR", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        code: "STORAGE_ERROR",
        message: "Failed to save generated creatives",
        requestId: "server-ghi-789",
      })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    if (!outcome.ok) {
      expect(outcome.error.code).toBe("STORAGE_ERROR");
    }
  });

  // M4 fix: strict code validation
  it("rejects a 500 with structurally-matching but UNKNOWN code as INTERNAL_ERROR", async () => {
    // Server sends a body that matches {code, message, requestId}
    // structurally but the `code` is not in KNOWN_API_ERROR_CODES.
    // Could be a newer server version, a bug, or a hostile server.
    // The client must NOT pass the unknown code through to downstream
    // switch statements.
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        code: "MADE_UP_FUTURE_CODE",
        message: "some message",
        requestId: "server-xyz",
      })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      // Client-generated requestId, not the server's "server-xyz"
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  // M4 fix: details validation
  it("rejects a 400 whose details array contains non-strings as INTERNAL_ERROR", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        code: "INVALID_BRIEF",
        message: "Validation failed",
        requestId: "server-abc",
        details: ["field.name: required", 123, { not: "a string" }],
      })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });

  // M5 fix: server forgery of client-* requestId prefix
  it("rewrites a server-forged `client-*` requestId to `srv-rewritten-*`", async () => {
    // A compromised or misconfigured server sends a requestId that
    // starts with `client-`, poisoning the namespace the client uses to
    // distinguish its own errors from server errors. The hardening
    // helper strips and prefixes the forged value so support engineers
    // can tell them apart.
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        code: "INTERNAL_ERROR",
        message: "Something failed",
        requestId: "client-forged-abc",
      })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.requestId).toBe("srv-rewritten-client-forged-abc");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: Malformed server responses (non-ApiError bodies)
// ---------------------------------------------------------------------------

describe("generateCreatives — malformed server responses", () => {
  it("falls back to INTERNAL_ERROR when HTTP 500 returns an HTML body", async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(500, "<html>Server Error</html>")
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      expect(outcome.error.requestId).toMatch(/^client-/);
      // L12 fix: status code must NOT appear in the user-facing message
      expect(outcome.error.message).not.toMatch(/500/);
      expect(outcome.error.message).not.toMatch(/HTTP/);
    }
  });

  it("falls back to INTERNAL_ERROR when HTTP 500 returns a plain string body (non-JSON)", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json at all", { status: 500 })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      expect(outcome.error.message).not.toMatch(/500/);
    }
  });

  it("falls back to INTERNAL_ERROR when HTTP 400 returns a JSON body with no code field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "something went wrong", notOurShape: true })
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  it("falls back to INTERNAL_ERROR on HTTP 204 No Content (null body)", async () => {
    // The Fetch spec forbids a body on status 204, so we must pass
    // `null` as the body. `response.json()` then throws because there's
    // nothing to parse — exercises the non-JSON fallback path.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INTERNAL_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5: Network, timeout, and abort errors
// ---------------------------------------------------------------------------

describe("generateCreatives — network + timeout + abort errors", () => {
  it("returns CLIENT_NETWORK_ERROR when fetch rejects with TypeError", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_NETWORK_ERROR");
      expect(outcome.error.requestId).toMatch(/^client-/);
      // Sanitization: raw fetch error message must NOT leak
      expect(outcome.error.message).not.toContain("fetch failed");
    }
  });

  it("returns CLIENT_TIMEOUT when fetch rejects with TimeoutError DOMException", async () => {
    fetchMock.mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      )
    );

    const outcome = await generateCreatives(VALID_BRIEF);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_TIMEOUT");
      expect(outcome.error.requestId).toMatch(/^client-/);
    }
  });

  // H2 fix: external AbortSignal is NOT a network error
  it("returns CLIENT_ABORTED when fetch rejects with AbortError DOMException (external signal)", async () => {
    // User unmounted the component or explicitly aborted — NOT a
    // network failure. The UI should show a neutral "cancelled"
    // message, not "check your connection."
    fetchMock.mockRejectedValue(
      new DOMException("The user aborted a request", "AbortError")
    );

    const controller = new AbortController();
    const outcome = await generateCreatives(VALID_BRIEF, {
      signal: controller.signal,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_ABORTED");
      expect(outcome.error.requestId).toMatch(/^client-/);
      expect(outcome.error.message).toMatch(/cancelled/i);
    }
  });

  it("respects a custom timeoutMs and interpolates the value in the message", async () => {
    fetchMock.mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      )
    );

    const outcome = await generateCreatives(VALID_BRIEF, { timeoutMs: 100 });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_TIMEOUT");
      expect(outcome.error.message).toContain("100ms");
    }
  });

  it("does NOT interpolate a bogus timeoutMs when the caller supplied their own signal", async () => {
    // When the caller owns cancellation via signal, our internal timeout
    // is not installed — so the default 55000ms value is meaningless
    // relative to the caller's real budget. The message should avoid
    // lying about it.
    fetchMock.mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      )
    );

    const controller = new AbortController();
    const outcome = await generateCreatives(VALID_BRIEF, {
      signal: controller.signal,
    });

    if (!outcome.ok) {
      expect(outcome.error.code).toBe("CLIENT_TIMEOUT");
      // Must NOT leak the irrelevant default timeout value
      expect(outcome.error.message).not.toMatch(/55000/);
    }
  });

  it("generates unique client-side requestId per error (correlation)", async () => {
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

// ---------------------------------------------------------------------------
// Group 6: crypto.randomUUID availability (H3 fix)
// ---------------------------------------------------------------------------

describe("generateCreatives — crypto.randomUUID fallback", () => {
  it("still returns a Result union when crypto.randomUUID is undefined", async () => {
    // Simulate an insecure HTTP origin, older browser, or test env
    // without a crypto polyfill. The client must NOT throw from the
    // error-handling path — that would break the Result-union contract
    // at exactly the moment error handling must work.
    //
    // We stub `crypto.randomUUID` to throw if called — the fallback
    // path should be taken before we even get here.
    const originalCrypto = globalThis.crypto;
    try {
      // Redefine crypto to one without randomUUID. Use Object.defineProperty
      // because `crypto` is a readonly property on some globals.
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: {}, // crypto exists but has no randomUUID
      });

      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const outcome = await generateCreatives(VALID_BRIEF);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        // Fallback id format: `client-${Date.now()}-${random}`
        expect(outcome.error.requestId).toMatch(/^client-\d+-[a-z0-9]+$/);
        expect(outcome.error.code).toBe("CLIENT_NETWORK_ERROR");
      }
    } finally {
      // Restore for subsequent tests
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: originalCrypto,
      });
    }
  });
});
