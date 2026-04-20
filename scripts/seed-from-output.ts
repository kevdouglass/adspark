/**
 * seed-from-output — promote prior pipeline outputs to committed seed assets.
 *
 * WHY this script exists:
 *
 * The assignment brief asks the pipeline to "reuse input assets when
 * available". `assetResolver.resolveOne()` supports this — it checks
 * `product.existingAsset` against the storage provider and short-circuits
 * DALL-E generation if the file is present. But on a fresh clone there
 * are zero committed product images anywhere in the repo, so the reuse
 * branch is dark during every reviewer's first run.
 *
 * This script manufactures the "previously-approved brand asset library"
 * by promoting selected outputs from prior pipeline runs in `./output/`
 * (which is .gitignored) into `./examples/seed-assets/` (which is
 * committed). The `LocalStorage` provider is taught to read from the
 * seed directory as a read-only fallback (see lib/storage/localStorage.ts),
 * so reviewers cloning the repo can immediately demonstrate the reuse
 * branch without running DALL-E first.
 *
 * WHY crop the bottom 25%:
 *
 * Every creative in `./output/` has already been through `textOverlay.ts`,
 * so it carries the prior campaign's message composited onto a
 * semi-transparent black band in the bottom 25% of the image
 * (see BAND_HEIGHT_RATIO in textOverlay.ts). If we promoted the raw output
 * as a seed asset, the pipeline would lay a second campaign message on
 * top of the first. Cropping the band out before committing gives us a
 * clean "product-only" image that re-enters the overlay stage like a
 * fresh generation would.
 *
 * KEEP IN SYNC: If `BAND_HEIGHT_RATIO` in `lib/pipeline/textOverlay.ts`
 * ever changes, update `TEXT_BAND_RATIO` below and re-run this script.
 *
 * HOW to run:
 *
 *   npx tsx scripts/seed-from-output.ts
 *
 * Run from the repo root. The script is idempotent — re-running produces
 * byte-identical output. It is NOT wired into CI or any npm script; the
 * committed seed assets are the authoritative artifacts.
 *
 * WHY idempotent + committed:
 *
 * Six months from now, somebody will open `./examples/seed-assets/` and
 * ask "where did these files come from?". The committed script is the
 * answer: the provenance trail from prior pipeline output → cropped seed
 * asset is auditable by reading this file and its allowlist.
 */

import sharp from "sharp";
import path from "node:path";
import { promises as fs } from "node:fs";

// ---------------------------------------------------------------------------
// Config — keep in sync with lib/pipeline/textOverlay.ts
// ---------------------------------------------------------------------------

/** Must match BAND_HEIGHT_RATIO in lib/pipeline/textOverlay.ts */
const TEXT_BAND_RATIO = 0.25;

/** Destination for committed seed assets (relative to repo root) */
const DEST_DIR = "examples/seed-assets";

// ---------------------------------------------------------------------------
// Allowlist — which prior outputs become which seed assets
// ---------------------------------------------------------------------------

/**
 * Mapping of source (relative to repo root) → destination filename in
 * `DEST_DIR`. Add entries here to promote more prior outputs.
 *
 * The current set is scoped to the Coastal Wellness sun-protection
 * showcase campaign (see examples/campaigns/coastal-sun-protection/).
 * The source campaign on disk (`two-image-diagnostic`) has matching
 * product slugs, so the promoted images line up 1:1 with the new brief's
 * product references — zero visual mismatch.
 */
const JOBS: Array<{ source: string; dest: string; label: string }> = [
  {
    source: "output/two-image-diagnostic/spf-50-sunscreen/1x1/creative.png",
    dest: "spf-50-sunscreen.webp",
    label: "SPF 50 Mineral Sunscreen",
  },
  {
    source: "output/two-image-diagnostic/after-sun-aloe-gel/1x1/creative.png",
    dest: "after-sun-aloe-gel.webp",
    label: "After-Sun Cooling Aloe Gel",
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const destAbs = path.resolve(projectRoot, DEST_DIR);
  await fs.mkdir(destAbs, { recursive: true });

  console.log(`seed-from-output → ${DEST_DIR}/`);
  console.log(`text-band crop ratio: ${TEXT_BAND_RATIO * 100}%\n`);

  for (const job of JOBS) {
    const sourceAbs = path.resolve(projectRoot, job.source);
    const destAbsFile = path.resolve(destAbs, job.dest);

    // Existence check — fail loudly if the allowlist points at a stale path.
    // The script is reproducible only if every listed source is still present.
    try {
      await fs.access(sourceAbs);
    } catch {
      throw new Error(
        `source not found: ${job.source}\n` +
          `  The allowlist in scripts/seed-from-output.ts references a file\n` +
          `  that no longer exists in ./output/. Either run the pipeline for\n` +
          `  the relevant campaign first, or update the allowlist.`
      );
    }

    const meta = await sharp(sourceAbs).metadata();
    if (!meta.width || !meta.height) {
      throw new Error(`Cannot read dimensions from ${job.source}`);
    }

    // Crop the bottom N% (text band) off the source. The remaining top
    // portion is committed as the seed asset. When the pipeline reuses it,
    // `resizeToTarget()` in textOverlay.ts resizes the seed to the target
    // aspect ratio (cover + center), and then `overlayText()` paints the
    // NEW campaign message onto a fresh bottom band. No double-overlay.
    const bandHeight = Math.round(meta.height * TEXT_BAND_RATIO);
    const keepHeight = meta.height - bandHeight;

    // WebP at quality 85 is visually indistinguishable from PNG for photoreal
    // DALL-E output and drops file size by ~6x. Sharp handles any input format
    // transparently in the pipeline's `resizeToTarget()`, so committing WebP
    // seeds is safe — the pipeline decodes and re-encodes as PNG downstream.
    // This keeps the committed seed directory under ~1 MB per clone.
    const output = await sharp(sourceAbs)
      .extract({
        left: 0,
        top: 0,
        width: meta.width,
        height: keepHeight,
      })
      .webp({ quality: 85, effort: 6 })
      .toBuffer();

    await fs.writeFile(destAbsFile, output);

    const stats = await fs.stat(destAbsFile);
    const sizeKb = (stats.size / 1024).toFixed(0);
    console.log(
      `  ✓ ${job.dest.padEnd(32)} ${meta.width}×${keepHeight}  ${sizeKb} KB  (${job.label})`
    );
  }

  console.log(`\n${JOBS.length} seed asset${JOBS.length === 1 ? "" : "s"} written.`);
}

main().catch((err: unknown) => {
  console.error("seed-from-output failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
