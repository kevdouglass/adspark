/**
 * Unit tests for the sessions API client (lib/api/sessions/client.ts).
 *
 * The sessions client is a thin fetch wrapper that defines the HTTP
 * contract between the session UI and the (not-yet-implemented)
 * /api/sessions/* backend routes. These tests pin that contract down
 * so when the backend is built, the route handlers know exactly:
 *
 *   - which URL each method hits
 *   - which HTTP verb each method uses
 *   - which request body shape (if any) is serialized
 *   - which response shape each method expects to parse
 *   - how non-2xx responses are surfaced to the caller
 *
 * Follows the same `vi.stubGlobal("fetch", ...)` pattern used by
 * __tests__/apiClient.test.ts so no real network traffic occurs.
 *
 * Scope boundary: these are CLIENT tests, not backend tests. They
 * assert what the client SENDS and how it PARSES. They do not — and
 * cannot — prove the backend behaves correctly. When the backend
 * lands, it needs its own route tests that mirror this contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sessionsClient } from "@/lib/api/sessions/client";
import type {
  CampaignBriefDto,
  CampaignSessionDto,
  GenerationRunDto,
} from "@/lib/api/sessions/dtos";

// ---------------------------------------------------------------------------
// Fetch mock setup
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
// Fixtures — minimal valid DTO shapes. We only fill fields the client reads.
// ---------------------------------------------------------------------------

const sampleBrief: CampaignBriefDto = {
  campaign: {
    id: "camp_1",
    name: "Test Campaign",
    message: "Summer vibes",
    targetRegion: "US-West",
    targetAudience: "Millennials",
  },
  products: [
    {
      name: "Test Product",
      slug: "test-product",
      description: "Nice thing",
    },
  ],
  aspectRatios: ["1:1"],
};

const sampleSession: CampaignSessionDto = {
  id: "sess_1",
  title: "Summer 2026 Launch",
  createdAt: "2026-04-15T12:00:00.000Z",
  updatedAt: "2026-04-15T12:00:00.000Z",
  status: "draft",
  brief: sampleBrief,
};

const sampleRun: GenerationRunDto = {
  id: "run_1",
  sessionId: "sess_1",
  createdAt: "2026-04-15T12:05:00.000Z",
  status: "completed",
  totalImages: 6,
  totalTimeMs: 45_000,
};

// Helper — build a JSON Response for fetchMock.mockResolvedValueOnce.
// We construct plain objects instead of using the global `Response`
// constructor so the test does not depend on an undici runtime.
function jsonResponse(body: unknown, status = 200): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// sessionsClient.list()
// ---------------------------------------------------------------------------

describe("sessionsClient.list", () => {
  it("GETs /api/sessions and returns the sessions array from the response body", async () => {
    const sessions = [
      {
        id: "sess_1",
        title: "Summer 2026 Launch",
        updatedAtLabel: "Apr 15, 2026",
        status: "draft" as const,
      },
      {
        id: "sess_2",
        title: "Fall Coffee",
        updatedAtLabel: "Apr 14, 2026",
        status: "completed" as const,
        summary: "6 creatives generated",
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse({ sessions }));

    const result = await sessionsClient.list();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions", { method: "GET" });
    expect(result).toEqual(sessions);
  });

  it("throws with the response body text when the server returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse("Database unavailable", 503)
    );

    await expect(sessionsClient.list()).rejects.toThrow("Database unavailable");
  });

  it("throws a generic status message when the error body is empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("", 500));

    await expect(sessionsClient.list()).rejects.toThrow(
      "Request failed with 500"
    );
  });
});

// ---------------------------------------------------------------------------
// sessionsClient.create()
// ---------------------------------------------------------------------------

describe("sessionsClient.create", () => {
  it("POSTs /api/sessions with a JSON body and unwraps { session }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ session: sampleSession })
    );

    const result = await sessionsClient.create({
      title: "Summer 2026 Launch",
      brief: sampleBrief,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Summer 2026 Launch",
      brief: sampleBrief,
    });
    expect(result).toEqual(sampleSession);
  });

  it("accepts an empty input object (backend decides the title)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ session: sampleSession })
    );

    await sessionsClient.create({});

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("throws when the server responds with 400", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("Invalid brief", 400));

    await expect(sessionsClient.create({})).rejects.toThrow("Invalid brief");
  });
});

// ---------------------------------------------------------------------------
// sessionsClient.get()
// ---------------------------------------------------------------------------

describe("sessionsClient.get", () => {
  it("GETs /api/sessions/{id} and unwraps { session }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ session: sampleSession })
    );

    const result = await sessionsClient.get("sess_1");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/sess_1", {
      method: "GET",
    });
    expect(result).toEqual(sampleSession);
  });

  it("throws when the session does not exist (404)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("Not found", 404));

    await expect(sessionsClient.get("missing")).rejects.toThrow("Not found");
  });
});

// ---------------------------------------------------------------------------
// sessionsClient.updateBrief()
// ---------------------------------------------------------------------------

describe("sessionsClient.updateBrief", () => {
  it("PUTs /api/sessions/{id}/brief with { brief } body and resolves void", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const result = await sessionsClient.updateBrief("sess_1", sampleBrief);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/sess_1/brief");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ brief: sampleBrief });
    expect(result).toBeUndefined();
  });

  it("throws when the brief fails server-side validation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse("brief.campaign.message too long", 422)
    );

    await expect(
      sessionsClient.updateBrief("sess_1", sampleBrief)
    ).rejects.toThrow("brief.campaign.message too long");
  });
});

// ---------------------------------------------------------------------------
// sessionsClient.listRuns()
// ---------------------------------------------------------------------------

describe("sessionsClient.listRuns", () => {
  it("GETs /api/sessions/{id}/runs and unwraps { runs }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ runs: [sampleRun] })
    );

    const result = await sessionsClient.listRuns("sess_1");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/sess_1/runs", {
      method: "GET",
    });
    expect(result).toEqual([sampleRun]);
  });

  it("returns an empty array when the session has no runs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }));

    const result = await sessionsClient.listRuns("sess_1");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sessionsClient.generate()
// ---------------------------------------------------------------------------

describe("sessionsClient.generate", () => {
  it("POSTs /api/sessions/{id}/generate and returns the raw Response", async () => {
    const rawResponse = jsonResponse({ runId: "run_1" });
    fetchMock.mockResolvedValueOnce(rawResponse);

    const result = await sessionsClient.generate("sess_1");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/sess_1/generate", {
      method: "POST",
    });
    // generate() intentionally returns the raw Response so the caller
    // can decide how to consume it (SSE stream, await json(), etc).
    expect(result).toBe(rawResponse);
  });

  it("throws before returning the Response when the server errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("Quota exceeded", 429));

    await expect(sessionsClient.generate("sess_1")).rejects.toThrow(
      "Quota exceeded"
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP contract summary (the reason this file exists)
// ---------------------------------------------------------------------------
//
// These tests collectively pin down the following contract. The backend
// implementer uses this as the spec:
//
//   | Method                 | Path                              | Body            | Response (200)            |
//   | ---------------------- | --------------------------------- | --------------- | ------------------------- |
//   | GET                    | /api/sessions                     | -               | { sessions: […] }         |
//   | POST                   | /api/sessions                     | { title?, brief?} | { session: CampaignSessionDto } |
//   | GET                    | /api/sessions/{id}                | -               | { session: CampaignSessionDto } |
//   | PUT                    | /api/sessions/{id}/brief          | { brief }       | {} (body ignored)         |
//   | GET                    | /api/sessions/{id}/runs           | -               | { runs: [GenerationRunDto] } |
//   | POST                   | /api/sessions/{id}/generate       | -               | caller-consumed Response  |
//
// Non-2xx error contract: the client surfaces `response.text()` as the
// Error.message. When text is empty, the message is `Request failed with {status}`.
// Backend handlers SHOULD return a human-readable error string in the body
// (plain text or JSON — both are read via .text()).
