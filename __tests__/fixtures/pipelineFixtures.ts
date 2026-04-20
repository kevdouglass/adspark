/**
 * Shared test fixtures for pipeline state + API contract tests.
 *
 * Extracted from __tests__/pipelineReducer.test.ts so downstream test
 * files (apiClient.test.ts, BriefForm.test.ts, etc.) can reuse the same
 * realistic values without re-typing them.
 *
 * All top-level fixtures are deep-frozen (`Object.freeze` + recursive
 * freeze on nested objects) so a test that accidentally mutates a fixture
 * will throw in strict mode instead of silently polluting the next test.
 */

import type {
  GenerateRequestBody,
  GenerateSuccessResponseBody,
} from "@/lib/api/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * Deep-freeze a value so nested mutations also throw.
 * Plain `Object.freeze` only protects the top level.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.getOwnPropertyNames(value).forEach((prop) => {
    const nested = (value as Record<string, unknown>)[prop];
    if (nested !== null && typeof nested === "object") {
      deepFreeze(nested);
    }
  });
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export const VALID_BRIEF: GenerateRequestBody = deepFreeze({
  campaign: {
    id: "summer-2026-suncare",
    name: "Summer Suncare 2026",
    message: "Stay Protected All Summer",
    targetRegion: "North America",
    targetAudience: "Outdoor enthusiasts 25-45",
    tone: "vibrant, trustworthy",
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
  aspectRatios: ["1:1"],
  outputFormats: { creative: "png", thumbnail: "webp" },
});

/**
 * A distinct brief used to prove the reducer carries the RIGHT brief
 * through state transitions, not just "any" brief.
 */
export const ANOTHER_BRIEF: GenerateRequestBody = deepFreeze({
  campaign: {
    id: "winter-2026-suncare",
    name: "Winter Suncare 2026",
    message: "Protection in Every Climate",
    targetRegion: "Northern Europe",
    targetAudience: "Winter sports enthusiasts",
    tone: "cozy, reassuring",
    season: "winter",
  },
  products: [
    {
      name: "Winter Defense Cream",
      slug: "winter-defense-cream",
      description: "Moisturizing barrier for cold weather",
      category: "skincare",
      keyFeatures: ["cold-tested", "dermatologist-approved"],
      color: "#264653",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1"],
  outputFormats: { creative: "png", thumbnail: "webp" },
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const SUCCESS_RESULT: GenerateSuccessResponseBody = deepFreeze({
  campaignId: "summer-2026-suncare",
  creatives: [
    {
      productName: "SPF 50 Sunscreen",
      productSlug: "spf-50-sunscreen",
      aspectRatio: "1:1",
      dimensions: "1080x1080",
      creativePath:
        "summer-2026-suncare/spf-50-sunscreen/1x1/creative.png",
      thumbnailPath:
        "summer-2026-suncare/spf-50-sunscreen/1x1/thumbnail.webp",
      prompt: "A premium sun protection product...",
      generationTimeMs: 15_000,
      compositingTimeMs: 500,
      sourceType: "generated",
    },
  ],
  totalTimeMs: 18_000,
  totalImages: 1,
  errors: [],
  requestId: "abc-123",
  summary: {
    totalProducts: 1,
    totalCreatives: 1,
    reusedAssets: 0,
    generatedAssets: 1,
    failedCreatives: 0,
    totalTimeMs: 18_000,
    status: "complete",
  },
});

/**
 * Distinct success result used to prove stale-event guards work —
 * when this and SUCCESS_RESULT both land, the reducer must keep the
 * one matching the current submissionId.
 */
export const STALE_SUCCESS_RESULT: GenerateSuccessResponseBody = deepFreeze({
  campaignId: "winter-2026-suncare",
  creatives: [
    {
      productName: "Winter Defense Cream",
      productSlug: "winter-defense-cream",
      aspectRatio: "1:1",
      dimensions: "1080x1080",
      creativePath:
        "winter-2026-suncare/winter-defense-cream/1x1/creative.png",
      thumbnailPath:
        "winter-2026-suncare/winter-defense-cream/1x1/thumbnail.webp",
      prompt: "A cozy winter skincare product...",
      generationTimeMs: 14_000,
      compositingTimeMs: 600,
      sourceType: "generated",
    },
  ],
  totalTimeMs: 17_000,
  totalImages: 1,
  errors: [],
  requestId: "def-456",
  summary: {
    totalProducts: 1,
    totalCreatives: 1,
    reusedAssets: 0,
    generatedAssets: 1,
    failedCreatives: 0,
    totalTimeMs: 17_000,
    status: "complete",
  },
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const API_ERROR: ApiError = deepFreeze({
  code: "UPSTREAM_ERROR",
  message: "DALL-E returned 500",
  requestId: "abc-123",
});
