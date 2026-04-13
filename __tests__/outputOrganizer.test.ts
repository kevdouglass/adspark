import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import {
  organizeOutput,
  OrganizationError,
} from "@/lib/pipeline/outputOrganizer";
import type {
  CampaignBrief,
  Creative,
  StorageProvider,
  AspectRatio,
  ImageDimensions,
} from "@/lib/pipeline/types";
import type { RequestContext } from "@/lib/api/services";

// ---------------------------------------------------------------------------
// Mock StorageProvider — in-memory Map for isolated tests
// ---------------------------------------------------------------------------

class MockStorageProvider implements StorageProvider {
  public readonly saved = new Map<string, { data: Buffer; contentType: string }>();
  public failOnKey: string | null = null;

  async save(key: string, data: Buffer, contentType: string): Promise<string> {
    if (this.failOnKey && key.includes(this.failOnKey)) {
      throw new Error(`Mock storage failure for key: ${key}`);
    }
    this.saved.set(key, { data, contentType });
    return key;
  }

  async exists(key: string): Promise<boolean> {
    return this.saved.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `https://mock-storage/${encodeURIComponent(key)}`;
  }

  async load(key: string): Promise<Buffer | null> {
    return this.saved.get(key)?.data ?? null;
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

async function createValidPngBuffer(
  width: number = 1080,
  height: number = 1080
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

function createDimensions(aspectRatio: AspectRatio): ImageDimensions {
  const dimensionMap: Record<AspectRatio, ImageDimensions> = {
    "1:1": { width: 1080, height: 1080, dalleSize: "1024x1024" },
    "9:16": { width: 1080, height: 1920, dalleSize: "1024x1792" },
    "16:9": { width: 1200, height: 675, dalleSize: "1792x1024" },
  };
  return dimensionMap[aspectRatio];
}

async function createCreative(
  productSlug: string,
  productName: string,
  aspectRatio: AspectRatio
): Promise<Creative> {
  const dimensions = createDimensions(aspectRatio);
  const imageBuffer = await createValidPngBuffer(
    dimensions.width,
    dimensions.height
  );
  return {
    product: {
      name: productName,
      slug: productSlug,
      description: "Test product description",
      category: "sun protection",
      keyFeatures: ["reef-safe"],
      color: "#F4A261",
      existingAsset: null,
    },
    aspectRatio,
    dimensions,
    prompt: `A premium ${productName} product in ${aspectRatio} format`,
    imageBuffer,
    generationTimeMs: 14200,
    compositingTimeMs: 480,
  };
}

const TEST_BRIEF: CampaignBrief = {
  campaign: {
    id: "summer-2026-suncare",
    name: "Summer Sun Protection 2026",
    message: "Stay Protected All Summer",
    targetRegion: "North America",
    targetAudience: "Outdoor enthusiasts",
    tone: "vibrant",
    season: "summer",
  },
  products: [],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

const TEST_REQUEST_CONTEXT: RequestContext = {
  requestId: "test-request-uuid-1234",
  startedAtPerfMs: 0,
  log: () => {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("organizeOutput", () => {
  let mockStorage: MockStorageProvider;
  let allCreatives: Creative[];

  beforeEach(async () => {
    mockStorage = new MockStorageProvider();
    allCreatives = [
      await createCreative("spf-50-sunscreen", "SPF 50 Sunscreen", "1:1"),
      await createCreative("spf-50-sunscreen", "SPF 50 Sunscreen", "9:16"),
      await createCreative("spf-50-sunscreen", "SPF 50 Sunscreen", "16:9"),
      await createCreative("aloe-gel", "After-Sun Aloe Gel", "1:1"),
      await createCreative("aloe-gel", "After-Sun Aloe Gel", "9:16"),
      await createCreative("aloe-gel", "After-Sun Aloe Gel", "16:9"),
    ];
  });

  it("saves 14 files for 6 creatives (6 PNG + 6 WebP + manifest + brief)", async () => {
    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    expect(mockStorage.saved.size).toBe(14);
    expect(result.creatives).toHaveLength(6);
    expect(result.errors).toHaveLength(0);
  });

  it("uses path-safe folder names (1x1, 9x16, 16x9 — not 1:1)", async () => {
    await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    const savedKeys = Array.from(mockStorage.saved.keys());
    // No key should contain a colon (invalid in Windows paths / problematic in S3)
    savedKeys.forEach((key) => {
      expect(key).not.toContain(":");
    });

    // Verify the expected folder names exist
    expect(
      savedKeys.some((key) => key.includes("/1x1/creative.png"))
    ).toBe(true);
    expect(
      savedKeys.some((key) => key.includes("/9x16/creative.png"))
    ).toBe(true);
    expect(
      savedKeys.some((key) => key.includes("/16x9/creative.png"))
    ).toBe(true);
  });

  it("writes manifest.json with correct structure", async () => {
    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    const manifestEntry = mockStorage.saved.get("summer-2026-suncare/manifest.json");
    expect(manifestEntry).toBeDefined();
    expect(manifestEntry!.contentType).toBe("application/json");

    const manifest = JSON.parse(manifestEntry!.data.toString("utf-8"));
    expect(manifest.requestId).toBe(TEST_REQUEST_CONTEXT.requestId);
    expect(manifest.campaignId).toBe("summer-2026-suncare");
    expect(manifest.totalImages).toBe(6);
    expect(typeof manifest.totalTimeMs).toBe("number");
    expect(manifest.products).toHaveLength(2); // 2 products
    expect(manifest.products[0].creatives).toHaveLength(3); // 3 ratios per product
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Spec schema: creative entries use `ratio`, `path`, `model`, `textOverlay`
    const firstCreative = manifest.products[0].creatives[0];
    expect(firstCreative.ratio).toBeDefined();
    expect(firstCreative.path).toBeDefined();
    expect(firstCreative.thumbnailPath).toBeDefined();
    expect(firstCreative.model).toBe("dall-e-3");
    expect(firstCreative.textOverlay).toBe(TEST_BRIEF.campaign.message);
    expect(firstCreative.generationTimeMs).toBeGreaterThan(0);

    expect(result.manifestPath).toBe("summer-2026-suncare/manifest.json");
  });

  it("writes brief.json copy for reproducibility", async () => {
    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    const briefEntry = mockStorage.saved.get("summer-2026-suncare/brief.json");
    expect(briefEntry).toBeDefined();
    expect(briefEntry!.contentType).toBe("application/json");

    const savedBrief = JSON.parse(briefEntry!.data.toString("utf-8"));
    expect(savedBrief.campaign.id).toBe("summer-2026-suncare");
    expect(savedBrief.aspectRatios).toEqual(["1:1", "9:16", "16:9"]);

    expect(result.briefPath).toBe("summer-2026-suncare/brief.json");
  });

  it("returns CreativeOutput with populated URLs via storage.getUrl()", async () => {
    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    expect(result.creatives).toHaveLength(6);
    const firstOutput = result.creatives[0];
    expect(firstOutput.creativeUrl).toMatch(/^https:\/\/mock-storage\//);
    expect(firstOutput.thumbnailUrl).toMatch(/^https:\/\/mock-storage\//);
    expect(firstOutput.creativePath).toContain("creative.png");
    expect(firstOutput.thumbnailPath).toContain("thumbnail.webp");
  });

  it("handles partial failure — 5 creatives succeed, 1 fails", async () => {
    // Fail any save that matches the spf-50-sunscreen 16:9 creative
    mockStorage.failOnKey = "spf-50-sunscreen/16x9";

    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    expect(result.creatives).toHaveLength(5);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(
      result.errors.some(
        (e) =>
          e.product === "spf-50-sunscreen" &&
          e.aspectRatio === "16:9" &&
          e.stage === "organizing"
      )
    ).toBe(true);

    // Manifest should still be written, reflecting partial state
    const manifestEntry = mockStorage.saved.get(
      "summer-2026-suncare/manifest.json"
    );
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(manifestEntry!.data.toString("utf-8"));
    expect(manifest.totalImages).toBe(5);
    expect(manifest.creativeErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty creatives array — writes manifest with zero creatives", async () => {
    const result = await organizeOutput(
      "empty-campaign",
      TEST_BRIEF,
      [],
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    expect(result.creatives).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.systemErrors).toHaveLength(0);

    // Manifest + brief should still be written
    expect(mockStorage.saved.size).toBe(2);
    expect(mockStorage.saved.has("empty-campaign/manifest.json")).toBe(true);
    expect(mockStorage.saved.has("empty-campaign/brief.json")).toBe(true);

    const manifest = JSON.parse(
      mockStorage.saved.get("empty-campaign/manifest.json")!.data.toString("utf-8")
    );
    expect(manifest.totalImages).toBe(0);
    expect(manifest.products).toHaveLength(0);
  });

  it("throws OrganizationError if manifest.json write fails", async () => {
    mockStorage.failOnKey = "manifest.json";

    await expect(
      organizeOutput(
        "summer-2026-suncare",
        TEST_BRIEF,
        allCreatives,
        mockStorage,
        TEST_REQUEST_CONTEXT
      )
    ).rejects.toThrow(OrganizationError);
  });

  it("sets OrganizationError.cause to underlying storage error", async () => {
    mockStorage.failOnKey = "manifest.json";

    let caughtError: unknown;
    try {
      await organizeOutput(
        "summer-2026-suncare",
        TEST_BRIEF,
        allCreatives,
        mockStorage,
        TEST_REQUEST_CONTEXT
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(OrganizationError);
    const orgError = caughtError as OrganizationError;
    expect(orgError.cause).toBeInstanceOf(Error);
    expect((orgError.cause as Error).message).toContain("Mock storage failure");
  });

  it("persisted manifest accurately reflects brief.json save failure", async () => {
    // brief.json fails but manifest.json succeeds — manifest on disk should
    // include the brief failure in systemErrors, not show an empty array.
    mockStorage.failOnKey = "brief.json";

    const result = await organizeOutput(
      "summer-2026-suncare",
      TEST_BRIEF,
      allCreatives,
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    // In-memory result has the systemError
    expect(result.systemErrors).toHaveLength(1);
    expect(result.systemErrors[0].message).toContain("Failed to save brief.json");

    // On-disk manifest must ALSO reflect the brief failure (not lie about state)
    const manifestEntry = mockStorage.saved.get(
      "summer-2026-suncare/manifest.json"
    );
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(manifestEntry!.data.toString("utf-8"));
    expect(manifest.systemErrors).toHaveLength(1);
    expect(manifest.systemErrors[0].message).toContain("brief.json");
  });

  it("handles thumbnail generation failure — creative marked as error, not saved", async () => {
    // Build a creative with an invalid (non-PNG) image buffer
    // Sharp.resize() on garbage data will reject
    const corruptCreative: Creative = {
      product: {
        name: "Corrupt Product",
        slug: "corrupt-product",
        description: "Test",
        category: "sun protection",
        keyFeatures: ["test"],
        color: "#000000",
        existingAsset: null,
      },
      aspectRatio: "1:1",
      dimensions: createDimensions("1:1"),
      prompt: "Test prompt",
      imageBuffer: Buffer.from("this is not a png"),
      generationTimeMs: 100,
      compositingTimeMs: 50,
    };

    const result = await organizeOutput(
      "corrupt-test",
      TEST_BRIEF,
      [corruptCreative],
      mockStorage,
      TEST_REQUEST_CONTEXT
    );

    expect(result.creatives).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].product).toBe("corrupt-product");
    expect(result.errors[0].aspectRatio).toBe("1:1");
    expect(result.errors[0].stage).toBe("organizing");
    expect(result.errors[0].message).toContain("Thumbnail generation failed");

    // Neither creative nor thumbnail should be saved (thumbnail gen failed first)
    expect(
      Array.from(mockStorage.saved.keys()).some((k) =>
        k.includes("corrupt-product")
      )
    ).toBe(false);

    // Manifest + brief should still be written
    expect(mockStorage.saved.has("corrupt-test/manifest.json")).toBe(true);
    expect(mockStorage.saved.has("corrupt-test/brief.json")).toBe(true);
  });
});
