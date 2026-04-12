/**
 * BriefGeneratorAI — the natural-language prompt input for the
 * multi-agent orchestrator.
 *
 * This component is NOT self-submitting. It's a controlled textarea
 * that reports its value to the parent (`BriefForm`) via `onPromptChange`.
 * The actual submission happens when the user clicks the sidebar's
 * single "Generate Creatives" button. That button's handler reads the
 * current prompt value, and — if non-empty — runs the 4-phase
 * multi-agent orchestration BEFORE invoking the DALL-E pipeline.
 *
 * WHY this is no longer a dual-button component:
 *
 * The product shape changed: instead of having the AI generator as a
 * separate "populate the form" step with its own buttons, we now have
 * a single unified "Generate Creatives" flow where an optional prompt
 * runs through the multi-agent orchestrator to refine the brief before
 * the pipeline. One button to rule them all. This component is now
 * just a labeled input — all the action lives in `BriefForm.onSubmit`.
 *
 * WHY the "AI refining" status is shown here and not in PipelineProgress:
 *
 * The orchestration phase happens BEFORE the pipeline starts, so the
 * usePipelineState hook's status is still `idle` or `submitting` during
 * orchestration. Rather than invent new states in the hook, we show the
 * orchestration phase locally in this component. PipelineProgress takes
 * over once the actual pipeline begins.
 */

"use client";

/**
 * Orchestration state exposed to the parent component so the main CTA
 * can reflect the ongoing phase. Only shown while the AI orchestrator
 * is running — once the pipeline starts, `usePipelineState.status`
 * takes over.
 */
export type OrchestrationPhase =
  | "idle"
  | "triaging"
  | "drafting"
  | "reviewing"
  | "synthesizing"
  | "error";

export function BriefGeneratorAI({
  value,
  onChange,
  disabled,
  orchestrationPhase,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  orchestrationPhase: OrchestrationPhase;
}) {
  const MAX_PROMPT_CHARS = 1000;
  const remaining = MAX_PROMPT_CHARS - value.length;

  const phaseLabel: Record<OrchestrationPhase, string> = {
    idle: "",
    triaging: "Orchestrator triaging stakeholder reviewers...",
    drafting: "Campaign Manager drafting initial brief...",
    reviewing:
      "Creative Director, Regional Lead, Legal, and CMO reviewing in parallel...",
    synthesizing: "Orchestrator synthesizing final brief...",
    error: "",
  };

  const isRunning =
    orchestrationPhase !== "idle" && orchestrationPhase !== "error";

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: "var(--accent-gradient)" }}
        >
          AI
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          AI Brief Orchestrator
        </h2>
      </div>

      <p className="mb-3 text-xs text-[var(--ink-subtle)]">
        Describe your campaign in plain English. A team of specialist AI
        agents (Campaign Manager, Creative Director, Regional Lead,
        Legal, CMO) will draft, review, and synthesize a brief before
        the pipeline runs. Leave blank to skip the orchestration and
        submit the form as-is.
      </p>

      <label htmlFor="ai-brief-prompt" className="sr-only">
        Campaign description
      </label>
      <textarea
        id="ai-brief-prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isRunning}
        maxLength={MAX_PROMPT_CHARS}
        placeholder="e.g. Launch a premium ceramic coffee mug line for remote workers who value quiet mornings. Earthy tones, artisan vibe, fall launch."
        rows={3}
        className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] disabled:opacity-50"
      />
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[10px] text-[var(--ink-subtle)]">
          {remaining} characters remaining
        </p>
        {isRunning && (
          <p
            role="status"
            aria-live="polite"
            className="text-[10px] font-medium text-[var(--accent)]"
          >
            {phaseLabel[orchestrationPhase]}
          </p>
        )}
      </div>
    </section>
  );
}
