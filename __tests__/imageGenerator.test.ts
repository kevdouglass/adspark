import { describe, it, expect, vi } from "vitest";
import { generateImage, generateImages } from "@/lib/pipeline/imageGenerator";
import type { GenerationTask } from "@/lib/pipeline/types";
import OpenAI from "openai";

// --- Test fixtures ---

/** Minimal 8x8 valid PNG (smallest possible) */
const VALID_PNG_B64 = Buffer.from(
  // PNG header + IHDR + minimal IDAT + IEND
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
).toString("base64");

const TASK: GenerationTask = {
  product: {
    name: "SPF 50 Sunscreen",
    slug: "spf-50-sunscreen",
    description: "Reef-safe mineral sunscreen",
    category: "sun protection",
    keyFeatures: ["reef-safe", "mineral"],
    color: "#F4A261",
    existingAsset: null,
  },
  aspectRatio: "1:1",
  prompt: "A premium sun protection product...",
  dimensions: { width: 1080, height: 1080, dalleSize: "1024x1024" },
};

function makeTask(
  slug: string,
  ratio: "1:1" | "9:16" | "16:9"
): GenerationTask {
  return {
    ...TASK,
    product: { ...TASK.product, slug },
    aspectRatio: ratio,
    dimensions:
      ratio === "1:1"
        ? { width: 1080, height: 1080, dalleSize: "1024x1024" }
        : ratio === "9:16"
          ? { width: 1080, height: 1920, dalleSize: "1024x1792" }
          : { width: 1200, height: 675, dalleSize: "1792x1024" },
  };
}

// --- Mock OpenAI client ---

function createMockClient(
  overrides: Partial<{
    b64_json: string | undefined;
    throwError: Error;
    throwOnCall: number;
  }> = {}
): OpenAI {
  let callCount = 0;

  return {
    images: {
      generate: vi.fn(async () => {
        callCount++;

        if (overrides.throwOnCall && callCount <= overrides.throwOnCall) {
          throw overrides.throwError ?? new Error("Mock error");
        }

        if (overrides.throwError && !overrides.throwOnCall) {
          throw overrides.throwError;
        }

        return {
          data: [{ b64_json: overrides.b64_json ?? VALID_PNG_B64 }],
        };
      }),
    },
  } as unknown as OpenAI;
}

// --- Tests ---

describe("generateImage (single)", () => {
  it("returns a GeneratedImage with valid PNG buffer on success", async () => {
    const client = createMockClient();
    const result = await generateImage(client, TASK);

    expect(result.task).toBe(TASK);
    expect(result.imageBuffer).toBeInstanceOf(Buffer);
    expect(result.imageBuffer.length).toBeGreaterThan(0);
    expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);

    // Verify PNG magic bytes
    expect(result.imageBuffer[0]).toBe(0x89);
    expect(result.imageBuffer[1]).toBe(0x50); // P
    expect(result.imageBuffer[2]).toBe(0x4e); // N
    expect(result.imageBuffer[3]).toBe(0x47); // G
  });

  it("calls DALL-E with correct parameters", async () => {
    const client = createMockClient();
    await generateImage(client, TASK);

    expect(client.images.generate).toHaveBeenCalledWith(
      {
        model: "dall-e-3",
        prompt: TASK.prompt,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
        n: 1,
      },
      // Second arg is the per-request options bag carrying the abort
      // signal from the pipeline-budget AbortController. When no signal
      // is passed in (this test invokes generateImage directly without
      // threading one), the value is `undefined`.
      { signal: undefined }
    );
  });

  it("throws on missing b64_json in response", async () => {
    // Simulate DALL-E returning data with no b64_json field
    const client = {
      images: {
        generate: vi.fn(async () => ({ data: [{}] })),
      },
    } as unknown as OpenAI;

    await expect(generateImage(client, TASK)).rejects.toThrow(
      "DALL-E returned no image data"
    );
  });

  it("throws on corrupt b64 (not valid PNG)", async () => {
    const client = createMockClient({
      b64_json: Buffer.from("not a png").toString("base64"),
    });

    await expect(generateImage(client, TASK)).rejects.toThrow(
      "invalid PNG header"
    );
  });

  // 30s timeout matches the new DALLE_RETRY_BASE_DELAY_MS = 12_000
  // (one retry sleeps 12s, plus headroom). Previously 5s when the
  // base delay was 500ms. The retry delay was raised to clear OpenAI's
  // typical Tier 1 Retry-After window (12-60s) — see imageGenerator.ts.
  it("retries on 429 rate limit then succeeds", { timeout: 30_000 }, async () => {
    const rateLimitError = new OpenAI.APIError(
      429, { message: "Rate limited" }, "Rate limited", {}
    );
    const client = createMockClient({
      throwError: rateLimitError,
      throwOnCall: 1,
    });

    const result = await generateImage(client, TASK);
    expect(result.imageBuffer).toBeInstanceOf(Buffer);
    expect(client.images.generate).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 400 content policy rejection", async () => {
    const contentPolicyError = new OpenAI.APIError(
      400, { message: "Content policy violation" }, "Content policy violation", {}
    );
    const client = createMockClient({ throwError: contentPolicyError });

    await expect(generateImage(client, TASK)).rejects.toThrow(
      "Content policy violation"
    );
    expect(client.images.generate).toHaveBeenCalledTimes(1);
  });

  // 30s timeout — see the rate-limit retry test above for rationale.
  it("retries on 500 server error", { timeout: 30_000 }, async () => {
    const serverError = new OpenAI.APIError(
      500, { message: "Server error" }, "Server error", {}
    );
    const client = createMockClient({
      throwError: serverError,
      throwOnCall: 1,
    });

    const result = await generateImage(client, TASK);
    expect(result.imageBuffer).toBeInstanceOf(Buffer);
    expect(client.images.generate).toHaveBeenCalledTimes(2);
  });
});

describe("generateImages (batch)", () => {
  const tasks = [
    makeTask("sunscreen", "1:1"),
    makeTask("sunscreen", "9:16"),
    makeTask("sunscreen", "16:9"),
    makeTask("aloe-gel", "1:1"),
    makeTask("aloe-gel", "9:16"),
    makeTask("aloe-gel", "16:9"),
  ];

  it("generates 6 images for 2 products × 3 ratios", async () => {
    const client = createMockClient();
    const { images, errors } = await generateImages(tasks, client);

    expect(images).toHaveLength(6);
    expect(errors).toHaveLength(0);
    expect(client.images.generate).toHaveBeenCalledTimes(6);
  });

  it("handles partial failure — 5 succeed, 1 fails", async () => {
    let callCount = 0;
    const client = {
      images: {
        generate: vi.fn(async () => {
          callCount++;
          // Fail the 3rd call with content policy (non-retryable)
          if (callCount === 3) {
            throw new OpenAI.APIError(
              400, { message: "Content policy" }, "Content policy", {}
            );
          }
          return { data: [{ b64_json: VALID_PNG_B64 }] };
        }),
      },
    } as unknown as OpenAI;

    const { images, errors } = await generateImages(tasks, client);

    expect(images).toHaveLength(5);
    expect(errors).toHaveLength(1);
    expect(errors[0].stage).toBe("generating");
    expect(errors[0].retryable).toBe(false);
    expect(errors[0].message).toContain("Content policy");
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const client = {
      images: {
        generate: vi.fn(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          // Simulate DALL-E latency
          await new Promise((r) => setTimeout(r, 10));
          currentConcurrent--;
          return { data: [{ b64_json: VALID_PNG_B64 }] };
        }),
      },
    } as unknown as OpenAI;

    // Positional args after (tasks, client) are: ctx, signal, concurrency.
    // This test pre-dates the ctx + signal params added for container
    // AbortController support, so they're both passed as undefined.
    await generateImages(tasks, client, undefined, undefined, 3);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it("returns empty results for empty task list (all assets cached)", async () => {
    const client = createMockClient();
    const { images, errors } = await generateImages([], client);

    expect(images).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(client.images.generate).not.toHaveBeenCalled();
  });

  it("handles total failure — 0 succeed, 6 fail", async () => {
    // Use 400 (non-retryable) so test doesn't wait for retry delays
    const client = {
      images: {
        generate: vi.fn(async () => {
          throw new OpenAI.APIError(
            400, { message: "Content policy" }, "Content policy", {}
          );
        }),
      },
    } as unknown as OpenAI;

    const { images, errors } = await generateImages(tasks, client);

    expect(images).toHaveLength(0);
    expect(errors).toHaveLength(6);
    errors.forEach((e) => {
      expect(e.stage).toBe("generating");
      expect(e.retryable).toBe(false); // 400 is not retryable
    });
  });
});
