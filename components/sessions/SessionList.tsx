"use client";

import { SessionListItem } from "./SessionListItem";
import { SessionListItemViewModel } from "./types";

type SessionListProps = {
  sessions: SessionListItemViewModel[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
};

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
        No campaign sessions yet. Create one to start building creatives.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          session={session}
          isSelected={session.id === selectedSessionId}
          onClick={() => onSelectSession(session.id)}
        />
      ))}
    </div>
  );
}
