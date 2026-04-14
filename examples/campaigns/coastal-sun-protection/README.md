# Coastal Sun Protection — Summer 2026

**This is the canonical asset-reuse demo for AdSpark.** It is the one example
brief in the repo where the pipeline's reuse branch is exercised end-to-end
on a fresh clone, without any prior DALL-E calls.

## Why this campaign exists

The assignment asks the pipeline to *"reuse input assets when available"*.
Every other example campaign in this repo has `existingAsset: null` on every
product, so on a fresh clone the asset-resolver's reuse branch is
architecturally supported but never fires — reviewers can't actually see it
unless they read `lib/pipeline/assetResolver.ts` directly.

This campaign closes that gap. It references the fictional **Coastal
Wellness Co.** brand (see [`examples/brand-profiles/coastal-wellness.json`](../../brand-profiles/coastal-wellness.json)
for the full brand guidelines) and includes two products:

| Product | Asset source |
|---|---|
| **SPF 50 Mineral Sunscreen** | **Reused** — pulled from the brand asset library (`examples/seed-assets/spf-50-sunscreen.webp`) |
| **After-Sun Cooling Aloe Gel** | **Generated** — DALL-E 3 call as usual |

When the pipeline runs this brief, one product skips the image-generation
stage entirely (you'll see `sourceType: "reused"` in the manifest and a
"Reused" badge in the gallery, once the UI wiring is in place) and the
other runs through the normal DALL-E path.

## Where the reused asset came from

A production brand asset library would contain photoshoot outputs, Firefly
renders, or catalogued creative history from prior campaigns. For this POC
the "brand library" is manufactured from a prior AdSpark pipeline run — see
[`scripts/seed-from-output.ts`](../../../scripts/seed-from-output.ts) for the
script that cropped the text overlay band out of a prior `creative.png` and
saved it as a WebP seed asset.

The seed file lives at:

```
examples/seed-assets/spf-50-sunscreen.webp
```

and is resolved by `LocalStorage`'s read-only seed-dir fallback — see
[`lib/storage/localStorage.ts`](../../../lib/storage/localStorage.ts).

## How to run

From the repo root:

```bash
# Option 1 — POST the brief directly to the pipeline
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  --data @examples/campaigns/coastal-sun-protection/brief.json

# Option 2 — use the dashboard
# Navigate to http://localhost:3000, paste the brief into BriefForm,
# and click Generate.
```

Outputs land in `./output/coastal-sun-protection-summer-2026/`.

## What to look for

- **The reused product renders with no DALL-E call.** Check the manifest —
  the `generationTimeMs` for `spf-50-sunscreen` will be `0` while the
  `after-sun-aloe-gel` product's `generationTimeMs` reflects the real
  DALL-E latency.
- **Both products get the same campaign message overlaid.** The reused asset
  goes through `textOverlay.ts` too, so the "Stay Protected All Summer"
  message is composited onto the bottom 25% band of the reused image just
  like the generated one.
- **All three aspect ratios are produced for both products.** The reused
  1080×810 seed is resized (cover + center) to 1080×1080, 1080×1920, and
  1200×675 by Sharp before overlay.
