/**
 * PipelineProgress — STUB for ADS-006.
 *
 * This is a placeholder component so the dashboard page compiles and
 * the `usePipelineState` hook contract is exercised end-to-end. The
 * full stepper UI (5 pills, pulsing animation, error state, retry
 * button) will land in ADS-008.
 *
 * Current behavior:
 * - idle: renders nothing (sidebar + empty canvas)
 * - submitting / generating: shows "Generating..." text + indeterminate bar
 * - complete: shows success count
 * - error: shows the error message + reset button
 *
 * This stub is ENOUGH to prove the hook wires correctly and to make the
 * manual smoke test (filling the form + clicking Generate) produce
 * visible UI feedback.
 */

"use client";

import { usePipelineState } from "@/lib/hooks/usePipelineState";

export function PipelineProgress() {
  const { state, reset } = usePipelineState();

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "submitting" || state.status === "generating") {
    const label =
      state.status === "submitting"
        ? "Submitting brief..."
        : `Generating: ${state.stage}`;
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
      >
        <p className="text-sm font-medium text-[var(--ink-muted)]">
          {label}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
          {/* Indeterminate bar — the animation is a pulsing gradient */}
          <div
            className="h-full animate-pulse rounded-full"
            style={{ background: "var(--accent-gradient)", width: "60%" }}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--ink-subtle)]">
          This usually takes 15-30 seconds for a 6-image batch.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[var(--error)] bg-red-50 p-6"
      >
        <p className="text-sm font-semibold text-[var(--error)]">
          Generation failed
        </p>
        <p className="mt-2 text-sm text-[var(--ink)]">{state.error.message}</p>
        <p className="mt-2 font-mono text-xs text-[var(--ink-muted)]">
          Request id: {state.error.requestId}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
        >
          Try again
        </button>
      </div>
    );
  }

  // complete — PipelineProgress gets out of the way so the gallery can
  // take the viewport. Returning null is intentional.
  return null;
}
