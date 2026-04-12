/**
 * Brief Parser — Validates and parses campaign brief JSON.
 *
 * Uses Zod for runtime schema validation. This is the first component in the
 * pipeline: garbage in = garbage out, so we validate strictly.
 */

import { z } from "zod";
import type { CampaignBrief } from "./types";
import { VALID_SEASONS } from "./types";

// --- Zod Schemas ---

const campaignSchema = z.object({
  id: z
    .string()
    .min(1, "Campaign ID is required")
    .regex(/^[a-z0-9-]+$/, "Campaign ID must be lowercase alphanumeric with hyphens (used in file paths)"),
  name: z.string().min(1, "Campaign name is required"),
  message: z
    .string()
    .min(1, "Campaign message is required")
    .max(140, "Campaign message must be 140 characters or fewer for text overlay"),
  targetRegion: z.string().min(1, "Target region is required"),
  targetAudience: z.string().min(1, "Target audience is required"),
  tone: z.string().min(1, "Tone is required"),
  season: z.enum(VALID_SEASONS, {
    errorMap: () => ({ message: `Season must be one of: ${VALID_SEASONS.join(", ")}` }),
  }),
});

const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().min(1, "Product description is required"),
  category: z.string().min(1, "Product category is required"),
  keyFeatures: z.array(z.string()).min(1, "At least one key feature required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color (e.g. #F4A261)"),
  existingAsset: z.string().nullable(),
});

const aspectRatioSchema = z.enum(["1:1", "9:16", "16:9"]);

const outputFormatsSchema = z.object({
  creative: z.literal("png"),
  thumbnail: z.literal("webp"),
});

export const campaignBriefSchema = z.object({
  campaign: campaignSchema,
  products: z.array(productSchema).min(1, "At least one product is required"),
  aspectRatios: z
    .array(aspectRatioSchema)
    .min(1, "At least one aspect ratio is required"),
  outputFormats: outputFormatsSchema,
});

// --- Parser ---

export type BriefParseResult =
  | { success: true; brief: CampaignBrief }
  | { success: false; errors: string[] };

/**
 * Parse and validate a campaign brief from a JSON string or object.
 *
 * Returns a discriminated union so callers handle both paths explicitly —
 * no thrown exceptions for validation failures (which are expected, not exceptional).
 */
export function parseBrief(input: string | unknown): BriefParseResult {
  const data = typeof input === "string" ? safeJsonParse(input) : input;

  if (data === undefined) {
    return { success: false, errors: ["Invalid JSON input"] };
  }

  const result = campaignBriefSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    return { success: false, errors };
  }

  return { success: true, brief: result.data };
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}
