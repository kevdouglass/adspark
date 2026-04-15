"use client";

import { SessionListItemViewModel } from "./types";

type SessionListItemProps = {
  session: SessionListItemViewModel;
  isSelected: boolean;
  onClick: () => void;
};

const statusClasses: Record<SessionListItemViewModel["status"], string> = {
  draft: "bg-zinc-100 text-zinc-700",
  ready: "bg-blue-50 text-blue-700",
  generating: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};

export function SessionListItem({
  session,
  isSelected,
  onClick,
}: SessionListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-xl border p-3 text-left transition",
        isSelected
          ? "border-blue-300 bg-blue-50 shadow-sm"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">
            {session.title}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{session.updatedAtLabel}</div>
        </div>

        <span
          className={[
            "shrink-0 rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide",
            statusClasses[session.status],
          ].join(" ")}
        >
          {session.status}
        </span>
      </div>

      {session.summary ? (
        <div className="mt-2 line-clamp-2 text-xs text-zinc-600">
          {session.summary}
        </div>
      ) : null}
    </button>
  );
}
