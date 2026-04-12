/**
 * CreativeGallery — STUB for ADS-006.
 *
 * This is a placeholder component so the dashboard page compiles and
 * downstream hooks work. The full grid UI with modal + prompt inspector
 * lands in ADS-007.
 *
 * Current behavior:
 * - idle: renders nothing
 * - submitting / generating: renders 6 skeleton placeholder cards
 * - complete: renders a minimal grid of creative thumbnails
 * - error: renders nothing (PipelineProgress shows the error)
 *
 * "use client" is required because we consume the React Context.
 */

"use client";

import Image from "next/image";
import { usePipelineState } from "@/lib/hooks/usePipelineState";

const SKELETON_COUNT = 6;

export function CreativeGallery() {
  const { state } = usePipelineState();

  if (state.status === "idle" || state.status === "error") {
    return null;
  }

  if (state.status === "submitting" || state.status === "generating") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  // complete
  const creatives = state.result.creatives;
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

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">
        {creatives.length} creative{creatives.length === 1 ? "" : "s"} generated
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {creatives.map((creative) => (
          <div
            key={`${creative.productSlug}-${creative.aspectRatio}`}
            className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          >
            {/* Local-mode URL is /api/files/...; S3-mode URL is a pre-signed
                URL returned by the pipeline. Both work as <img src>. */}
            <div className="relative aspect-square bg-[var(--border)]">
              <Image
                src={creative.creativeUrl ?? `/api/files/${creative.creativePath}`}
                alt={`${creative.productName} — ${creative.aspectRatio}`}
                fill
                sizes="(max-width: 640px) 100vw, 33vw"
                className="object-cover"
                unoptimized
              />
            </div>
            <div className="p-3">
              <p className="text-sm font-medium text-[var(--ink)]">
                {creative.productName}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">
                {creative.aspectRatio} · {creative.generationTimeMs}ms
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
