/**
 * CreativeGallery — staggered masonry gallery of generated creatives.
 *
 * Renders one of four states from the pipeline hook:
 *
 * - idle / error: null (the idle-state hero and the progress component
 *   own those canvas states; CreativeGallery stays out of the way)
 * - submitting / generating: 6 skeleton cards in varying aspect ratios
 *   to hint at the masonry shape before real content arrives
 * - complete with 0 creatives: a terse "no creatives" card
 * - complete with creatives: the real staggered grid below
 *
 * WHY a CSS-columns masonry (not grid-template-rows: masonry):
 *
 * `grid-template-rows: masonry` is Firefox-only as of 2026. CSS multi-
 * column layout (`columns-*` in Tailwind) has universal support and is
 * the idiomatic way to get a masonry flow in static content. Each card
 * gets `break-inside-avoid` so the browser doesn't split a card across
 * columns, and each card's own `mb-4` creates vertical separation
 * between stacked items in the same column.
 *
 * WHY we pre-sort creatives into a balanced packing order:
 *
 * CSS columns fills columns top-to-bottom from the input order — items
 * 1-2 into col 1, items 3-4 into col 2, etc. With 6 items of mixed
 * aspect ratios (2 × 9:16, 2 × 16:9, 2 × 1:1), naive insertion order
 * would create wildly uneven columns. We solve this analytically by
 * ordering the creatives so each column's total height is roughly
 * equal. See `BALANCED_PACKING_ORDER` below for the math.
 *
 * WHY each card respects its real aspect ratio:
 *
 * Previously every card was forced to `aspect-square`, which made 9:16
 * and 16:9 images get cropped by `object-cover`. The text overlay
 * (composited at the bottom of the source image) is exactly where the
 * square crop cuts — so users saw their captions disappear. Respecting
 * the creative's real `aspectRatio` in the wrapper div fixes this AND
 * gives the gallery the visual variety a masonry layout is supposed to
 * showcase.
 */

"use client";

import Image from "next/image";
import { usePipelineState } from "@/lib/hooks/usePipelineState";
import type { ApiCreativeOutput } from "@/lib/api/types";
import type { AspectRatio } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Layout math — balanced column packing for 6 creatives
// ---------------------------------------------------------------------------

/**
 * Preferred ordering weight per aspect ratio. Lower weight = earlier in
 * the sorted list = goes into earlier columns first.
 *
 * With 3 columns and 6 items, CSS columns fills items 1-2 into col 1,
 * items 3-4 into col 2, items 5-6 into col 3. We pair 9:16 (tall) with
 * 16:9 (shallow) so each of those columns sums to ~2.34 "height units"
 * per unit of column width. The 1:1 squares go together in the last
 * column at ~2.00 units. The resulting column heights vary by only
 * ~15% — enough to feel staggered but balanced enough to read as
 * intentional rather than accidental.
 */
const ASPECT_PACKING_WEIGHT: Record<AspectRatio, number> = {
  "9:16": 0,
  "16:9": 1,
  "1:1": 2,
};

/**
 * Interleaving sort. Pairs 9:16 with 16:9 so the tall hero cards are
 * anchored by the wide landscape cards in the same column, and the
 * 1:1 squares settle into the shortest column.
 */
function balancedCreatives(
  creatives: readonly ApiCreativeOutput[]
): ApiCreativeOutput[] {
  // Stable-sort within an aspect group so we preserve the pipeline's
  // original product order (product-1 before product-2) within each
  // ratio bucket.
  const sorted = [...creatives].sort(
    (a, b) =>
      ASPECT_PACKING_WEIGHT[a.aspectRatio] -
      ASPECT_PACKING_WEIGHT[b.aspectRatio]
  );

  // Interleave 9:16 and 16:9 so the two tall items don't stack in the
  // same column. Only matters when we have at least one of each.
  const tall = sorted.filter((c) => c.aspectRatio === "9:16");
  const wide = sorted.filter((c) => c.aspectRatio === "16:9");
  const square = sorted.filter((c) => c.aspectRatio === "1:1");
  const interleaved: ApiCreativeOutput[] = [];
  const interleaveLength = Math.max(tall.length, wide.length);
  for (let i = 0; i < interleaveLength; i++) {
    if (tall[i]) interleaved.push(tall[i]);
    if (wide[i]) interleaved.push(wide[i]);
  }
  return [...interleaved, ...square];
}

// ---------------------------------------------------------------------------
// Aspect helpers
// ---------------------------------------------------------------------------

/**
 * Map an aspect ratio to its Tailwind aspect-ratio utility. We prefer
 * utility classes (vs. inline style) so PurgeCSS and Tailwind's JIT
 * understand the shape of the bundle.
 */
function aspectClass(ratio: AspectRatio): string {
  switch (ratio) {
    case "1:1":
      return "aspect-square";
    case "9:16":
      return "aspect-[9/16]";
    case "16:9":
      return "aspect-[16/9]";
  }
}

/**
 * Marketing label for each ratio — matches the target platform users
 * actually publish to. Makes the gallery read as "publish-ready" rather
 * than as a tech dump of dimensions.
 */
function platformLabel(ratio: AspectRatio): string {
  switch (ratio) {
    case "1:1":
      return "Feed Post";
    case "9:16":
      return "Story / Reel";
    case "16:9":
      return "Landscape";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SKELETON_SHAPES: AspectRatio[] = [
  "9:16",
  "16:9",
  "9:16",
  "16:9",
  "1:1",
  "1:1",
];

export function CreativeGallery() {
  const { state } = usePipelineState();

  if (state.status === "idle" || state.status === "error") {
    return null;
  }

  // Skeleton preview during generation — uses the same balanced packing
  // order so the viewer's eye is already accustomed to the layout when
  // the real images pop in.
  if (state.status === "submitting" || state.status === "generating") {
    return (
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
        {SKELETON_SHAPES.map((ratio, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`mb-4 break-inside-avoid animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] ${aspectClass(ratio)}`}
          />
        ))}
      </div>
    );
  }

  // complete
  const creatives = state.result.creatives;
  const requestId = state.result.requestId;
  if (creatives.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm text-[var(--ink-muted)]">
          The pipeline returned no creatives. See the errors in the response
          for details.
        </p>
      </div>
    );
  }

  /**
   * Cache-busting: the storage path for each creative is deterministic,
   * so re-running the same brief would produce an identical URL and the
   * browser would serve a stale cached image. Appending `?v={requestId}`
   * guarantees a unique URL per generation.
   */
  const withCacheBuster = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}v=${requestId}`;

  const ordered = balancedCreatives(creatives);

  return (
    <div>
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {creatives.length} creative{creatives.length === 1 ? "" : "s"} ready
        </h2>
        <p className="text-xs text-[var(--ink-muted)]">
          Generated in {(state.result.totalTimeMs / 1000).toFixed(1)}s
        </p>
      </header>

      {/* ----------------------------------------------------------- */}
      {/* Masonry — CSS columns, balanced packing order                */}
      {/* ----------------------------------------------------------- */}
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
        {ordered.map((creative) => (
          <CreativeCard
            key={`${creative.productSlug}-${creative.aspectRatio}`}
            creative={creative}
            imageSrc={withCacheBuster(
              creative.creativeUrl ?? `/api/files/${creative.creativePath}`
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreativeCard — one tile in the masonry
// ---------------------------------------------------------------------------

function CreativeCard({
  creative,
  imageSrc,
}: {
  creative: ApiCreativeOutput;
  imageSrc: string;
}) {
  return (
    <figure
      className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      {/* Image — the wrapper uses the creative's REAL aspect ratio so
          the text overlay composited at the bottom of the image is
          never cropped. `object-cover` on the <Image> is still safe
          because the container matches the image's native aspect. */}
      <div
        className={`relative w-full overflow-hidden bg-[var(--surface)] ${aspectClass(creative.aspectRatio)}`}
      >
        <Image
          src={imageSrc}
          alt={`${creative.productName} — ${platformLabel(creative.aspectRatio)}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover"
          unoptimized
        />

        {/* Aspect ratio pill — top-right corner, subtle glass look */}
        <div className="absolute right-2 top-2">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {creative.aspectRatio}
          </span>
        </div>
      </div>

      {/* Metadata label */}
      <figcaption className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">
            {creative.productName}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            {platformLabel(creative.aspectRatio)}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-medium text-[var(--ink-muted)]">
            {(creative.generationTimeMs / 1000).toFixed(1)}s
          </p>
          <p className="text-[10px] text-[var(--ink-subtle)]">gen time</p>
        </div>
      </figcaption>
    </figure>
  );
}
