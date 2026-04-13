/**
 * Process-level shutdown flag — isolated from `lib/api/services.ts` so
 * `instrumentation.ts` can import it without pulling in the full
 * services module (which transitively imports `node:fs` via the
 * storage factory and blows up the Next.js edge bundler).
 *
 * Only `instrumentation.ts` (SIGTERM handler) and `lib/api/services.ts`
 * (getHealth consumer) import from this file. Do NOT add logic here —
 * it's intentionally the smallest possible surface area to keep the
 * instrumentation import graph free of node-only modules.
 */

let shuttingDown = false;

/**
 * Flip the graceful-shutdown flag. Called from `instrumentation.ts`
 * on SIGTERM/SIGINT. Idempotent — safe to call multiple times.
 */
export function markShuttingDown(): void {
  shuttingDown = true;
}

/** Read the current shutdown state. Used by `/api/healthz`. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}
