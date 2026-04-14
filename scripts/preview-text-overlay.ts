/**
 * preview-text-overlay — render the new textOverlay against sample
 * background images WITHOUT calling DALL-E.
 *
 * Used to visually verify changes to `lib/pipeline/textOverlay.ts`
 * before committing. Takes existing composited outputs from ./output/
 * (or synthetic Sharp-generated backgrounds if none exist), runs the
 * new overlayText() implementation over them with different campaign
 * messages, and writes results to `tmp/text-overlay-preview/`.
 *
 * The script produces two kinds of previews:
 *
 *   1. **real-background** — reuses existing DALL-E outputs so you see
 *      the overlay on top of the hero image the pipeline would normally
 *      produce. Note: the source already has a band composited on it
 *      from the prior overlay run, so the "real-background" output will
 *      have TWO bands stacked — that's expected and fine for visual
 *      verification of the NEW band's gradient + text shadow. Ignore
 *      the residual first band and focus on the top of the second one.
 *
 *   2. **synthetic-bright** — a bright yellow/orange gradient that
 *      stresses the band contrast. If the text is readable on the
 *      synthetic-bright preview, it'll be readable on anything.
 *
 * HOW to run:
 *
 *   npx tsx scripts/preview-text-overlay.ts
 *
 * Run from the repo root. Outputs land in `tmp/text-overlay-preview/`
 * which is gitignored. Re-run after every edit to textOverlay.ts.
 */

import sharp from "sharp";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  overlayText,
  ImageProcessingError,
} from "../lib/pipeline/textOverlay";
import { ASPECT_RATIO_CONFIG } from "../lib/pipeline/types";
import type { AspectRatio } from "../lib/pipeline/types";

const DEST_DIR = "tmp/text-overlay-preview";

/**
 * Sample campaign messages at different lengths — the overlay must
 * handle all three shapes:
 *
 *  - short: one word, no wrap
 *  - medium: one wrap line
 *  - long: two wrap lines at most aspect ratios
 */
const MESSAGES = [
  "Launch Day",
  "Stay Protected All Summer",
  "Crafted with care, built to last — summer essentials for the curious",
] as const;

/** Aspect ratios to render — one preview per ratio per message per source. */
const ASPECT_RATIOS: readonly AspectRatio[] = ["1:1", "9:16", "16:9"];

/**
 * Sources: either existing DALL-E outputs (read from ./output/) or
 * synthetic backgrounds generated on the fly. The script tries each
 * existing path and falls back to the synthetic if the file is missing.
 */
const SOURCES: Array<{
  label: string;
  kind: "real" | "synthetic";
  path?: string;  // only for "real"
}> = [
  {
    label: "real-nike-9x16",
    kind: "real",
    path: "output/nike-move-with-purpose-2026/air-zoom-vomero-18/9x16/creative.png",
  },
  {
    label: "real-sunscreen-1x1",
    kind: "real",
    path: "output/two-image-diagnostic/spf-50-sunscreen/1x1/creative.png",
  },
  {
    label: "real-nike-16x9",
    kind: "real",
    path: "output/nike-move-with-purpose-2026/air-zoom-vomero-18/16x9/creative.png",
  },
  {
    label: "synthetic-bright",
    kind: "synthetic",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a bright gradient background to stress-test band contrast.
 * Bright top-left → orange middle → yellow bottom so the band's darkest
 * region (the bottom, where the text sits) overlaps the image's lightest
 * region (worst-case contrast for white text).
 */
async function makeSyntheticBackground(
  width: number,
  height: number
): Promise<Buffer> {
  // SVG linear gradient — Sharp can rasterize an SVG to PNG. This is
  // simpler than composing raw pixel buffers and gives a smooth blend.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#F4A261" />
          <stop offset="50%" stop-color="#F7C873" />
          <stop offset="100%" stop-color="#FCE38A" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      <circle cx="${width * 0.7}" cy="${height * 0.4}" r="${Math.min(width, height) * 0.25}" fill="#FFFFFF" opacity="0.6" />
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Slugify a string for use in a filename. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const destAbs = path.resolve(projectRoot, DEST_DIR);
  await fs.mkdir(destAbs, { recursive: true });

  console.log(`preview-text-overlay → ${DEST_DIR}/\n`);

  let count = 0;
  let skipped = 0;

  for (const source of SOURCES) {
    for (const ratio of ASPECT_RATIOS) {
      const dimensions = ASPECT_RATIO_CONFIG[ratio];

      // Load or synthesize the source background. For "real" sources,
      // skip if the file doesn't exist (not every ratio exists for
      // every campaign in ./output/).
      let bgBuffer: Buffer;
      if (source.kind === "real") {
        if (!source.path) continue;
        const sourceAbs = path.resolve(projectRoot, source.path);
        try {
          await fs.access(sourceAbs);
        } catch {
          skipped += 1;
          continue;
        }
        // Resize the source to match the target dimensions so the
        // overlay math matches what the real pipeline does. The
        // `resizeToTarget` helper inside textOverlay.ts already does
        // this, but we pre-resize here so the background is recognizable.
        bgBuffer = await sharp(sourceAbs)
          .resize(dimensions.width, dimensions.height, {
            fit: "cover",
            position: "center",
          })
          .png()
          .toBuffer();
      } else {
        bgBuffer = await makeSyntheticBackground(
          dimensions.width,
          dimensions.height
        );
      }

      // Run each message through overlayText and write the result.
      for (const message of MESSAGES) {
        try {
          const result = await overlayText(bgBuffer, message, dimensions);
          const filename = `${source.label}_${ratio.replace(":", "x")}_${slugify(message)}.png`;
          await fs.writeFile(path.join(destAbs, filename), result);
          const stats = await fs.stat(path.join(destAbs, filename));
          console.log(
            `  ✓ ${filename.padEnd(60)} ${(stats.size / 1024).toFixed(0)} KB`
          );
          count += 1;
        } catch (err) {
          if (err instanceof ImageProcessingError) {
            console.error(`  ✗ ${source.label} ${ratio} "${message}": ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    }
  }

  console.log(
    `\n${count} preview${count === 1 ? "" : "s"} written${skipped ? ` (${skipped} skipped — missing source)` : ""}.`
  );
  console.log(`Inspect with: explorer ${DEST_DIR.replace("/", "\\")}`);
}

main().catch((err: unknown) => {
  console.error("preview-text-overlay failed:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
