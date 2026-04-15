"use client";

import { SessionHeaderViewModel } from "./types";

type SessionHeaderProps = {
  session: SessionHeaderViewModel;
  onGenerate?: () => void;
};

const statusClasses: Record<SessionHeaderViewModel["status"], string> = {
  draft: "bg-zinc-100 text-zinc-700",
  ready: "bg-blue-50 text-blue-700",
  generating: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};

export function SessionHeader({ session, onGenerate }: SessionHeaderProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-900">{session.title}</h1>
            <span
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide",
                statusClasses[session.status],
              ].join(" ")}
            >
              {session.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{session.updatedAtLabel}</p>
          {session.summary ? (
            <p className="mt-2 text-sm text-zinc-700">{session.summary}</p>
          ) : null}
        </div>

        {onGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Generate creatives
          </button>
        ) : null}
      </div>
    </div>
  );
}
