/**
 * Backend Service Factory — creates pipeline dependencies per request.
 *
 * WHY per-request, not singleton:
 * Vercel serverless functions have no shared state across invocations.
 * A module-level singleton would appear to work locally but break
 * unpredictably on serverless (stale connections, memory leaks across
 * cold starts). Creating fresh instances per request is the correct pattern.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 */

import OpenAI from "openai";
import { createStorage } from "@/lib/storage";
import type { StorageProvider } from "@/lib/pipeline/types";
import type { LogEventName } from "./logEvents";
import {
  PIPELINE_BUDGET_MS,
  CLIENT_REQUEST_TIMEOUT_MS,
} from "./timeouts";
import { isShuttingDown } from "./shutdown";

// Re-export so callers that only need the names can import one module.
export { LogEvents } from "./logEvents";
export type { LogEventName } from "./logEvents";
// Re-export shutdown helpers so existing call sites can keep importing
// them from @/lib/api/services. The real implementation lives in
// ./shutdown.ts which has no node-only transitive imports, letting
// instrumentation.ts import it from the edge bundle safely.
export { markShuttingDown, isShuttingDown } from "./shutdown";

/**
 * A structured log record. Every entry carries the request correlation
 * (requestId + elapsed ms) plus the event name and arbitrary fields.
 * Shape is stable — downstream grep/jq pipelines depend on it.
 */
export interface LogRecord {
  t: string;
  requestId: string;
  elapsed: number;
  event: string;
  [key: string]: unknown;
}

export type LogFields = Record<string, unknown>;
export type LogSink = (record: LogRecord) => void;

/**
 * Default log sink. Writes one JSON line per event to stdout so:
 *
 *  - Vercel Functions log viewer ingests it as-is
 *  - `docker logs adspark | jq .` works out of the box
 *  - `grep requestId=<uuid>` gives the full trace for one request
 *
 * Silenced in NODE_ENV=test to keep vitest output clean. Tests that
 * want to ASSERT on events install their own collector via setLogSink()
 * and restore the previous sink in afterEach.
 *
 * Deliberate non-choices: no pino, no winston, no otel exporter. Stdout
 * + JSON is the highest-leverage logging surface for a serverless +
 * container target, and a helper this small has zero upgrade cost if
 * we ever want to swap it.
 */
let activeSink: LogSink = (record) => {
  if (process.env.NODE_ENV === "test") return;
  console.log(JSON.stringify(record));
};

/**
 * Replace the active log sink. Returns the previous sink so tests can
 * restore it after each case. Intended for tests only — production code
 * emits events via `ctx.log(...)`.
 */
export function setLogSink(sink: LogSink): LogSink {
  const prev = activeSink;
  activeSink = sink;
  return prev;
}

/**
 * Per-request structured logger.
 *
 * Wraps the active sink with a stable requestId + monotonic elapsed
 * counter so every event in a request carries matching correlation.
 *
 * WHY a class rather than a bare closure:
 *   - Future event levels (debug/warn/error) can be added as methods on
 *     this class without widening every RequestContext call site.
 *   - `instanceof RequestLogger` gives tests a firm type to assert on.
 *   - A single `new RequestLogger(uuid, now)` is the single construction
 *     point — no duplicated closure code in tests, factories, or mocks.
 *
 * Events are typed via `LogEventName` so TS catches mis-typed event
 * names at the call site. Field payloads are free-form Record<string,
 * unknown> because different events carry different shapes and forcing
 * a discriminated union would make every call site noisy.
 */
export class RequestLogger {
  constructor(
    public readonly requestId: string,
    public readonly startedAtPerfMs: number
  ) {}

  log(event: LogEventName, fields: LogFields = {}): void {
    activeSink({
      t: new Date().toISOString(),
      requestId: this.requestId,
      elapsed: Math.round(performance.now() - this.startedAtPerfMs),
      event,
      ...fields,
    });
  }
}

export interface RequestContext {
  requestId: string;
  /**
   * High-resolution timestamp from `performance.now()` at request start.
   * Monotonic, relative to process start — NOT a wall-clock epoch time.
   * Use only for intra-request duration math: `performance.now() - startedAtPerfMs`.
   * Do NOT serialize as a timestamp or send to external systems expecting epoch ms.
   */
  startedAtPerfMs: number;
  /**
   * Emit a structured log event bound to this request. Delegates to
   * the RequestLogger instance created at request start — see its class
   * JSDoc for the full behavior contract.
   *
   * Event name MUST come from `LogEvents` (lib/api/logEvents.ts) — the
   * compiler rejects arbitrary strings so typos can't ship.
   *
   * Example:
   *   ctx.log(LogEvents.DalleStart, { product: "cold-brew", ratio: "1:1" });
   */
  log: (event: LogEventName, fields?: LogFields) => void;
}

/**
 * Create a new OpenAI client configured for DALL-E 3 pipeline use.
 *
 * - timeout: 60s per request. This caps ONE HTTP attempt, not the
 *   whole orchestration. DALL-E 3 p75 latency is ~22-25s on Tier 1
 *   but p95 can push past 30s — the previous 30s ceiling caused
 *   spurious AbortErrors during normal slow periods. 60s gives
 *   enough headroom for p95 while staying far below the 120s
 *   PIPELINE_BUDGET_MS outer boundary.
 * - maxRetries: 0 — we handle retries ourselves via `withRetry()`
 *   for finer control over which errors are retryable (content
 *   policy 400s are non-retryable, 429/500 are retryable with
 *   exponential backoff).
 *
 * The client-level `timeout` interacts with the per-request `{ signal }`
 * we thread in for pipeline-budget preemption: whichever fires first
 * wins. In practice, the per-request timeout catches genuinely hung
 * network connections (undici keepalive edge cases) while the signal
 * catches budget exhaustion. Both land as AbortError in the retry
 * classifier, which treats them as non-retryable.
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required. " +
        "Set it in .env.local for local dev or Vercel env vars for production."
    );
  }
  return new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
}

export function getStorage(): StorageProvider {
  return createStorage();
}

export function createRequestContext(): RequestContext {
  const requestId = crypto.randomUUID();
  const startedAtPerfMs = performance.now();
  const logger = new RequestLogger(requestId, startedAtPerfMs);
  return {
    requestId,
    startedAtPerfMs,
    log: (event, fields) => logger.log(event, fields),
  };
}

/**
 * Validate all required environment variables at route entry.
 * Fails fast with a descriptive error listing every missing variable
 * at once, rather than surfacing them one at a time during execution.
 *
 * Throws a `MissingConfigurationError` that API routes catch and map
 * to HTTP 500 with `MISSING_CONFIGURATION` code.
 */
export function validateRequiredEnv(): void {
  const missing: string[] = [];

  if (!process.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }

  // S3 vars are only required when STORAGE_MODE=s3
  if (process.env.STORAGE_MODE === "s3" && !process.env.S3_BUCKET) {
    missing.push("S3_BUCKET (required when STORAGE_MODE=s3)");
  }

  if (missing.length > 0) {
    throw new MissingConfigurationError(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Thrown when required env vars are missing.
 * API routes catch this and map to 500 INTERNAL_ERROR / MISSING_CONFIGURATION.
 *
 * `Object.setPrototypeOf` is called in the constructor to restore the
 * prototype chain across ES5/ES6 target boundaries — without this,
 * `error instanceof MissingConfigurationError` can return false in
 * transpiled environments.
 */
export class MissingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigurationError";
    Object.setPrototypeOf(this, MissingConfigurationError.prototype);
  }
}

/**
 * Validate env vars required specifically for the upload flow.
 *
 * Scoped separately from `validateRequiredEnv()` because the upload
 * route does NOT need `OPENAI_API_KEY` — upload never calls OpenAI.
 * Both helpers live in the same module so grep `validate.*Env` finds
 * the full surface.
 *
 * Called from `app/api/upload/route.ts` at request entry. Throws
 * `MissingConfigurationError` for the route to catch and map to a 500
 * `MISSING_CONFIGURATION` response.
 *
 * See SPIKE-003 §Decision D1 and INVESTIGATION-003 §Adjustment 4.
 */
export function validateUploadEnv(): void {
  const missing: string[] = [];
  if (getStorageMode() === "s3" && !process.env.S3_BUCKET) {
    missing.push("S3_BUCKET (required when STORAGE_MODE=s3)");
  }
  if (missing.length > 0) {
    throw new MissingConfigurationError(
      `Upload flow missing required env vars: ${missing.join(", ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// Health + shutdown — container platform operations surface
// ---------------------------------------------------------------------------

/**
 * Read + normalize the configured storage mode from the environment.
 *
 * Centralized here so the healthz route, the files route, and the
 * createStorage factory all agree on one interpretation of the env var.
 * Trimming + lowercasing tolerates the common typos ("local ", "LOCAL",
 * "Local") that plague manual Vercel env var entry.
 */
export function getStorageMode(): "local" | "s3" {
  const raw = (process.env.STORAGE_MODE ?? "local").trim().toLowerCase();
  return raw === "s3" ? "s3" : "local";
}

/**
 * Resolved app version — baked at build time via the `APP_VERSION` env
 * var (set by the Dockerfile ARG). Falls back to `dev` for local runs
 * and Vercel builds that don't inject the var.
 *
 * WHY env var rather than reading package.json: standalone Next.js
 * output does NOT include package.json in the runtime image layer,
 * and even when it does, reading a file at request time is a sharp
 * edge we don't need. A plain env var is bulletproof across targets.
 */
function getAppVersion(): string {
  return process.env.APP_VERSION ?? "dev";
}

// Note: `markShuttingDown` + `isShuttingDown` are re-exported at the
// top of this file from `./shutdown.ts`. They live in that tiny
// standalone module so `instrumentation.ts` can import them without
// pulling the full services module into the Next.js edge bundle
// (which would fail because this file transitively imports
// `node:fs` via the storage factory).

/**
 * Health payload returned by `/api/healthz`.
 *
 * Deliberately includes the full timeout contract — pipelineBudgetMs,
 * clientTimeoutMs, recommendedProxyTimeoutMs — so a reverse proxy
 * smoke test can curl this endpoint and assert its own idle timeout
 * is `>= recommendedProxyTimeoutMs`. A container behind an ALB or
 * Cloud Run ingress with a 60s default idle kills the 135s client
 * timeout before it can fire; this makes the required configuration
 * visible and greppable instead of a README trap.
 */
export interface HealthReport {
  ok: boolean;
  version: string;
  storageMode: "local" | "s3";
  pipelineBudgetMs: number;
  clientTimeoutMs: number;
  /**
   * Minimum idle/request timeout the reverse proxy should be
   * configured for. Set to CLIENT_REQUEST_TIMEOUT_MS + 5s so the
   * client's AbortSignal always wins the race against the proxy kill.
   */
  recommendedProxyTimeoutMs: number;
  shuttingDown: boolean;
}

/**
 * Build the health report payload. Pure function — no side effects.
 * Called per-request by `/api/healthz` (and by tests asserting the
 * contract).
 */
export function getHealth(): HealthReport {
  const draining = isShuttingDown();
  return {
    ok: !draining,
    version: getAppVersion(),
    storageMode: getStorageMode(),
    pipelineBudgetMs: PIPELINE_BUDGET_MS,
    clientTimeoutMs: CLIENT_REQUEST_TIMEOUT_MS,
    recommendedProxyTimeoutMs: CLIENT_REQUEST_TIMEOUT_MS + 5_000,
    shuttingDown: draining,
  };
}
