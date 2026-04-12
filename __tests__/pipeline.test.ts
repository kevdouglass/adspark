import { describe, it, expect, beforeEach, vi } from "vitest";
import OpenAI from "openai";
import sharp from "sharp";
import { runPipeline } from "@/lib/pipeline/pipeline";
import type {
  CampaignBrief,
  PipelineStage,
  StorageProvider,
} from "@/lib/pipeline/types";
import type { RequestContext } from "@/lib/api/services";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a valid PNG buffer encoded as base64 (for mock DALL-E responses) */
async function createTestPngBase64(
  width: number = 1024,
  height: number = 1024
): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#F4A261",
    },
  })
    .png()
    .toBuffer();
  return buffer.toString("base64");
}

async function createTestPngBuffer(
  width: number = 1024,
  height: number = 1024
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#2A9D8F",
    },
  })
    .png()
    .toBuffer();
}

/** In-memory StorageProvider for isolated tests */
class InMemoryStorage implements StorageProvider {
  public readonly saved = new Map<string, Buffer>();
  public readonly existsKeys = new Set<string>();
  public readonly preloadedBuffers = new Map<string, Buffer>();
  public failOnSaveKey: string | null = null;

  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    if (this.failOnSaveKey && key.includes(this.failOnSaveKey)) {
      throw new Error(`Storage save failure for key: ${key}`);
    }
    this.saved.set(key, data);
    return key;
  }

  async exists(key: string): Promise<boolean> {
    return this.existsKeys.has(key) || this.preloadedBuffers.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `https://storage.test/${encodeURIComponent(key)}`;
  }

  async load(key: string): Promise<Buffer | null> {
    if (this.preloadedBuffers.has(key)) {
      return this.preloadedBuffers.get(key)!;
    }
    return this.saved.get(key) ?? null;
  }

  /** Mark a product asset as existing in storage (for reused-asset tests) */
  async preloadAsset(key: string, buffer: Buffer): Promise<void> {
    this.preloadedBuffers.set(key, buffer);
    this.existsKeys.add(key);
  }
}

function createMockOpenAIClient(
  base64Png: string,
  options: { failCallNumbers?: number[] } = {}
): OpenAI {
  let callCount = 0;
  const { failCallNumbers = [] } = options;

  return {
    images: {
      generate: vi.fn(async () => {
        callCount++;
        if (failCallNumbers.includes(callCount)) {
          throw new OpenAI.APIError(
            400,
            { message: "Content policy violation" },
            "Content policy violation",
            {}
          );
        }
        return { data: [{ b64_json: base64Png }] };
      }),
    },
  } as unknown as OpenAI;
}

function createTestBrief(): CampaignBrief {
  return {
    campaign: {
      id: "test-campaign-2026",
      name: "Test Campaign",
      message: "Stay Protected All Summer",
      targetRegion: "North America",
      targetAudience: "Outdoor enthusiasts",
      tone: "vibrant",
      season: "summer",
    },
    products: [
      {
        name: "SPF 50 Sunscreen",
        slug: "spf-50-sunscreen",
        description: "Reef-safe mineral sunscreen",
        category: "sun protection",
        keyFeatures: ["reef-safe", "mineral"],
        color: "#F4A261",
        existingAsset: null,
      },
      {
        name: "After-Sun Aloe Gel",
        slug: "aloe-gel",
        description: "Organic aloe vera gel with vitamin E",
        category: "after-sun care",
        keyFeatures: ["organic", "vitamin E"],
        color: "#2A9D8F",
        existingAsset: null,
      },
    ],
    aspectRatios: ["1:1", "9:16", "16:9"],
    outputFormats: { creative: "png", thumbnail: "webp" },
  };
}

function createTestRequestContext(): RequestContext {
  return {
    requestId: "test-request-uuid",
    startedAtPerfMs: performance.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPipeline", () => {
  let storage: InMemoryStorage;
  let brief: CampaignBrief;
  let ctx: RequestContext;

  beforeEach(() => {
    storage = new InMemoryStorage();
    brief = createTestBrief();
    ctx = createTestRequestContext();
  });

  it("happy path — generates 6 creatives end-to-end", async () => {
    const base64Png = await createTestPngBase64();
    const client = createMockOpenAIClient(base64Png);

    const result = await runPipeline(brief, storage, client, ctx);

    expect(result.creatives).toHaveLength(6);
    expect(result.errors).toHaveLength(0);
    expect(result.totalImages).toBe(6);
    expect(result.totalTimeMs).toBeGreaterThan(0);
    expect(result.campaignId).toBe("test-campaign-2026");

    // Verify all 3 aspect ratios for both products
    const ratios = result.creatives.map((c) => `${c.productSlug}:${c.aspectRatio}`);
    expect(ratios).toContain("spf-50-sunscreen:1:1");
    expect(ratios).toContain("spf-50-sunscreen:9:16");
    expect(ratios).toContain("spf-50-sunscreen:16:9");
    expect(ratios).toContain("aloe-gel:1:1");
    expect(ratios).toContain("aloe-gel:9:16");
    expect(ratios).toContain("aloe-gel:16:9");

    // Storage should have: 6 creative PNGs + 6 thumbnails + manifest + brief = 14
    expect(storage.saved.size).toBe(14);
  });

  it("partial failure — 5/6 succeed, 1 content policy rejection", async () => {
    const base64Png = await createTestPngBase64();
    // Fail the 3rd DALL-E call (content policy = non-retryable)
    const client = createMockOpenAIClient(base64Png, { failCallNumbers: [3] });

    const result = await runPipeline(brief, storage, client, ctx);

    expect(result.creatives).toHaveLength(5);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    const generationErrors = result.errors.filter(
      (e) => e.stage === "generating"
    );
    expect(generationErrors).toHaveLength(1);
    expect(generationErrors[0].retryable).toBe(false);

    // Manifest should still be written reflecting partial state
    const manifestEntry = storage.saved.get(
      "test-campaign-2026/manifest.json"
    );
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(manifestEntry!.toString("utf-8"));
    expect(manifest.totalImages).toBe(5);
  });

  it("reused asset path — product with existingAsset skips DALL-E", async () => {
    // Set up: spf-50 product has an existing asset preloaded in storage
    const existingAssetKey = "assets/spf-50-hero.png";
    const existingAssetBuffer = await createTestPngBuffer(1024, 1024);
    await storage.preloadAsset(existingAssetKey, existingAssetBuffer);

    // Update brief to reference the existing asset for spf-50 only
    brief.products[0].existingAsset = existingAssetKey;

    const base64Png = await createTestPngBase64();
    const client = createMockOpenAIClient(base64Png);

    const result = await runPipeline(brief, storage, client, ctx);

    // Should still produce 6 creatives (3 reused for spf-50 + 3 generated for aloe-gel)
    expect(result.creatives).toHaveLength(6);
    expect(result.errors).toHaveLength(0);

    // OpenAI should only be called 3 times (aloe-gel × 3 ratios)
    // spf-50 reuses the existing asset for all 3 ratios
    expect(client.images.generate).toHaveBeenCalledTimes(3);

    // Verify the reused product has generationTimeMs = 0 in the manifest
    const manifestEntry = storage.saved.get(
      "test-campaign-2026/manifest.json"
    );
    const manifest = JSON.parse(manifestEntry!.toString("utf-8"));
    const spfProduct = manifest.products.find(
      (p: { slug: string }) => p.slug === "spf-50-sunscreen"
    );
    expect(spfProduct.creatives[0].generationTimeMs).toBe(0);
  });

  it("invokes onStageChange callback for each pipeline stage", async () => {
    const base64Png = await createTestPngBase64();
    const client = createMockOpenAIClient(base64Png);
    const observedStages: PipelineStage[] = [];

    await runPipeline(brief, storage, client, ctx, {
      onStageChange: (stage) => observedStages.push(stage),
    });

    // Should observe the full state sequence
    expect(observedStages).toContain("validating");
    expect(observedStages).toContain("resolving");
    expect(observedStages).toContain("generating");
    expect(observedStages).toContain("compositing");
    expect(observedStages).toContain("organizing");
    expect(observedStages).toContain("complete");

    // Order should match pipeline flow
    const validatingIndex = observedStages.indexOf("validating");
    const completeIndex = observedStages.indexOf("complete");
    expect(validatingIndex).toBeLessThan(completeIndex);
  });

  it("tracks timing instrumentation across all stages", async () => {
    const base64Png = await createTestPngBase64();
    const client = createMockOpenAIClient(base64Png);

    const result = await runPipeline(brief, storage, client, ctx);

    // Total time should be positive
    expect(result.totalTimeMs).toBeGreaterThan(0);

    // Each creative should have timing metadata
    for (const creative of result.creatives) {
      expect(creative.compositingTimeMs).toBeGreaterThanOrEqual(0);
      expect(creative.generationTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles empty products (validation edge case)", async () => {
    // Build a brief with no products to simulate an edge case
    // Note: Zod schema requires min 1 product, so this would fail validation
    const emptyBrief = {
      ...brief,
      products: [],
    };

    const base64Png = await createTestPngBase64();
    const client = createMockOpenAIClient(base64Png);

    const result = await runPipeline(emptyBrief, storage, client, ctx);

    // Should fail at validation stage
    expect(result.creatives).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].stage).toBe("validating");
  });

  it("does not throw on partial failures (returns result with errors)", async () => {
    const base64Png = await createTestPngBase64();
    // Fail DALL-E calls 1, 2, 3 (content policy)
    const client = createMockOpenAIClient(base64Png, {
      failCallNumbers: [1, 2, 3],
    });

    // Should NOT throw — returns result with errors
    const result = await runPipeline(brief, storage, client, ctx);

    expect(result.creatives).toHaveLength(3); // Only 3 succeed (aloe-gel)
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.totalImages).toBe(3);
  });
});
