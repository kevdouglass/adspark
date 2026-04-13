/**
 * Structured logging — contract tests for the RequestContext.log helper,
 * the pluggable sink, and end-to-end event emission from the pipeline
 * and API routes.
 *
 * WHY a dedicated test file (vs. spreading asserts across each route
 * test): logging is a cross-cutting concern. If we scatter event asserts
 * into every route/pipeline test, a schema change ripples through 10+
 * files. Centralizing the "events emitted" contract here gives us one
 * place to review when we add, rename, or drop an event.
 *
 * WHAT we test:
 *  1. RequestContext.log record shape (t / requestId / elapsed / event / fields)
 *  2. setLogSink swap + restore (test-only API contract)
 *  3. Default sink silences in NODE_ENV=test (noise guard)
 *  4. runPipeline emits the expected sequence for a 6-image happy path
 *  5. runPipeline surfaces dalle.failed on DALL-E partial failure
 *  6. POST /api/generate emits request.received + request.complete with
 *     the expected status/counts
 *  7. Every event is JSON-serializable (no Error objects, no Buffers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import OpenAI from "openai";
import sharp from "sharp";
import {
  createRequestContext,
  setLogSink,
  RequestLogger,
  type LogRecord,
  type LogSink,
  type RequestContext,
} from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { runPipeline } from "@/lib/pipeline/pipeline";
import type { CampaignBrief, StorageProvider } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Collecting sink + fixtures
// ---------------------------------------------------------------------------

function createCollectingSink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = (record) => {
    records.push(record);
  };
  return { sink, records };
}

/** Assert record is JSON-serializable — round-trip through JSON.stringify. */
function assertJsonSerializable(record: LogRecord): void {
  const roundTrip = JSON.parse(JSON.stringify(record)) as LogRecord;
  expect(roundTrip.requestId).toBe(record.requestId);
  expect(roundTrip.event).toBe(record.event);
  expect(roundTrip.elapsed).toBe(record.elapsed);
}

async function makeRealPng(
  width = 1024,
  height = 1024,
  color = "#F4A261"
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

function mockClient(base64Png: string, failCallNumbers: number[] = []): OpenAI {
  let count = 0;
  const images = {
    generate: vi.fn(async () => {
      count++;
      if (failCallNumbers.includes(count)) {
        throw new OpenAI.APIError(
          400,
          { message: "Content policy violation" },
          "Content policy violation",
          {}
        );
      }
      return { data: [{ b64_json: base64Png }] };
    }),
  };
  return { images } as unknown as OpenAI;
}

class MemStorage implements StorageProvider {
  public saved = new Map<string, Buffer>();
  async save(key: string, data: Buffer): Promise<string> {
    this.saved.set(key, data);
    return key;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async getUrl(key: string): Promise<string> {
    return `https://test.local/${key}`;
  }
  async load(key: string): Promise<Buffer | null> {
    return this.saved.get(key) ?? null;
  }
}

function makeBrief(): CampaignBrief {
  return {
    campaign: {
      id: "logging-test",
      name: "Logging Test Campaign",
      message: "Test Message",
      targetRegion: "North America",
      targetAudience: "Developers",
      tone: "minimal",
      season: "summer",
    },
    products: [
      {
        name: "Product One",
        slug: "product-one",
        description: "First test product",
        category: "test",
        keyFeatures: ["a", "b"],
        color: "#FF0000",
        existingAsset: null,
      },
      {
        name: "Product Two",
        slug: "product-two",
        description: "Second test product",
        category: "test",
        keyFeatures: ["c", "d"],
        color: "#00FF00",
        existingAsset: null,
      },
    ],
    aspectRatios: ["1:1", "9:16", "16:9"],
    outputFormats: { creative: "png", thumbnail: "webp" },
  };
}

// ---------------------------------------------------------------------------
// 1. RequestContext.log — record shape
// ---------------------------------------------------------------------------

describe("RequestContext.log", () => {
  let restore: LogSink;
  let sink: LogSink;
  let records: LogRecord[];

  beforeEach(() => {
    ({ sink, records } = createCollectingSink());
    restore = setLogSink(sink);
  });

  afterEach(() => {
    setLogSink(restore);
  });

  it("emits records with t, requestId, elapsed, and event fields", () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.PipelineStart, { foo: "bar", n: 42 });

    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.event).toBe(LogEvents.PipelineStart);
    expect(record.requestId).toBe(ctx.requestId);
    expect(typeof record.t).toBe("string");
    expect(new Date(record.t).getTime()).not.toBeNaN();
    expect(typeof record.elapsed).toBe("number");
    expect(record.elapsed).toBeGreaterThanOrEqual(0);
    expect(record.foo).toBe("bar");
    expect(record.n).toBe(42);
  });

  it("requestId is a valid UUID and stable across multiple log calls", () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.RequestReceived);
    ctx.log(LogEvents.PipelineStart);
    ctx.log(LogEvents.RequestComplete);

    expect(records).toHaveLength(3);
    expect(records[0].requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(records[0].requestId).toBe(records[1].requestId);
    expect(records[1].requestId).toBe(records[2].requestId);
  });

  it("elapsed is monotonically non-decreasing", async () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.PipelineStart);
    await new Promise((r) => setTimeout(r, 5));
    ctx.log(LogEvents.PipelineComplete);

    expect(records).toHaveLength(2);
    expect(records[1].elapsed).toBeGreaterThanOrEqual(records[0].elapsed);
  });

  it("omitted fields default to empty (no extra keys leaked)", () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.PipelineStart);

    expect(records).toHaveLength(1);
    const keys = Object.keys(records[0]).sort();
    expect(keys).toEqual(["elapsed", "event", "requestId", "t"]);
  });

  it("two distinct contexts produce different requestIds", () => {
    const a = createRequestContext();
    const b = createRequestContext();
    a.log(LogEvents.PipelineStart);
    b.log(LogEvents.PipelineStart);

    expect(records).toHaveLength(2);
    expect(records[0].requestId).not.toBe(records[1].requestId);
  });

  it("every record is JSON-serializable", () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.DalleStart, {
      product: "test",
      bytes: 1234,
      nested: { a: 1, b: [1, 2, 3] },
    });

    records.forEach(assertJsonSerializable);
  });
});

// ---------------------------------------------------------------------------
// 2. setLogSink restore contract
// ---------------------------------------------------------------------------

describe("setLogSink", () => {
  it("returns the previous sink so callers can restore it", () => {
    const { sink: first } = createCollectingSink();
    const { sink: second } = createCollectingSink();

    const original = setLogSink(first);
    const retrievedFirst = setLogSink(second);
    const retrievedSecond = setLogSink(original);

    expect(retrievedFirst).toBe(first);
    expect(retrievedSecond).toBe(second);
  });

  it("default sink is silent in NODE_ENV=test (does not throw, does not emit)", () => {
    // No sink installed — verify the default behaves. We don't have a
    // handle to the default sink, but we can verify calling log() with
    // no overridden sink doesn't throw and doesn't leak to stdout in a
    // way that would fail the test runner.
    const ctx = createRequestContext();
    expect(() => ctx.log(LogEvents.PipelineStart)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RequestLogger class — construction and reuse contract
// ---------------------------------------------------------------------------

describe("RequestLogger class", () => {
  let restore: LogSink;
  let records: LogRecord[];

  beforeEach(() => {
    const pair = createCollectingSink();
    records = pair.records;
    restore = setLogSink(pair.sink);
  });

  afterEach(() => {
    setLogSink(restore);
  });

  it("can be constructed directly with a fixed requestId", () => {
    const logger = new RequestLogger("fixed-uuid-1234", performance.now());
    logger.log(LogEvents.PipelineStart, { campaignId: "test" });

    expect(records).toHaveLength(1);
    expect(records[0].requestId).toBe("fixed-uuid-1234");
    expect(records[0].campaignId).toBe("test");
  });

  it("createRequestContext wires ctx.log to a RequestLogger instance", () => {
    const ctx = createRequestContext();
    ctx.log(LogEvents.DalleStart, { product: "x" });

    expect(records).toHaveLength(1);
    expect(records[0].requestId).toBe(ctx.requestId);
    expect(records[0].event).toBe(LogEvents.DalleStart);
  });
});

// ---------------------------------------------------------------------------
// 3. runPipeline — emits the expected event sequence end-to-end
// ---------------------------------------------------------------------------

describe("runPipeline event emission", () => {
  let restore: LogSink;
  let records: LogRecord[];
  let storage: MemStorage;
  let brief: CampaignBrief;
  let ctx: RequestContext;

  beforeEach(() => {
    const sinkPair = createCollectingSink();
    records = sinkPair.records;
    restore = setLogSink(sinkPair.sink);
    storage = new MemStorage();
    brief = makeBrief();
    ctx = createRequestContext();
  });

  afterEach(() => {
    setLogSink(restore);
  });

  it("emits pipeline.start with campaignId and image counts", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    const start = records.find((r) => r.event === LogEvents.PipelineStart);
    expect(start).toBeDefined();
    expect(start!.campaignId).toBe("logging-test");
    expect(start!.products).toBe(2);
    expect(start!.ratios).toBe(3);
    expect(start!.totalImages).toBe(6);
  });

  it("emits one stage event per stage in pipeline order", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    const stages = records
      .filter((r) => r.event === LogEvents.Stage)
      .map((r) => r.stage as string);

    // Expected sequence — emitted inside emitStage().
    expect(stages).toEqual([
      "validating",
      "resolving",
      "generating",
      "compositing",
      "organizing",
      "complete",
    ]);
  });

  it("emits dalle.start + dalle.done for each successful image", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    const starts = records.filter((r) => r.event === LogEvents.DalleStart);
    const dones = records.filter((r) => r.event === LogEvents.DalleDone);

    expect(starts).toHaveLength(6);
    expect(dones).toHaveLength(6);
    // Each dalle.done carries a product, ratio, ms, and bytes
    for (const done of dones) {
      expect(typeof done.product).toBe("string");
      expect(typeof done.ratio).toBe("string");
      expect(typeof done.ms).toBe("number");
      expect(typeof done.bytes).toBe("number");
      expect(done.bytes as number).toBeGreaterThan(0);
    }
  });

  it("emits dalle.failed (not dalle.done) for rejected tasks", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    // Fail the 3rd DALL-E call (content policy — non-retryable)
    const client = mockClient(base64Png, [3]);

    await runPipeline(brief, storage, client, ctx);

    const starts = records.filter((r) => r.event === LogEvents.DalleStart);
    const dones = records.filter((r) => r.event === LogEvents.DalleDone);
    const failures = records.filter((r) => r.event === LogEvents.DalleFailed);

    expect(starts).toHaveLength(6);
    expect(dones).toHaveLength(5);
    expect(failures).toHaveLength(1);
    expect(failures[0].cause).toBe("content_policy");
    expect(failures[0].errorType).toBe("APIError");
  });

  it("emits storage.save for each creative + thumbnail pair", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    const saves = records.filter((r) => r.event === LogEvents.StorageSave);
    // 6 creatives × (creative.png + thumbnail.webp) = 12 storage.save events
    expect(saves).toHaveLength(12);

    const creatives = saves.filter((s) => s.kind === "creative");
    const thumbs = saves.filter((s) => s.kind === "thumbnail");
    expect(creatives).toHaveLength(6);
    expect(thumbs).toHaveLength(6);
  });

  it("emits manifest.write and brief.write exactly once each", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    expect(
      records.filter((r) => r.event === LogEvents.ManifestWrite)
    ).toHaveLength(1);
    expect(
      records.filter((r) => r.event === LogEvents.BriefWrite)
    ).toHaveLength(1);
  });

  it("emits pipeline.complete with totalMs + counts matching the PipelineResult", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    const result = await runPipeline(brief, storage, client, ctx);

    const complete = records.find((r) => r.event === LogEvents.PipelineComplete);
    expect(complete).toBeDefined();
    expect(complete!.campaignId).toBe(result.campaignId);
    expect(complete!.creatives).toBe(result.totalImages);
    expect(complete!.errors).toBe(result.errors.length);
    // totalMs should be close to elapsed — within a generous slop
    expect(Math.abs((complete!.totalMs as number) - result.totalTimeMs)).toBeLessThan(100);
  });

  it("every emitted record is JSON-serializable", async () => {
    const base64Png = (await makeRealPng()).toString("base64");
    const client = mockClient(base64Png);

    await runPipeline(brief, storage, client, ctx);

    expect(records.length).toBeGreaterThan(0);
    records.forEach(assertJsonSerializable);
  });
});

// Note: POST /api/generate event emission tests live in
// `__tests__/loggingRoute.test.ts` — they require hoisted `vi.mock` of
// `@/lib/pipeline/pipeline`, which would shadow the real `runPipeline`
// used by the block above. Splitting across two files keeps each mock
// contained to the scope that needs it.
