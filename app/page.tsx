/**
 * Dashboard — AdSpark's only page.
 *
 * Firefly-style layout: narrow sidebar hosting the BriefForm on the
 * left, wide canvas hosting the PipelineProgress + CreativeGallery
 * on the right. Single-column stacked layout on mobile (<1024px).
 *
 * This page is marked `"use client"` because the entire dashboard tree
 * consumes the PipelineStateProvider context. See ADR-007 for the full
 * rationale on why the page is a client component rather than a server
 * component with a client wrapper.
 */

"use client";

import { AppProviders } from "@/components/providers/AppProviders";
import { BriefForm } from "@/components/BriefForm";
import { PipelineProgress } from "@/components/PipelineProgress";
import { CreativeGallery } from "@/components/CreativeGallery";
import { DashboardIdleState } from "@/components/DashboardIdleState";
import { RunSummaryPanel } from "@/components/RunSummaryPanel";
import { PipelineTimingChart } from "@/components/PipelineTimingChart";

export default function Home() {
  return (
    <AppProviders>
      <div className="flex min-h-screen flex-col bg-[var(--bg)] lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
        {/* ----------------------------------------------------------- */}
        {/* Sidebar — 340px fixed, hosts the BriefForm                   */}
        {/* ----------------------------------------------------------- */}
        <aside className="w-full border-b border-[var(--border)] bg-[var(--bg)] lg:h-screen lg:w-[340px] lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            {/* Brand header */}
            <header className="border-b border-[var(--border)] px-6 py-5">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: "var(--accent-gradient)" }}
                />
                <h1 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
                  AdSpark
                </h1>
              </div>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Creative Automation for Social Ad Campaigns
              </p>
            </header>

            {/* Form — scrollable within the sidebar */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <BriefForm />
            </div>
          </div>
        </aside>

        {/* ----------------------------------------------------------- */}
        {/* Canvas — wide area hosting idle hero / progress / gallery    */}
        {/* ----------------------------------------------------------- */}
        <main className="flex-1 overflow-y-auto bg-[var(--surface)] p-6 lg:p-8">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            <DashboardIdleState />
            <PipelineProgress />
            <RunSummaryPanel />
            <PipelineTimingChart />
            <CreativeGallery />
          </div>
        </main>
      </div>
    </AppProviders>
  );
}
