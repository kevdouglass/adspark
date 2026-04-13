/**
 * Structured log event names — the canonical set.
 *
 * WHY a constants module:
 *
 * Hardcoded strings at every `ctx.log(...)` call site are:
 *   1. Typo-prone — `"dalle.stared"` vs `"dalle.started"` only surfaces
 *      at log-query time, long after the bug has shipped.
 *   2. Ungreppable — renaming an event means chasing literal strings
 *      across the codebase, and a string hit rate of "one" is common.
 *   3. Invisible to the type-checker — TS can't catch a mis-typed event.
 *
 * Centralizing the names here:
 *   - Compile-time autocompletion at every call site.
 *   - One-stop "what events does this system emit?" manifest — great
 *     for README log-schema sections and for building dashboards/alerts.
 *   - Rename-safe: change the string once, every caller updates.
 *   - Downstream alert/query pipelines can generate their filters by
 *     importing this module instead of maintaining a parallel list.
 *
 * Naming convention:
 *   - Dot-separated, lowercase, domain-first (e.g. `pipeline.start`,
 *     `dalle.failed`, `storage.save.failed`).
 *   - Domain (`request`, `pipeline`, `dalle`, `composite`, `storage`,
 *     `manifest`, `brief`, `orchestrate`) is the grep anchor.
 *   - `.start` / `.done` / `.failed` suffixes for span-style events.
 *   - Single-word names (like `stage`) are OK when the fields carry
 *     enough context (stage name is in the payload).
 *
 * NEW EVENTS: add the constant here, then use `LogEvents.MyNewEvent`
 * at the call site. Do not hardcode strings in production code.
 */
export const LogEvents = {
  // ---- Request lifecycle (emitted by API route handlers) ----
  RequestReceived: "request.received",
  RequestComplete: "request.complete",
  RequestFailed: "request.failed",

  // ---- Pipeline lifecycle (emitted by runPipeline) ----
  PipelineStart: "pipeline.start",
  PipelineComplete: "pipeline.complete",
  Stage: "stage",
  AssetsResolved: "assets.resolved",
  GenerationDone: "generation.done",
  CompositeDone: "composite.done",

  // ---- DALL-E per-image events ----
  DalleStart: "dalle.start",
  DalleDone: "dalle.done",
  DalleFailed: "dalle.failed",

  // ---- Per-image composite span ----
  CompositeImage: "composite.image",

  // ---- Storage writes ----
  StorageSave: "storage.save",
  StorageSaveFailed: "storage.save.failed",
  BriefWrite: "brief.write",
  BriefWriteFailed: "brief.write.failed",
  ManifestWrite: "manifest.write",
  ManifestWriteFailed: "manifest.write.failed",

  // ---- Orchestrate brief route ----
  OrchestrateStart: "orchestrate.start",

  // ---- Multi-agent orchestrator per-phase events ----
  // `phase` field distinguishes triage/draft/review/synthesis.
  // `stakeholder` field names the reviewer when phase="review".
  AgentStart: "agent.phase.start",
  AgentDone: "agent.phase.done",
  AgentFailed: "agent.phase.failed",

  // ---- DALL-E retry attempts (emitted from withRetry) ----
  DalleRetryAttempt: "dalle.retry.attempt",

  // ---- AbortController fired by pipeline budget timeout ----
  PipelineBudgetAbort: "pipeline.budget.abort",

  // ---- Graceful shutdown signal received ----
  ShutdownSignal: "shutdown.signal",
} as const;

/**
 * Union of every defined event name. `ctx.log(event, ...)` accepts this
 * type so the TypeScript compiler catches mis-typed events at the call
 * site instead of at log-query time.
 *
 * Example: `ctx.log(LogEvents.DalleStart, { product, ratio })` — the
 * field keys are free-form (LogFields is a Record<string, unknown>) but
 * the event name is constrained to the canonical set.
 */
export type LogEventName = (typeof LogEvents)[keyof typeof LogEvents];
