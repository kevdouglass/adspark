"use client";

import { ReactNode } from "react";
import { SessionList } from "./SessionList";
import { SessionListItemViewModel } from "./types";

type SessionSidebarProps = {
  sessions: SessionListItemViewModel[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  briefForm: ReactNode;
  isLoading?: boolean;
};

export function SessionSidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  briefForm,
  isLoading,
}: SessionSidebarProps) {
  return (
    <aside className="flex h-full w-full max-w-md flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              AdSpark
            </div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">
              Creative sessions
            </div>
          </div>

          <button
            type="button"
            onClick={onCreateSession}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            + New campaign
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent
          </div>
          {isLoading ? (
            <div className="text-sm text-zinc-500">Loading sessions…</div>
          ) : (
            <SessionList
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
            />
          )}
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Brief editor
          </div>
          {briefForm}
        </div>
      </div>
    </aside>
  );
}
