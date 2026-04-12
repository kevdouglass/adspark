/**
 * AppProviders — client-side provider boundary for the dashboard.
 *
 * Wraps the dashboard tree in `<PipelineStateProvider>` with the real
 * `generateCreatives` client injected. This is the single place where
 * the UI layer connects to the HTTP layer — components below never see
 * the API client directly, they consume `usePipelineState()`.
 *
 * WHY a dedicated provider component (not inlined in page.tsx):
 *
 * Keeps the dependency injection wiring in one file so any future
 * provider additions (theme, auth, telemetry) land here without
 * touching `page.tsx`. Also makes the page.tsx layout code read as
 * pure layout — no mental context-switch to "what's providing state
 * to these components?" every time.
 */

"use client";

import type { ReactNode } from "react";
import { PipelineStateProvider } from "@/lib/hooks/usePipelineState";
import { generateCreatives } from "@/lib/api/client";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PipelineStateProvider generateCreatives={generateCreatives}>
      {children}
    </PipelineStateProvider>
  );
}
