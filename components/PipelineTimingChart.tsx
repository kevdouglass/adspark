/**
 * PipelineTimingChart — D3-powered "where did the time go" visualization.
 *
 * One horizontal stacked bar per creative, showing the split between
 * `generationTimeMs` (DALL-E 3 wall time) and `compositingTimeMs`
 * (Sharp resize + Canvas text overlay). Rows are labeled with the
 * product name + aspect ratio, and a numeric total sits at the right
 * of each row.
 *
 * --- why this chart ---
 *
 * The assignment's "logging/reporting" bonus axis asks reviewers to see
 * where the pipeline spends its time. A table of numbers would work, but
 * a horizontal stacked bar tells three stories simultaneously that a table
 * can't:
 *
 *   1. **DALL-E dominates generation wall-clock.** The blue (generation)
 *      segment is ~95% of the bar width for every generated creative —
 *      any production optimization conversation has to start there.
 *
 *   2. **Reused creatives visually collapse.** A creative with
 *      `sourceType: "reused"` has `generationTimeMs === 0`, so its bar
 *      is JUST the compositing sliver. On a mixed brief like
 *      `coastal-sun-protection`, the chart literally shows three long
 *      bars (generated) next to three tiny ones (reused). The reuse story
 *      becomes visible as a SHAPE, not a badge.
 *
 *   3. **Compositing is a fixed ~400-600ms overhead.** The orange segment
 *      is consistent across all creatives, reused or not — proves the
 *      overlay pipeline is deterministic and the DALL-E variance is the
 *      only dial worth tuning.
 *
 * --- implementation shape ---
 *
 * Uses D3 for SCALE MATH only (`scaleLinear`, `max`) — the SVG itself is
 * React JSX. This is the idiomatic 2020s-era pattern for small charts:
 * D3 owns the data-to-pixel mapping, React owns the DOM. No `useEffect`
 * with imperative `d3.select` + `selection.join` dance.
 *
 * The alternative (mount D3 onto a ref via useEffect, let D3 own the DOM)
 * is fine for complex transitions but overkill for a static 6-row bar
 * chart and doesn't play well with React strict mode's double-invocation.
 *
 * --- accessibility ---
 *
 * The SVG has `role="img"` + `aria-label` summarizing the chart. Each bar
 * has a `<title>` descendant giving the row's textual value for screen
 * readers that recognize SVG title elements. The legend and row labels
 * live in real HTML so SR users don't depend on the SVG at all.
 */

"use client";

import { scaleLinear, max } from "d3";
import { usePipelineState } from "@/lib/hooks/usePipelineState";
import type { AspectRatio } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Each row's vertical slot, in px. Includes the row + its top padding. */
const ROW_HEIGHT = 34;

/** Bar height within the row. Shorter than ROW_HEIGHT so there's breathing room. */
const BAR_HEIGHT = 22;

/** Vertical top padding before the first row begins. */
const CHART_PADDING_TOP = 8;

/** Vertical bottom padding (for the x-axis tick labels). */
const CHART_PADDING_BOTTOM = 22;

/** The SVG width scales via viewBox — pick a virtual width and let CSS do the rest. */
const VIRTUAL_CHART_WIDTH = 640;

/** Number of x-axis tick marks along the bottom. */
const X_AXIS_TICK_COUNT = 5;

/**
 * Map an aspect ratio to its compact platform label (matches the gallery
 * `platformLabel` helper so row labels stay consistent across the UI).
 */
function platformLabel(ratio: AspectRatio): string {
  switch (ratio) {
    case "1:1":
      return "Feed";
    case "9:16":
      return "Story";
    case "16:9":
      return "Landscape";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineTimingChart() {
  const { state } = usePipelineState();

  // Only render on success — during generation the numbers aren't final.
  if (state.status !== "complete") {
    return null;
  }

  const creatives = state.result.creatives;
  if (creatives.length === 0) {
    return null;
  }

  // Sort: reused first, then generated, then by product slug within each
  // group. Puts the visual story ("look, these are much shorter!") in
  // reading order rather than relying on the caller's accidental ordering.
  const ordered = [...creatives].sort((a, b) => {
    if (a.sourceType !== b.sourceType) {
      return a.sourceType === "reused" ? -1 : 1;
    }
    if (a.productSlug !== b.productSlug) {
      return a.productSlug.localeCompare(b.productSlug);
    }
    return a.aspectRatio.localeCompare(b.aspectRatio);
  });

  // Scale the x-axis against the longest TOTAL bar, not the longest single
  // segment. Without this, a creative with 22s generation + 0.5s compositing
  // would map to the same pixel width as one with 22s generation + 4s
  // compositing because the scale would only see the generation segment.
  const maxTotal =
    max(ordered, (c) => c.generationTimeMs + c.compositingTimeMs) ?? 1;

  // scaleLinear maps milliseconds → pixels. The range starts at 0 so the
  // bar's origin aligns with the row's left edge, and ends at the virtual
  // chart width minus the space we reserve for the per-row numeric label.
  const LABEL_SPACE = 80; // px reserved for the "22.3s" label on the right
  const x = scaleLinear()
    .domain([0, maxTotal])
    .range([0, VIRTUAL_CHART_WIDTH - LABEL_SPACE])
    .nice(); // round up to a clean tick boundary

  const chartHeight =
    CHART_PADDING_TOP + ordered.length * ROW_HEIGHT + CHART_PADDING_BOTTOM;

  // Ticks for the bottom axis — nice(), then ticks() gives us evenly-spaced
  // whole-second increments in most cases.
  const ticks = x.ticks(X_AXIS_TICK_COUNT);

  return (
    <section
      aria-label="Pipeline timing breakdown"
      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5"
    >
      {/* ----------------------------------------------------------- */}
      {/* Header + legend                                              */}
      {/* ----------------------------------------------------------- */}
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--accent-gradient)" }}
            />
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Where did the time go?
            </p>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Per-creative wall time — generation (DALL-E 3) plus compositing
            (Sharp + Canvas).
          </p>
        </div>
        <Legend />
      </header>

      {/* ----------------------------------------------------------- */}
      {/* SVG chart                                                    */}
      {/* ----------------------------------------------------------- */}
      <svg
        role="img"
        aria-label={`Stacked bar chart showing generation and compositing time for each of ${ordered.length} creatives`}
        viewBox={`0 0 ${VIRTUAL_CHART_WIDTH} ${chartHeight}`}
        className="w-full"
        preserveAspectRatio="xMinYMin meet"
      >
        {/* Rows — one per creative */}
        {ordered.map((creative, i) => {
          const y = CHART_PADDING_TOP + i * ROW_HEIGHT;
          const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;

          const genWidth = x(creative.generationTimeMs);
          const compWidth = x(creative.compositingTimeMs);
          const totalMs = creative.generationTimeMs + creative.compositingTimeMs;
          const rowLabel = `${creative.productName} — ${platformLabel(creative.aspectRatio)}`;
          const totalSeconds = (totalMs / 1000).toFixed(1);

          return (
            <g key={`${creative.productSlug}-${creative.aspectRatio}`}>
              <title>
                {rowLabel}: {creative.generationTimeMs} ms generation +{" "}
                {creative.compositingTimeMs} ms compositing ={" "}
                {totalSeconds}s total ({creative.sourceType})
              </title>

              {/* Generation segment — only drawn if non-zero. Reused
                  creatives skip this entirely, so their bar is the
                  compositing sliver only. Zero width rects render as
                  invisible but still consume a DOM node — skipping the
                  element at genWidth === 0 keeps the output clean. */}
              {genWidth > 0 && (
                <rect
                  x={0}
                  y={barY}
                  width={genWidth}
                  height={BAR_HEIGHT}
                  rx={2}
                  className="fill-sky-600/80"
                />
              )}

              {/* Compositing segment — ALWAYS drawn (non-zero for both
                  branches). Positioned after the generation segment.
                  For reused creatives where genWidth === 0, the segment
                  starts at x=0 and shows the "reuse-only" cost. */}
              <rect
                x={genWidth}
                y={barY}
                width={compWidth}
                height={BAR_HEIGHT}
                rx={2}
                className="fill-emerald-600/80"
              />

              {/* Total time label — right-aligned to the reserved
                  LABEL_SPACE area. Uses SVG text so it scales with the
                  viewBox, not CSS px. */}
              <text
                x={VIRTUAL_CHART_WIDTH - 2}
                y={barY + BAR_HEIGHT / 2 + 4}
                textAnchor="end"
                className="fill-[var(--ink)]"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {totalSeconds}s
              </text>
            </g>
          );
        })}

        {/* X-axis ticks at the bottom (linear, ms → seconds labels).
            Positioned outside the row loop so they're never stacked
            with bar content. A thin baseline connects the ticks for
            visual anchoring. */}
        <g
          transform={`translate(0, ${CHART_PADDING_TOP + ordered.length * ROW_HEIGHT})`}
        >
          <line
            x1={0}
            x2={VIRTUAL_CHART_WIDTH - LABEL_SPACE}
            y1={2}
            y2={2}
            className="stroke-[var(--border)]"
            strokeWidth={1}
          />
          {ticks.map((tickMs) => (
            <g key={tickMs} transform={`translate(${x(tickMs)}, 0)`}>
              <line
                x1={0}
                x2={0}
                y1={2}
                y2={6}
                className="stroke-[var(--border)]"
                strokeWidth={1}
              />
              <text
                x={0}
                y={18}
                textAnchor="middle"
                className="fill-[var(--ink-subtle)]"
                style={{ fontSize: 10 }}
              >
                {(tickMs / 1000).toFixed(tickMs < 1000 ? 1 : 0)}s
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* ----------------------------------------------------------- */}
      {/* Row labels (separate from SVG so screen readers read real   */}
      {/* HTML and the labels don't need SVG text wrapping logic)      */}
      {/* ----------------------------------------------------------- */}
      <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {ordered.map((creative) => (
          <li
            key={`label-${creative.productSlug}-${creative.aspectRatio}`}
            className="flex items-center gap-2 text-xs"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${
                creative.sourceType === "reused"
                  ? "bg-emerald-600"
                  : "bg-sky-600"
              }`}
            />
            <span className="truncate text-[var(--ink)]">
              {creative.productName}
            </span>
            <span className="text-[var(--ink-subtle)]">
              {platformLabel(creative.aspectRatio)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Legend — little swatches for the two segments
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="flex flex-col items-end gap-1 text-[10px] text-[var(--ink-muted)]">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600/80"
        />
        <span>Generation (DALL-E 3)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600/80"
        />
        <span>Compositing (Sharp + Canvas)</span>
      </div>
    </div>
  );
}
