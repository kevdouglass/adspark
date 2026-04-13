import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/generate/route";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Mocks — the route is the I/O boundary, so we mock the pipeline entirely
// ---------------------------------------------------------------------------

const mockRunPipeline = vi.fn();

vi.mock("@/lib/pipeline/pipeline", () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

// Mock OpenAI client factory — we don't want real OpenAI SDK calls in tests
vi.mock("@/lib/api/services", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services")
  >("@/lib/api/services");
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
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_BRIEF = {
  campaign: {
    id: "summer-2026-suncare",
    name: "Summer 2026 Suncare",
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
  ],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

function createPostRequest(
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://test/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(bodyString.length),
      ...headers,
    },
    body: bodyString,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/generate", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-api-key";
    mockRunPipeline.mockReset();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it("returns 200 with PipelineResult on successful generation", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [
        {
          productName: "SPF 50 Sunscreen",
          productSlug: "spf-50-sunscreen",
          aspectRatio: "1:1",
          dimensions: "1080x1080",
          creativePath: "summer-2026-suncare/spf-50-sunscreen/1x1/creative.png",
          thumbnailPath:
            "summer-2026-suncare/spf-50-sunscreen/1x1/thumbnail.webp",
          creativeUrl: "https://mock/creative.png",
          thumbnailUrl: "https://mock/thumbnail.webp",
          prompt: "A premium sun protection product...",
          generationTimeMs: 14200,
          compositingTimeMs: 480,
        },
      ],
      totalTimeMs: 18000,
      totalImages: 1,
      errors: [],
    });

    const request = createPostRequest(VALID_BRIEF);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.creatives).toHaveLength(1);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(body.totalImages).toBe(1);
  });

  it("returns 400 with INVALID_BRIEF when validation fails", async () => {
    const invalidBrief = {
      ...VALID_BRIEF,
      campaign: { ...VALID_BRIEF.campaign, id: "" }, // Empty ID fails Zod
    };

    const request = createPostRequest(invalidBrief);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_BRIEF");
    expect(body.details).toBeDefined();
    expect(body.requestId).toBeDefined();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns 400 with INVALID_JSON when body is malformed", async () => {
    const request = new Request("https://test/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "19",
      },
      body: "{ not valid json }",
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_JSON");
    expect(body.requestId).toBeDefined();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns 413 with REQUEST_TOO_LARGE when body exceeds size limit", async () => {
    const oversizedBody = { data: "x".repeat(MAX_REQUEST_BODY_BYTES + 1000) };
    const request = createPostRequest(oversizedBody);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.code).toBe("REQUEST_TOO_LARGE");
    expect(body.requestId).toBeDefined();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns 500 with MISSING_CONFIGURATION when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const request = createPostRequest(VALID_BRIEF);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("MISSING_CONFIGURATION");
    // Finding #6 fix: the response message should NOT contain internal
    // details like env var names. The original error is logged server-side.
    expect(body.message).not.toContain("OPENAI_API_KEY");
    expect(body.requestId).toBeDefined();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  // --- Error mapping table tests (Finding #8: stage coverage) ---

  it("returns 422 with CONTENT_POLICY_VIOLATION for content policy failures", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 5000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "generating",
          cause: "content_policy",
          message: "Content policy violation: prompt rejected",
          retryable: false,
        },
      ],
    });

    const request = createPostRequest(VALID_BRIEF);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("CONTENT_POLICY_VIOLATION");
    expect(body.requestId).toBeDefined();
  });

  it("returns 503 with UPSTREAM_RATE_LIMITED for rate limit errors", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 5000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "generating",
          cause: "rate_limited",
          message: "Rate limited",
          retryable: true,
        },
      ],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("UPSTREAM_RATE_LIMITED");
  });

  it("returns 504 with UPSTREAM_TIMEOUT for timeout errors", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 45000,
      totalImages: 0,
      errors: [
        {
          stage: "generating",
          cause: "upstream_timeout",
          message: "Pipeline timeout budget exceeded",
          retryable: true,
        },
      ],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("returns 502 with UPSTREAM_ERROR for generic upstream failures", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 10000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "generating",
          cause: "upstream_error",
          message: "OpenAI 500",
          retryable: true,
        },
      ],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe("UPSTREAM_ERROR");
  });

  it("returns 500 with STORAGE_ERROR for organizing stage failures", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 25000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "organizing",
          cause: "storage_error",
          message: "S3 PutObject failed",
          retryable: true,
        },
      ],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("STORAGE_ERROR");
  });

  it("returns 500 with PROCESSING_ERROR for compositing stage failures", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 20000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "compositing",
          cause: "processing_error",
          message: "Canvas rendering failed",
          retryable: false,
        },
      ],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("PROCESSING_ERROR");
  });

  // --- requestId tests (Finding #11: split into 2 independent tests) ---

  it("includes requestId in successful generation responses", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [
        {
          productName: "SPF 50 Sunscreen",
          productSlug: "spf-50-sunscreen",
          aspectRatio: "1:1",
          dimensions: "1080x1080",
          creativePath: "p",
          thumbnailPath: "t",
          prompt: "p",
          generationTimeMs: 1,
          compositingTimeMs: 1,
        },
      ],
      totalTimeMs: 100,
      totalImages: 1,
      errors: [],
    });

    const response = await POST(createPostRequest(VALID_BRIEF));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("includes requestId in validation error responses", async () => {
    const invalidBrief = {
      ...VALID_BRIEF,
      campaign: { ...VALID_BRIEF.campaign, id: "" },
    };
    const response = await POST(createPostRequest(invalidBrief));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  // ---------------------------------------------------------------------------
  // SUCCESS CONTRACT TEST
  //
  // This test validates the FULL success response shape produced by
  // /api/generate. It exists as a regression guard against any layer of
  // the pipeline accidentally dropping fields, returning malformed data,
  // or mixing partial-failure shapes into the success path.
  //
  // If this test starts failing, the success contract has been broken
  // somewhere — either in pipeline.ts, in lib/api/mappers.ts, or in the
  // route handler itself. Look at what the assertion message says is
  // missing and trace it back through the layer that owns it.
  //
  // Why this is more thorough than the existing "returns 200 with
  // PipelineResult on successful generation" test:
  //   - That test only asserts 4 fields (status, creatives.length,
  //     requestId format, totalImages). Half the success contract is
  //     untested.
  //   - This test exercises a 6-image batch (2 products × 3 ratios),
  //     which is the most-scrutinized demo configuration.
  //   - Every field of every creative is asserted with a type guard,
  //     not just presence.
  //   - The pre-signed URL format is validated to make sure mappers
  //     aren't returning relative paths.
  //   - The errors array MUST be empty for a true success — partial
  //     failures should never reach this code path.
  //   - Top-level fields (campaignId, totalTimeMs, totalImages,
  //     requestId) are individually verified.
  // ---------------------------------------------------------------------------
  it("returns a complete success contract for a 6-image generation", async () => {
    // Arrange — simulate a fully successful 6-image pipeline run.
    // Every field in the resolved value mirrors what runPipeline would
    // return on the happy path, so any field added to the contract
    // later must be added here AND in the assertions below.
    const mockResult = {
      campaignId: "summer-2026-suncare",
      creatives: [
        {
          productName: "SPF 50 Mineral Sunscreen",
          productSlug: "spf-50-sunscreen",
          aspectRatio: "1:1" as const,
          dimensions: "1080x1080",
          creativePath:
            "summer-2026-suncare/spf-50-sunscreen/1x1/creative.png",
          thumbnailPath:
            "summer-2026-suncare/spf-50-sunscreen/1x1/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/1x1/creative.png?X-Amz-Signature=abc",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/1x1/thumbnail.webp?X-Amz-Signature=def",
          prompt:
            "A premium sun protection product: SPF 50 Mineral Sunscreen. Reef-safe mineral sunscreen with non-nano zinc oxide. Key features: reef-safe, mineral formula. The product's brand color palette is #F4A261. Designed for Health-conscious adults 25-45 in North America. The mood is vibrant, trustworthy, active lifestyle. Setting: warm golden-hour sunlight. Square composition. Center the product prominently. Photorealistic commercial product photography. Do not include any text. People may appear naturally in the scene.",
          generationTimeMs: 22340,
          compositingTimeMs: 412,
        },
        {
          productName: "SPF 50 Mineral Sunscreen",
          productSlug: "spf-50-sunscreen",
          aspectRatio: "9:16" as const,
          dimensions: "1080x1920",
          creativePath:
            "summer-2026-suncare/spf-50-sunscreen/9x16/creative.png",
          thumbnailPath:
            "summer-2026-suncare/spf-50-sunscreen/9x16/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/9x16/creative.png?X-Amz-Signature=ghi",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/9x16/thumbnail.webp?X-Amz-Signature=jkl",
          prompt:
            "A premium sun protection product: SPF 50 Mineral Sunscreen. Reef-safe mineral sunscreen. Vertical composition for mobile Stories/Reels. Position the product in the upper two-thirds.",
          generationTimeMs: 21890,
          compositingTimeMs: 401,
        },
        {
          productName: "SPF 50 Mineral Sunscreen",
          productSlug: "spf-50-sunscreen",
          aspectRatio: "16:9" as const,
          dimensions: "1200x675",
          creativePath:
            "summer-2026-suncare/spf-50-sunscreen/16x9/creative.png",
          thumbnailPath:
            "summer-2026-suncare/spf-50-sunscreen/16x9/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/16x9/creative.png?X-Amz-Signature=mno",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/spf-50-sunscreen/16x9/thumbnail.webp?X-Amz-Signature=pqr",
          prompt:
            "A premium sun protection product: SPF 50 Mineral Sunscreen. Wide horizontal banner composition.",
          generationTimeMs: 22102,
          compositingTimeMs: 388,
        },
        {
          productName: "After-Sun Aloe Gel",
          productSlug: "aloe-gel",
          aspectRatio: "1:1" as const,
          dimensions: "1080x1080",
          creativePath: "summer-2026-suncare/aloe-gel/1x1/creative.png",
          thumbnailPath: "summer-2026-suncare/aloe-gel/1x1/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/1x1/creative.png?X-Amz-Signature=stu",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/1x1/thumbnail.webp?X-Amz-Signature=vwx",
          prompt: "A premium skincare product: After-Sun Aloe Gel.",
          generationTimeMs: 23001,
          compositingTimeMs: 423,
        },
        {
          productName: "After-Sun Aloe Gel",
          productSlug: "aloe-gel",
          aspectRatio: "9:16" as const,
          dimensions: "1080x1920",
          creativePath: "summer-2026-suncare/aloe-gel/9x16/creative.png",
          thumbnailPath: "summer-2026-suncare/aloe-gel/9x16/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/9x16/creative.png?X-Amz-Signature=yza",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/9x16/thumbnail.webp?X-Amz-Signature=bcd",
          prompt: "A premium skincare product: After-Sun Aloe Gel.",
          generationTimeMs: 22500,
          compositingTimeMs: 405,
        },
        {
          productName: "After-Sun Aloe Gel",
          productSlug: "aloe-gel",
          aspectRatio: "16:9" as const,
          dimensions: "1200x675",
          creativePath: "summer-2026-suncare/aloe-gel/16x9/creative.png",
          thumbnailPath: "summer-2026-suncare/aloe-gel/16x9/thumbnail.webp",
          creativeUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/16x9/creative.png?X-Amz-Signature=efg",
          thumbnailUrl:
            "https://test-bucket.s3.us-east-1.amazonaws.com/summer-2026-suncare/aloe-gel/16x9/thumbnail.webp?X-Amz-Signature=hij",
          prompt: "A premium skincare product: After-Sun Aloe Gel.",
          generationTimeMs: 22250,
          compositingTimeMs: 395,
        },
      ],
      totalTimeMs: 47823,
      totalImages: 6,
      errors: [],
    };
    mockRunPipeline.mockResolvedValue(mockResult);

    // Act
    const request = createPostRequest(VALID_BRIEF);
    const response = await POST(request);
    const body = await response.json();

    // ---- Assert: HTTP layer ----
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);

    // ---- Assert: top-level shape ----
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();

    // Every required top-level field of GenerateSuccessResponseBody
    expect(body).toHaveProperty("campaignId");
    expect(body).toHaveProperty("creatives");
    expect(body).toHaveProperty("totalTimeMs");
    expect(body).toHaveProperty("totalImages");
    expect(body).toHaveProperty("errors");
    expect(body).toHaveProperty("requestId");

    // ---- Assert: top-level types and values ----
    expect(typeof body.campaignId).toBe("string");
    expect(body.campaignId).toBe("summer-2026-suncare");
    expect(Array.isArray(body.creatives)).toBe(true);
    expect(body.creatives).toHaveLength(6);
    expect(typeof body.totalTimeMs).toBe("number");
    expect(body.totalTimeMs).toBeGreaterThan(0);
    expect(typeof body.totalImages).toBe("number");
    expect(body.totalImages).toBe(6);
    expect(Array.isArray(body.errors)).toBe(true);
    // CRITICAL: a true success has zero errors. Any errors present here
    // would indicate the pipeline mixed partial-failure shape into the
    // success response.
    expect(body.errors).toHaveLength(0);
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // ---- Assert: per-creative shape (validates EVERY creative) ----
    for (const creative of body.creatives) {
      // Required fields exist
      expect(creative).toHaveProperty("productName");
      expect(creative).toHaveProperty("productSlug");
      expect(creative).toHaveProperty("aspectRatio");
      expect(creative).toHaveProperty("dimensions");
      expect(creative).toHaveProperty("creativePath");
      expect(creative).toHaveProperty("thumbnailPath");
      expect(creative).toHaveProperty("creativeUrl");
      expect(creative).toHaveProperty("thumbnailUrl");
      expect(creative).toHaveProperty("prompt");
      expect(creative).toHaveProperty("generationTimeMs");
      expect(creative).toHaveProperty("compositingTimeMs");

      // Field types
      expect(typeof creative.productName).toBe("string");
      expect(creative.productName.length).toBeGreaterThan(0);
      expect(typeof creative.productSlug).toBe("string");
      expect(creative.productSlug).toMatch(/^[a-z0-9-]+$/);
      expect(["1:1", "9:16", "16:9"]).toContain(creative.aspectRatio);
      expect(typeof creative.dimensions).toBe("string");
      expect(creative.dimensions).toMatch(/^\d+x\d+$/);
      expect(typeof creative.creativePath).toBe("string");
      expect(creative.creativePath).toMatch(/\.png$/);
      expect(typeof creative.thumbnailPath).toBe("string");
      expect(creative.thumbnailPath).toMatch(/\.webp$/);

      // Pre-signed URLs MUST be valid HTTPS URLs (no relative paths,
      // no malformed signatures, no localhost leakage)
      expect(typeof creative.creativeUrl).toBe("string");
      expect(creative.creativeUrl).toMatch(/^https:\/\//);
      expect(typeof creative.thumbnailUrl).toBe("string");
      expect(creative.thumbnailUrl).toMatch(/^https:\/\//);

      // Prompt is non-empty (catches accidentally-empty prompt builders)
      expect(typeof creative.prompt).toBe("string");
      expect(creative.prompt.length).toBeGreaterThan(0);

      // Timing fields are positive numbers (catches uninitialized timing
      // instrumentation that defaults to 0 or negative)
      expect(typeof creative.generationTimeMs).toBe("number");
      expect(creative.generationTimeMs).toBeGreaterThan(0);
      expect(typeof creative.compositingTimeMs).toBe("number");
      expect(creative.compositingTimeMs).toBeGreaterThan(0);
    }

    // ---- Assert: full set of (product × ratio) combinations is present ----
    // Catches the regression where one product or one ratio is silently
    // dropped from the response (which we observed during live debugging
    // when partial-failure shapes leaked through the success path).
    const seenCombinations = body.creatives.map(
      (c: { productSlug: string; aspectRatio: string }) =>
        `${c.productSlug}:${c.aspectRatio}`
    );
    expect(seenCombinations).toContain("spf-50-sunscreen:1:1");
    expect(seenCombinations).toContain("spf-50-sunscreen:9:16");
    expect(seenCombinations).toContain("spf-50-sunscreen:16:9");
    expect(seenCombinations).toContain("aloe-gel:1:1");
    expect(seenCombinations).toContain("aloe-gel:9:16");
    expect(seenCombinations).toContain("aloe-gel:16:9");

    // ---- Assert: response body has NO unexpected top-level fields ----
    // The success contract is closed — any new field must be a deliberate
    // addition to the response shape, not a leak from internal types.
    const expectedKeys = new Set([
      "campaignId",
      "creatives",
      "totalTimeMs",
      "totalImages",
      "errors",
      "requestId",
    ]);
    for (const key of Object.keys(body)) {
      expect(expectedKeys).toContain(key);
    }
  });

  it("generates unique requestId per request (isolation)", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [],
      totalTimeMs: 100,
      totalImages: 0,
      errors: [
        {
          stage: "validating",
          cause: "invalid_input",
          message: "test",
          retryable: false,
        },
      ],
    });

    const response1 = await POST(createPostRequest(VALID_BRIEF));
    const body1 = await response1.json();
    const response2 = await POST(createPostRequest(VALID_BRIEF));
    const body2 = await response2.json();

    expect(body1.requestId).toBeDefined();
    expect(body2.requestId).toBeDefined();
    expect(body1.requestId).not.toBe(body2.requestId);
  });
});
