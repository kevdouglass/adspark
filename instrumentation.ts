/**
 * Next.js instrumentation hook — runs ONCE per process on startup.
 *
 * This file exists specifically to wire signal handlers for graceful
 * container shutdown. Without it, a Docker `stop` sends SIGTERM →
 * Next.js closes the HTTP listener → SIGKILL fires at the end of the
 * stop_grace_period → any in-flight 120s DALL-E call gets cut mid-
 * request, leaving a partially-written manifest, leaked OpenAI SDK
 * sockets, and a client that sees a TCP RST instead of a typed error.
 *
 * What this hook does:
 *
 *   1. Listens for SIGTERM/SIGINT.
 *   2. On signal, flips a module-level `shuttingDown` flag inside
 *      `lib/api/services.ts` via the exported `markShuttingDown()`.
 *   3. `/api/healthz` consults that flag on every request and returns
 *      503 instead of 200 while draining.
 *   4. The load balancer's health check observes the 503 and stops
 *      routing new traffic to this instance.
 *   5. In-flight requests continue running because we do NOT close the
 *      HTTP listener — we let Next.js's own shutdown sequence handle
 *      that after the platform's stop_grace_period timer fires. The
 *      AbortController wired into the pipeline (see app/api/generate/
 *      route.ts) still caps each request at PIPELINE_BUDGET_MS (120s),
 *      so the drain never takes longer than that.
 *
 * What this hook does NOT do:
 *
 *   - It does NOT forcibly cancel in-flight requests on receiving
 *     SIGTERM. That would defeat the purpose of graceful shutdown —
 *     the whole point is to let in-flight work finish.
 *   - It does NOT close the HTTP listener. Next.js handles that after
 *     its own drain window; we just flip the healthz flag earlier so
 *     the LB drains first.
 *
 * WHY this lives in instrumentation.ts and not elsewhere:
 *
 *   Next.js 15's `instrumentation.ts` is the supported place to run
 *   code exactly once at server startup. A module-level side effect
 *   in a route handler would run per-cold-start in Vercel and
 *   per-restart in a container; this hook runs once, cleanly.
 *
 *   In Vercel, this code runs too but is a harmless no-op: Vercel
 *   manages lifecycle itself and does not send SIGTERM the way a
 *   container platform does. The handler is registered but never
 *   fires in production.
 *
 *   Reference: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register(): Promise<void> {
  // Only register signal handlers in the Node.js runtime (not Edge).
  // Next.js calls `register()` in both environments, but `process.on`
  // is only available in Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Import from the isolated `@/lib/api/shutdown` module — not from
  // `@/lib/api/services` — so webpack's edge-runtime pass does not
  // trace through to `lib/storage/localStorage.ts` and fail on
  // `node:fs`. The shutdown flag module is intentionally the smallest
  // possible surface area (two functions + one module-level flag) so
  // nothing node-only can sneak into the edge import graph.
  const { markShuttingDown } = await import("@/lib/api/shutdown");

  let signalled = false;
  const handleSignal = (signal: NodeJS.Signals) => {
    if (signalled) return; // idempotent — second SIGTERM just no-ops
    signalled = true;

    // Structured log one line so the shutdown event is greppable in
    // docker logs alongside every other event in the system. We
    // don't route this through RequestLogger because it's not a
    // per-request event — it's a process-level event — so we hand-
    // serialize it in the same shape.
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "shutdown.signal",
        signal,
      })
    );

    markShuttingDown();
  };

  process.on("SIGTERM", handleSignal);
  process.on("SIGINT", handleSignal);
}
