/**
 * Regenerator for example artifacts under `examples/campaigns/`.
 *
 * Two regen steps live here, both guarded behind the `REGEN_EXAMPLE_PROMPTS`
 * env var so they do NOT run in normal `npm run test` invocations:
 *
 *     REGEN_EXAMPLE_PROMPTS=1 npx vitest run __tests__/regen-example-prompts.test.ts
 *
 *   1. **prompts.md** — for each `campaigns/<name>/brief.json`, run the real
 *      `buildPrompt` over every (product × aspectRatio) and write the literal
 *      DALL-E prompts to `prompts.md` beside the brief. Guarantees the
 *      example artifacts can never drift from the actual builder.
 *
 *   2. **lib/ai/example-seeds.ts** — for each `campaigns/<name>/seed-prompt.md`,
 *      extract the first fenced code block (the paste-ready seed prompt) and
 *      emit a TypeScript module containing all of them. The frontend
 *      `BriefGeneratorAI` component imports this module to power the
 *      "Load example" secondary button — no API call, no LLM, no runtime
 *      filesystem read.
 *
 * Why a vitest test instead of a standalone script:
 *   Vitest already understands TypeScript imports via Vite, so we can pull
 *   in `buildPrompt` and `parseBrief` directly. A standalone Node script
 *   would either need `tsx`/`ts-node` as a new dev dependency or duplicate
 *   the prompt builder logic — both bad. This way the example artifacts can
 *   never drift from the real source: re-run the regen, the artifacts update.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { buildPrompt } from "../lib/pipeline/promptBuilder";
import { parseBrief } from "../lib/pipeline/briefParser";
import type { CampaignBrief } from "../lib/pipeline/types";

const SHOULD_RUN = process.env.REGEN_EXAMPLE_PROMPTS === "1";

describe.skipIf(!SHOULD_RUN)("regenerate example artifacts", () => {
  it("writes prompts.md beside every campaigns/*/brief.json", () => {
    const campaignsRoot = join(__dirname, "..", "examples", "campaigns");
    // Sort for deterministic write order across platforms (POSIX readdirSync
    // ordering is undefined). Matches Block 2's symmetry.
    const campaignDirs = readdirSync(campaignsRoot)
      .filter((entry) => statSync(join(campaignsRoot, entry)).isDirectory())
      .sort();

    expect(campaignDirs.length).toBeGreaterThan(0);

    for (const dir of campaignDirs) {
      const briefPath = join(campaignsRoot, dir, "brief.json");
      const raw = readFileSync(briefPath, "utf8");
      const result = parseBrief(raw);

      if (!result.success) {
        throw new Error(
          `Brief ${briefPath} failed schema validation:\n  ${result.errors.join("\n  ")}`
        );
      }

      const brief = result.brief;
      const md = renderPromptsMarkdown(brief);
      writeFileSync(join(dirname(briefPath), "prompts.md"), md, "utf8");
    }
  });

  it("emits lib/ai/example-seeds.ts from every campaigns/*/seed-prompt.md", () => {
    const campaignsRoot = join(__dirname, "..", "examples", "campaigns");
    const campaignDirs = readdirSync(campaignsRoot)
      .filter((entry) => statSync(join(campaignsRoot, entry)).isDirectory())
      .sort();

    expect(campaignDirs.length).toBeGreaterThan(0);

    type ExtractedSeed = {
      slug: string;
      campaignId: string;
      campaignName: string;
      prompt: string;
    };
    const seeds: ExtractedSeed[] = [];

    for (const dir of campaignDirs) {
      const briefPath = join(campaignsRoot, dir, "brief.json");
      const seedPath = join(campaignsRoot, dir, "seed-prompt.md");

      const briefResult = parseBrief(readFileSync(briefPath, "utf8"));
      if (!briefResult.success) {
        throw new Error(
          `Brief ${briefPath} failed schema validation while extracting seeds:\n  ${briefResult.errors.join("\n  ")}`
        );
      }
      const brief = briefResult.brief;

      const seedRaw = readFileSync(seedPath, "utf8");
      const prompt = extractFirstFencedBlock(seedRaw);
      if (!prompt) {
        throw new Error(
          `Could not find a fenced code block in ${seedPath} — every seed-prompt.md must contain at least one \`\`\` block.`
        );
      }
      if (prompt.length > 1000) {
        throw new Error(
          `Seed prompt in ${seedPath} is ${prompt.length} chars — exceeds the 1000-char orchestrator cap.`
        );
      }

      seeds.push({
        slug: dir,
        campaignId: brief.campaign.id,
        campaignName: brief.campaign.name,
        prompt,
      });
    }

    const tsSource = renderExampleSeedsModule(seeds);
    writeFileSync(
      join(__dirname, "..", "lib", "ai", "example-seeds.ts"),
      tsSource,
      "utf8"
    );
  });
});

function extractFirstFencedBlock(markdown: string): string | null {
  // Normalize CRLF → LF first so Windows-checked-out files work, then match
  // a fenced block that may carry an optional language tag (e.g. ```text).
  // Either omission silently returned null in earlier versions and threw a
  // confusing "no fence found" error from the caller — both fixed here.
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(/```[^\n]*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

function renderExampleSeedsModule(
  seeds: Array<{
    slug: string;
    campaignId: string;
    campaignName: string;
    prompt: string;
  }>
): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Example seed prompts for the AI Brief Orchestrator.");
  lines.push(" *");
  lines.push(
    " * AUTOGENERATED — do not edit by hand. Source of truth lives in"
  );
  lines.push(" * `examples/campaigns/<slug>/seed-prompt.md` (the first fenced code");
  lines.push(" * block of each file). Regenerate with:");
  lines.push(" *");
  lines.push(
    " *     REGEN_EXAMPLE_PROMPTS=1 npx vitest run __tests__/regen-example-prompts.test.ts"
  );
  lines.push(" *");
  lines.push(
    " * The frontend `BriefGeneratorAI` component imports `EXAMPLE_SEEDS` to"
  );
  lines.push(
    " * power the \"Load example\" secondary button — picks one at random and"
  );
  lines.push(" * paste-fills the textarea. No API call, no LLM, no runtime FS read.");
  lines.push(" */");
  lines.push("");
  lines.push("export interface ExampleSeed {");
  lines.push("  /** Folder name under examples/campaigns/ */");
  lines.push("  slug: string;");
  lines.push("  /** Stable id from brief.json campaign.id */");
  lines.push("  campaignId: string;");
  lines.push("  /** Human-readable name from brief.json campaign.name */");
  lines.push("  campaignName: string;");
  lines.push(
    "  /** Paste-ready seed prompt — extracted from seed-prompt.md, ≤1000 chars */"
  );
  lines.push("  prompt: string;");
  lines.push("}");
  lines.push("");
  lines.push("export const EXAMPLE_SEEDS: readonly ExampleSeed[] = [");
  for (const seed of seeds) {
    lines.push("  {");
    lines.push(`    slug: ${JSON.stringify(seed.slug)},`);
    lines.push(`    campaignId: ${JSON.stringify(seed.campaignId)},`);
    lines.push(`    campaignName: ${JSON.stringify(seed.campaignName)},`);
    lines.push(`    prompt: ${JSON.stringify(seed.prompt)},`);
    lines.push("  },");
  }
  lines.push("] as const;");
  lines.push("");
  lines.push("/**");
  lines.push(" * Pick one example seed at random.");
  lines.push(" *");
  lines.push(
    " * Used by the \"Load example\" button. Pure function — pass `Math.random`"
  );
  lines.push(" * (or a seeded RNG in tests) so the picker stays deterministic when");
  lines.push(" * needed.");
  lines.push(" */");
  lines.push(
    "export function pickRandomSeed(rng: () => number = Math.random): ExampleSeed {"
  );
  lines.push("  if (EXAMPLE_SEEDS.length === 0) {");
  lines.push("    throw new Error(");
  lines.push(
    "      \"pickRandomSeed: EXAMPLE_SEEDS is empty — run the regen test to populate it.\""
  );
  lines.push("    );");
  lines.push("  }");
  lines.push("  const i = Math.floor(rng() * EXAMPLE_SEEDS.length);");
  lines.push("  // Non-null assertion is safe — i is bounded by the length check above.");
  lines.push("  return EXAMPLE_SEEDS[i]!;");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderPromptsMarkdown(
  brief: import("../lib/pipeline/types").CampaignBrief
): string {
  const lines: string[] = [];
  lines.push(`# Generated Prompts — ${brief.campaign.name}`);
  lines.push("");
  lines.push(
    "> These are the literal DALL-E 3 prompts produced by `lib/pipeline/promptBuilder.ts`"
  );
  lines.push(
    `> for [\`brief.json\`](./brief.json). Regenerate with: \`REGEN_EXAMPLE_PROMPTS=1 npx vitest run __tests__/regen-example-prompts.test.ts\``
  );
  lines.push("");
  lines.push(`**Campaign id:** \`${brief.campaign.id}\``);
  lines.push(`**Message:** "${brief.campaign.message}"`);
  lines.push(`**Tone:** ${brief.campaign.tone}`);
  lines.push(`**Season:** ${brief.campaign.season}`);
  lines.push(
    `**Aspect ratios:** ${brief.aspectRatios.map((r) => `\`${r}\``).join(", ")}`
  );
  lines.push(
    `**Total generations:** ${brief.products.length} products × ${brief.aspectRatios.length} ratios = **${brief.products.length * brief.aspectRatios.length} images**`
  );
  lines.push("");

  for (const product of brief.products) {
    lines.push(`## ${product.name}`);
    lines.push("");
    lines.push(`**slug:** \`${product.slug}\` &nbsp; **brand color:** \`${product.color}\``);
    lines.push("");
    for (const ratio of brief.aspectRatios) {
      const prompt = buildPrompt(product, brief.campaign, ratio);
      lines.push(`### \`${ratio}\``);
      lines.push("");
      lines.push("```");
      lines.push(prompt);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}
