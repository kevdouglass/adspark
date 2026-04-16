"use client";

import { SessionRunListItemViewModel } from "./types";

type SessionRunHistoryProps = {
  runs: SessionRunListItemViewModel[];
  selectedRunId?: string | null;
  onSelectRun?: (runId: string) => void;
};

export function SessionRunHistory({
  runs,
  selectedRunId,
  onSelectRun,
}: SessionRunHistoryProps) {
  if (runs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Previous runs
      </h2>

      <div className="mt-4 flex flex-col gap-2">
        {runs.map((run) => {
          const isSelected = run.id === selectedRunId;
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelectRun?.(run.id)}
              aria-pressed={isSelected}
              className={[
                "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left",
                isSelected
                  ? "border-blue-300 bg-blue-50"
                  : "border-zinc-200 bg-white hover:bg-zinc-50",
              ].join(" ")}
            >
              <div>
                <div className="text-sm font-medium text-zinc-900">
                  {run.createdAtLabel}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {run.totalImages ?? 0} creatives
                  {run.totalTimeMs ? ` · ${(run.totalTimeMs / 1000).toFixed(1)}s` : ""}
                </div>
              </div>

              <div className="text-xs uppercase tracking-wide text-zinc-500">
                {run.status}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
