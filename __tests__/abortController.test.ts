/**
 * AbortController threading — contract tests for the pipeline-level
 * preemption path added for container deployment.
 *
 * These tests lock in the behavior that the pipeline budget is now
 * PREEMPTIVE, not advisory:
 *
 *   1. A pre-aborted signal skips the DALL-E call entirely.
 *   2. Aborting mid-flight during withRetry's backoff sleep cancels
 *      the sleep and throws AbortError rather than sleeping the full
 *      delay.
 *   3. The signal is forwarded to `client.images.generate(_, { signal })`
 *      so the SDK-level fetch is cancelled too.
 *   4. Aborted tasks are reported with `cause: "upstream_timeout"` in
 *      the pipeline's error array (matching the typed error taxonomy).
 *
 * Without these tests, a future refactor that re-inlines the retry
 * helper or drops the `signal` thread through generateImages would
 * silently regress the container's only preemption guarantee.
 */

import { describe, it, expect, vi } from "vitest";
import OpenAI from "openai";
import sharp from "sharp";
import { withRetry, isRetryableOpenAIError } from "@/lib/pipeline/retry";
import { generateImages, generateImage } from "@/lib/pipeline/imageGenerator";
import type { GenerationTask } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function realPngBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#F4A261" },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

function makeTask(slug = "test", ratio: "1:1" | "9:16" | "16:9" = "1:1"): GenerationTask {
  return {
    product: {
      name: "Test Product",
      slug,
      description: "Test product description",
      category: "test",
      keyFeatures: ["a", "b"],
      color: "#FF0000",
      existingAsset: null,
    },
    aspectRatio: ratio,
    dimensions: { width: 1024, height: 1024, dalleSize: "1024x1024" },
    prompt: "Test prompt for the abort test",
  };
}

function mockClient(base64Png: string) {
  return {
    images: {
      generate: vi.fn(async (_params: unknown, opts?: { signal?: AbortSignal }) => {
        // Respect the signal inside the mock — real OpenAI SDK would
        // throw AbortError from its undici fetch. Simulate that here.
        if (opts?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return { data: [{ b64_json: base64Png }] };
      }),
    },
  } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// withRetry abort semantics
// ---------------------------------------------------------------------------

describe("withRetry abort semantics", () => {
  it("throws AbortError when signal is pre-aborted before first attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => "ok");

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        shouldRetry: () => true,
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);

    expect(fn).not.toHaveBeenCalled();
  });

  it(
    "cancels backoff sleep when signal fires mid-delay",
    async () => {
      const controller = new AbortController();
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        throw new Error("transient");
      });

      // Fire the abort after the first attempt has failed and we're
      // about to sleep. Use a short timer but longer than the first
      // attempt's resolution.
      setTimeout(() => controller.abort(), 10);

      const start = performance.now();
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          baseDelayMs: 10_000, // 10s — long enough that we MUST be interrupted
          shouldRetry: () => true,
          signal: controller.signal,
        })
      ).rejects.toThrow(/aborted/i);
      const elapsed = performance.now() - start;

      // If the abort worked, we should finish in well under 1 second.
      // If the abort was broken, we'd sleep the full 10s.
      expect(elapsed).toBeLessThan(1_000);
      expect(attempts).toBe(1);
    },
    { timeout: 5_000 }
  );

  it("calls onAttempt hook on each failed attempt", async () => {
    const onAttempt = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1, // tiny so the test is fast
        shouldRetry: () => true,
        onAttempt,
      })
    ).rejects.toThrow("always fails");

    expect(onAttempt).toHaveBeenCalledTimes(3);
    // First attempt will retry, second will retry, third will NOT retry
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attempt: 1, willRetry: true })
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attempt: 2, willRetry: true })
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ attempt: 3, willRetry: false })
    );
  });

  it("isRetryableOpenAIError correctly identifies AbortError as non-retryable", () => {
    const abortErr = new DOMException("Aborted", "AbortError");
    expect(isRetryableOpenAIError(abortErr)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateImage forwards signal to OpenAI SDK
// ---------------------------------------------------------------------------

describe("generateImage signal forwarding", () => {
  it("passes signal as second arg to client.images.generate", async () => {
    const client = mockClient(await realPngBase64());
    const controller = new AbortController();

    await generateImage(client, makeTask(), controller.signal);

    expect(client.images.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "dall-e-3" }),
      { signal: controller.signal }
    );
  });

  it("rejects with AbortError when signal is pre-aborted", async () => {
    const client = mockClient(await realPngBase64());
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateImage(client, makeTask(), controller.signal)
    ).rejects.toThrow(/aborted/i);
  });
});

// ---------------------------------------------------------------------------
// generateImages batch abort
// ---------------------------------------------------------------------------

describe("generateImages batch abort", () => {
  it(
    "reports all tasks as upstream_timeout errors when signal is pre-aborted",
    async () => {
      const client = mockClient(await realPngBase64());
      const tasks = [
        makeTask("product-a", "1:1"),
        makeTask("product-b", "9:16"),
        makeTask("product-c", "16:9"),
      ];
      const controller = new AbortController();
      controller.abort();

      const result = await generateImages(
        tasks,
        client,
        undefined, // no ctx
        controller.signal
      );

      expect(result.images).toHaveLength(0);
      expect(result.errors).toHaveLength(3);
      for (const error of result.errors) {
        // AbortError classifies to upstream_timeout via
        // classifyOpenAIError in imageGenerator.ts
        expect(error.cause).toBe("upstream_timeout");
        expect(error.stage).toBe("generating");
      }
    },
    { timeout: 5_000 }
  );
});
