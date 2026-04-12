/**
 * Sample Briefs — pre-filled demo data for the BriefForm.
 *
 * Three real-brand-aligned briefs so the demo reviewer (Adobe Firefly
 * team) sees the pipeline handling multiple product categories:
 *
 * 1. `adobe-firefly` — Creative AI tool launch. References the team
 *    Kevin is applying to. Demonstrates the pipeline handling a
 *    software product.
 *
 * 2. `nike-athletic` — Athletic wear campaign. Demonstrates the
 *    lifestyle-category path (sportswear), which the promptBuilder
 *    routes through "People may appear naturally in the scene" —
 *    visually different from a product-only shot.
 *
 * 3. `summer-suncare` — The original SPF 50 brief that's been the
 *    default throughout development. Known-good end-to-end.
 *
 * Every brief validates against `campaignBriefSchema` at module-load
 * time via `campaignBriefSchema.parse()` so any drift is caught at
 * build time, not runtime.
 */

import { campaignBriefSchema } from "@/lib/pipeline/briefParser";
import type { GenerateRequestBody } from "@/lib/api/types";

export interface SampleBrief {
  /** Stable id — used as the <select> value and the "current" key */
  id: string;
  /** Short label shown in the sample selector dropdown */
  label: string;
  /** One-line description shown below the label for context */
  description: string;
  /** The actual brief payload, validated against campaignBriefSchema */
  brief: GenerateRequestBody;
}

// ---------------------------------------------------------------------------
// Brief 1 — Adobe Firefly Creative Suite
// ---------------------------------------------------------------------------

const adobeFireflyBrief: GenerateRequestBody = {
  campaign: {
    id: "firefly-create-without-limits-2026",
    name: "Create Without Limits",
    message: "Create Without Limits",
    targetRegion: "Global",
    targetAudience: "Creative professionals, marketers, and designers",
    tone: "empowering, innovative, bold",
    season: "spring",
  },
  products: [
    {
      name: "Firefly Image Generator",
      slug: "firefly-image-generator",
      description:
        "AI-powered creative image generation built for marketing teams. Text-to-image, generative fill, and style reference in one workflow.",
      category: "creative software",
      keyFeatures: [
        "text-to-image generation",
        "generative fill",
        "commercial-safe training data",
      ],
      color: "#7C3AED",
      existingAsset: null,
    },
    {
      name: "Firefly Style Kit",
      slug: "firefly-style-kit",
      description:
        "Brand-consistent style reference pack for enterprise creative teams. Lock every asset to a single visual identity in one click.",
      category: "creative software",
      keyFeatures: [
        "brand style lock",
        "team-shared references",
        "one-click application",
      ],
      color: "#EC4899",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

// ---------------------------------------------------------------------------
// Brief 2 — Nike Athletic Performance Collection
// ---------------------------------------------------------------------------

const nikeAthleticBrief: GenerateRequestBody = {
  campaign: {
    id: "nike-move-with-purpose-2026",
    name: "Move With Purpose",
    message: "Move With Purpose",
    targetRegion: "North America",
    targetAudience: "Runners and cross-training athletes aged 20-40",
    tone: "dynamic, energetic, performance-driven",
    season: "summer",
  },
  products: [
    {
      name: "Air Zoom Vomero 18",
      slug: "air-zoom-vomero-18",
      description:
        "Premium road running shoe with ZoomX midsole and breathable engineered mesh upper. Built for long-distance cushioning.",
      category: "sportswear",
      keyFeatures: [
        "ZoomX midsole",
        "engineered mesh upper",
        "reflective heel accent",
      ],
      color: "#FA0F00",
      existingAsset: null,
    },
    {
      name: "Pro Training Tee",
      slug: "pro-training-tee",
      description:
        "Moisture-wicking performance tee with Dri-FIT technology. Designed for high-intensity interval training and cross-fit sessions.",
      category: "sportswear",
      keyFeatures: [
        "Dri-FIT moisture-wicking",
        "four-way stretch fabric",
        "flatlock seams reduce chafing",
      ],
      color: "#111111",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

// ---------------------------------------------------------------------------
// Brief 3 — Summer Suncare (original demo brief)
// ---------------------------------------------------------------------------

const summerSuncareBrief: GenerateRequestBody = {
  campaign: {
    id: "summer-2026-suncare",
    name: "Summer Sun Protection 2026",
    message: "Stay Protected All Summer",
    targetRegion: "North America",
    targetAudience: "Health-conscious adults 25-45",
    tone: "vibrant, trustworthy, active lifestyle",
    season: "summer",
  },
  products: [
    {
      name: "SPF 50 Mineral Sunscreen",
      slug: "spf-50-mineral-sunscreen",
      description:
        "Reef-safe mineral sunscreen with non-nano zinc oxide. Broad spectrum SPF 50 with 80-minute water resistance.",
      category: "sun protection",
      keyFeatures: [
        "reef-safe zinc oxide",
        "80-minute water resistance",
        "fragrance-free formula",
      ],
      color: "#F4A261",
      existingAsset: null,
    },
    {
      name: "After-Sun Aloe Gel",
      slug: "after-sun-aloe-gel",
      description:
        "Cooling aloe vera gel with vitamin E and chamomile extract. Soothes post-sun skin and locks in hydration.",
      category: "skincare",
      keyFeatures: [
        "organic aloe vera",
        "vitamin E enriched",
        "dermatologist-tested",
      ],
      color: "#2A9D8F",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

// ---------------------------------------------------------------------------
// Public registry
// ---------------------------------------------------------------------------

/**
 * Ordered list of sample briefs shown in the BriefForm's sample selector.
 * Order matters — the first entry is loaded on initial render.
 */
export const SAMPLE_BRIEFS: readonly SampleBrief[] = [
  {
    id: "adobe-firefly",
    label: "Adobe Firefly — Create Without Limits",
    description: "Creative AI tool launch",
    brief: adobeFireflyBrief,
  },
  {
    id: "nike-athletic",
    label: "Nike — Move With Purpose",
    description: "Athletic performance collection",
    brief: nikeAthleticBrief,
  },
  {
    id: "summer-suncare",
    label: "Summer Suncare — Stay Protected",
    description: "SPF 50 + after-sun care",
    brief: summerSuncareBrief,
  },
];

/**
 * Id of the brief loaded on first render. Adobe Firefly first so the
 * demo opens on a brief that references the Firefly team directly.
 */
export const DEFAULT_BRIEF_ID = "adobe-firefly";

export const DEFAULT_BRIEF: GenerateRequestBody =
  SAMPLE_BRIEFS.find((b) => b.id === DEFAULT_BRIEF_ID)?.brief ??
  SAMPLE_BRIEFS[0].brief;

/**
 * Runtime assertion: every sample brief must pass `campaignBriefSchema`.
 * Runs once at module load — catches sample-brief drift at build time
 * rather than at generate time. In production builds, a failure here
 * throws during SSR/hydration and prevents the dashboard from loading
 * with a broken default, which is the right failure mode.
 */
for (const sample of SAMPLE_BRIEFS) {
  const result = campaignBriefSchema.safeParse(sample.brief);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Sample brief "${sample.id}" fails schema validation: ${issues}`
    );
  }
}
