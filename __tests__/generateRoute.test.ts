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
    expect(body.message).toContain("OPENAI_API_KEY");
    expect(body.requestId).toBeDefined();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns 422 with CONTENT_POLICY_VIOLATION for content policy failures", async () => {
    mockRunPipeline.mockResolvedValue({
      campaignId: "summer-2026-suncare",
      creatives: [], // No creatives — zero-success case
      totalTimeMs: 5000,
      totalImages: 0,
      errors: [
        {
          product: "spf-50-sunscreen",
          aspectRatio: "1:1",
          stage: "generating",
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

  it("always includes requestId in both success and error responses", async () => {
    // Test 1: Success path
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

    const successResponse = await POST(createPostRequest(VALID_BRIEF));
    const successBody = await successResponse.json();
    expect(successBody.requestId).toBeDefined();

    // Test 2: Error path (validation)
    const errorResponse = await POST(
      createPostRequest({ ...VALID_BRIEF, campaign: { ...VALID_BRIEF.campaign, id: "" } })
    );
    const errorBody = await errorResponse.json();
    expect(errorBody.requestId).toBeDefined();

    // Both requestIds are valid UUIDs and DIFFERENT (per-request isolation)
    expect(successBody.requestId).not.toBe(errorBody.requestId);
  });
});
