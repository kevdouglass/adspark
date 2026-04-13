/**
 * POST /api/generate — route-level logging tests.
 *
 * Separated from `logging.test.ts` because this file mocks the pipeline
 * via `vi.mock("@/lib/pipeline/pipeline")`. That hoist applies to the
 * entire file, so the real-pipeline assertions live in `logging.test.ts`
 * and the route-boundary assertions live here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setLogSink,
  type LogRecord,
  type LogSink,
} from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";

// ---------------------------------------------------------------------------
// Mocks — hoisted to the top of the file
// ---------------------------------------------------------------------------

const mockRunPipeline = vi.fn();

vi.mock("@/lib/pipeline/pipeline", () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

vi.mock("@/lib/api/services", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/services")>(
      "@/lib/api/services"
    );
  return {
    ...actual,
    getOpenAIClient: vi.fn(() => ({ images: { generate: vi.fn() } })),
    getStorage: vi.fn(() => ({
      save: vi.fn(),
      exists: vi.fn(),
      getUrl: vi.fn(),
      load: vi.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCollectingSink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = (record) => {
    records.push(record);
  };
  return { sink, records };
}

const ROUTE_BRIEF = {
  campaign: {
    id: "route-log-test",
    name: "Route Log Test",
    message: "Test",
    targetRegion: "North America",
    targetAudience: "Testers",
    tone: "minimal",
    season: "summer",
  },
  products: [
    {
      name: "Test Product",
      slug: "test-product",
      description: "Test",
      category: "test",
      keyFeatures: ["a"],
      color: "#000000",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

function routeRequest(body: unknown): Request {
  return new Request("https://test/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/generate event emission", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  let restore: LogSink;
  let records: LogRecord[];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-api-key";
    mockRunPipeline.mockReset();
    const pair = createCollectingSink();
    records = pair.records;
    restore = setLogSink(pair.sink);
  });

  afterEach(() => {
    setLogSink(restore);
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it("emits request.received at entry and request.complete at exit on success", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "route-log-test",
      creatives: [
        {
          product: { name: "Test Product", slug: "test-product" },
          aspectRatio: "1:1",
          dimensions: { width: 1080, height: 1080 },
          prompt: "prompt",
          imageBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          generationTimeMs: 1000,
          compositingTimeMs: 100,
        },
      ],
      totalTimeMs: 1500,
      totalImages: 1,
      errors: [],
    });

    const { POST } = await import("@/app/api/generate/route");
    const response = await POST(routeRequest(ROUTE_BRIEF));
    expect(response.status).toBe(200);

    const received = records.find((r) => r.event === LogEvents.RequestReceived);
    const complete = records.find((r) => r.event === LogEvents.RequestComplete);

    expect(received).toBeDefined();
    expect(received!.route).toBe("/api/generate");
    expect(received!.method).toBe("POST");

    expect(complete).toBeDefined();
    expect(complete!.status).toBe(200);
    expect(complete!.creatives).toBe(1);
    expect(complete!.errors).toBe(0);
    expect(complete!.totalMs).toBe(1500);

    // request.received and request.complete share the same requestId
    expect(received!.requestId).toBe(complete!.requestId);
  });

  it("emits request.failed on catastrophic pipeline error", async () => {
    mockRunPipeline.mockRejectedValue(new Error("catastrophic failure"));

    const { POST } = await import("@/app/api/generate/route");
    const response = await POST(routeRequest(ROUTE_BRIEF));
    expect(response.status).toBe(500);

    const failed = records.find((r) => r.event === LogEvents.RequestFailed);
    expect(failed).toBeDefined();
    expect(failed!.errorType).toBe("Error");
    expect(failed!.message).toBe("catastrophic failure");
  });

  it("still emits request.received even when the brief fails Zod validation", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const response = await POST(
      routeRequest({ campaign: {}, products: [], aspectRatios: [] })
    );
    expect(response.status).toBe(400);

    const received = records.find((r) => r.event === LogEvents.RequestReceived);
    expect(received).toBeDefined();
  });
});
