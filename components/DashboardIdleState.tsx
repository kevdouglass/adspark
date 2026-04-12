/**
 * DashboardIdleState — empty-state hero for the main canvas.
 *
 * Renders only when `state.status === "idle"` — i.e. the user has
 * landed on the dashboard and has not yet submitted a brief. Replaces
 * the dead grey void that was there previously (both PipelineProgress
 * and CreativeGallery return null on idle, so without this component
 * the canvas is a large empty rectangle).
 *
 * WHY a dedicated component instead of inlining in page.tsx:
 *
 * Keeps `page.tsx` as pure layout and leaves each canvas child
 * responsible for its own state subscription. When the user submits,
 * this component returns null and PipelineProgress takes over — same
 * state-driven pattern the other canvas components use.
 *
 * DESIGN NOTES:
 *
 * - The theme's design principle is "restraint" — one gradient (on the
 *   CTA), flat ink elsewhere. This component uses the gradient only on
 *   the brand dot and the step numbers, matching the sidebar header.
 * - The three aspect ratio previews are dashed outlines, not filled
 *   surfaces, so they read as "placeholders" not "content". They are
 *   rendered at the true 1:1 / 9:16 / 16:9 aspect ratios so the user
 *   sees what each output shape looks like before generating anything.
 * - Spacing is generous (gap-8) because this is the first thing a
 *   reviewer sees — cramped spacing on an empty state feels anxious.
 */

"use client";

import { usePipelineState } from "@/lib/hooks/usePipelineState";

export function DashboardIdleState() {
  const { state } = usePipelineState();

  if (state.status !== "idle") {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ----------------------------------------------------------------- */}
      {/* Hero                                                               */}
      {/* ----------------------------------------------------------------- */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-8">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--accent-gradient)" }}
          />
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Ready to generate
          </p>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--ink)]">
          From campaign brief to publish-ready assets in ~30 seconds.
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-[var(--ink-muted)]">
          Fill in the brief on the left (or pick one of the demo samples)
          and click <span className="font-semibold text-[var(--ink)]">Generate Creatives</span>.
          AdSpark will build an auditable prompt from the brief, call DALL-E 3
          in parallel across every requested aspect ratio, composite the
          campaign message, and deliver organized, platform-ready creatives.
        </p>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* How it works — three-step flow                                     */}
      {/* ----------------------------------------------------------------- */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          How it works
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StepCard
            step={1}
            title="Brief"
            body="Structured campaign input — products, message, audience, tone, season, target aspect ratios."
          />
          <StepCard
            step={2}
            title="Prompt"
            body="Template-based prompt builder injects every brief variable into an auditable DALL-E 3 prompt per aspect ratio."
          />
          <StepCard
            step={3}
            title="Creatives"
            body="Parallel generation, text overlay compositing, and organized output with a per-run manifest for audit."
          />
        </div>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* Aspect ratio previews — dashed outlines hinting at output shape    */}
      {/* ----------------------------------------------------------------- */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Output formats
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <RatioPreview label="1:1" sublabel="Square post" className="aspect-square" />
          <RatioPreview label="9:16" sublabel="Story / Reel" className="aspect-[9/16]" />
          <RatioPreview label="16:9" sublabel="Landscape" className="aspect-[16/9]" />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept in-file because they are private to this view
// ---------------------------------------------------------------------------

function StepCard({
  step,
  title,
  body,
}: {
  step: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: "var(--accent-gradient)" }}
        >
          {step}
        </span>
        <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      </div>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">{body}</p>
    </div>
  );
}

function RatioPreview({
  label,
  sublabel,
  className,
}: {
  label: string;
  sublabel: string;
  className: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        aria-hidden="true"
        className={`w-full rounded-md border-2 border-dashed border-[var(--border-strong)] bg-[var(--surface)] ${className}`}
      />
      <p className="mt-2 text-xs font-medium text-[var(--ink)]">{label}</p>
      <p className="text-[10px] text-[var(--ink-subtle)]">{sublabel}</p>
    </div>
  );
}
