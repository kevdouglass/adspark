"use client";

import { useMemo } from "react";
import { SessionSidebar } from "@/components/sessions/SessionSidebar";
import { SessionHeader } from "@/components/sessions/SessionHeader";
import { SessionRunHistory } from "@/components/sessions/SessionRunHistory";
import { EmptySessionState } from "@/components/sessions/EmptySessionState";
import { useSessions } from "@/lib/hooks/sessions/useSessions";
import { useSessionSelection } from "@/lib/hooks/sessions/useSessionSelection";
import { useSessionDetail } from "@/lib/hooks/sessions/useSessionDetail";
import { useSessionRuns } from "@/lib/hooks/sessions/useSessionRuns";

/**
 * This page is an integration example only.
 * It shows the target composition for app/page.tsx after the session UX is adopted.
 * Replace the placeholder brief form / gallery components with your real AdSpark components.
 */
export default function SessionExamplePage() {
  const { sessions, isLoading, createSession } = useSessions();
  const { selectedSessionId, selectSession } = useSessionSelection();
  const { session } = useSessionDetail(selectedSessionId);
  const { runs } = useSessionRuns(selectedSessionId);

  const selectedRunId = runs[0]?.id ?? null;

  const headerVm = useMemo(() => {
    if (!session) return null;
    return {
      id: session.id,
      title: session.title,
      updatedAtLabel: `Updated ${new Date(session.updatedAt).toLocaleString()}`,
      status: session.status,
      summary: session.summary,
    };
  }, [session]);

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)]">
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={selectSession}
        onCreateSession={() => void createSession()}
        isLoading={isLoading}
        briefForm={
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            Replace this placeholder with your real <code>BriefForm</code>, hydrated from the selected session.
          </div>
        }
      />

      <main className="min-w-0 bg-white p-6 md:p-8">
        {!session || !headerVm ? (
          <EmptySessionState
            title="Create or open a campaign session"
            description="Start a new creative campaign session or reopen a previous one to continue iterating on briefs and outputs."
            ctaLabel="Create new campaign"
            onCtaClick={() => void createSession()}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <SessionHeader
              session={headerVm}
              onGenerate={() => {
                // Replace with your session-aware generate handler.
                console.log("Generate for session", session.id);
              }}
            />

            {runs.length === 0 ? (
              <EmptySessionState
                title="This session has no generated creatives yet"
                description="Edit the brief in the sidebar, then generate creatives to populate this workspace."
              />
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                Replace this placeholder with your real <code>CreativeGallery</code> and <code>PipelineProgress</code> composition.
              </div>
            )}

            <SessionRunHistory runs={runs.map((run) => ({
              id: run.id,
              createdAtLabel: new Date(run.createdAt).toLocaleString(),
              status: run.status,
              totalImages: run.totalImages,
              totalTimeMs: run.totalTimeMs,
            }))} selectedRunId={selectedRunId} />
          </div>
        )}
      </main>
    </div>
  );
}
