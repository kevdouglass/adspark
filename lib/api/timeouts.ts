/**
 * Shared timeout constants — staggered to prevent race conditions.
 *
 * The three layers of our request path each have their own timeout.
 * They MUST be staggered (inner < middle < outer) so the inner layer
 * always fails gracefully with a real response body BEFORE the outer
 * layer kills the request uncooperatively.
 *
 * Stagger diagram:
 *
 *   0s ─────────────── 50s ──── 55s ──── 60s
 *        [pipeline work]    ↑        ↑        ↑
 *                           │        │        │
 *                 PIPELINE_BUDGET_MS  │        │
 *                                     │        │
 *                        CLIENT_REQUEST_TIMEOUT_MS
 *                                              │
 *                             SERVERLESS_EXECUTION_BUDGET_MS
 *                                    (Vercel hard limit)
 *
 * What fires in what order for a healthy 6-image demo run (~45s total):
 *
 *   1. Nothing fires — request completes at ~45s, well under all budgets.
 *
 * What fires for a slow run where DALL-E is lagging:
 *
 *   1. At 50s, the SERVER's post-generation check trips and returns a
 *      graceful 504 response with `upstream_timeout` error.
 *   2. The CLIENT receives the 504 body and maps it to a user-facing
 *      error without any abort/network failure.
 *   3. The CLIENT's AbortSignal.timeout(55s) never needed to fire.
 *   4. Vercel's 60s guillotine never had a chance to intervene.
 *
 * What happens if we had a race (pre-fix, both at 55s):
 *
 *   1. At 55s, the SERVER tries to return a partial result AND the
 *      CLIENT's AbortSignal.timeout fires at the same moment.
 *   2. Whichever wins is non-deterministic (scheduling jitter).
 *   3. The client may see an AbortError instead of the server's
 *      graceful error envelope → loses the requestId, loses the
 *      structured error code, looks like a network failure to the UI.
 *
 * DO NOT modify these constants without understanding the stagger.
 * A runtime test (`__tests__/pipeline.test.ts`) asserts the
 * inner < middle < outer invariant.
 *
 * See also:
 * - `lib/pipeline/pipeline.ts` consumes `PIPELINE_BUDGET_MS`
 * - `lib/api/client.ts` consumes `CLIENT_REQUEST_TIMEOUT_MS`
 * - Vercel serverless function docs for the 60s hard limit
 */

/**
 * Vercel's hard upper bound for serverless function execution on the
 * Hobby plan. NOT a timeout we control — the platform kills the
 * function at exactly this point with no graceful shutdown.
 */
export const SERVERLESS_EXECUTION_BUDGET_MS = 60_000;

/**
 * Client-side `fetch` timeout via `AbortSignal.timeout()`.
 *
 * **Bumped from 55_000 → 58_000** to give the pipeline 3 additional
 * seconds for 6-image briefs on Tier 1 DALL-E. The previous 5-second
 * stagger from Vercel's 60_000 hard limit was conservative; we're
 * trading 3 seconds of safety margin for a higher chance that 6-image
 * briefs complete before the client aborts.
 *
 * Risk: if the pipeline takes ~58.5-59.5 seconds, the client will
 * receive the response just before Vercel's hard kill. The 2-second
 * remaining margin is tight but defensible for a demo. The server's
 * PIPELINE_BUDGET_MS check (50s) still fires first to surface a
 * graceful timeout error if the pipeline genuinely runs over budget.
 *
 * Cascade after the bump:
 *   PIPELINE_BUDGET_MS         (50s) - server graceful timeout point
 *   CLIENT_REQUEST_TIMEOUT_MS  (58s) - client gives up   <-- bumped
 *   Vercel hard kill           (60s) - platform forced shutdown
 *
 * For 1-3 image briefs (which fit in a single DALL-E wave at Tier 1),
 * this bump is invisible — they complete in 25-30s well under any
 * timeout. The bump only matters at the 6-image edge of the envelope.
 *
 * If you need to push this higher, you must ALSO upgrade to Vercel
 * Pro (300s function duration cap). Until then, 58_000 is the maximum
 * value that leaves any safety margin against Vercel's 60s.
 */
export const CLIENT_REQUEST_TIMEOUT_MS = 58_000;

/**
 * Server-side pipeline budget. 5 seconds below the client timeout
 * so the server can always complete its graceful partial-result
 * response BEFORE the client's AbortSignal fires. This stagger is
 * the reason we didn't set both constants to 55_000.
 *
 * Realistic wall-clock math for a 6-image demo (2 products × 3 ratios)
 * assuming `DALLE_CONCURRENCY_LIMIT = 5` in `lib/pipeline/imageGenerator.ts`:
 *
 *   - Wave 1 (5 images in parallel, DALL-E 3 p75): ~22s
 *   - Wave 2 (1 image alone, p75): ~22s
 *   - Compositing (parallel canvas): ~3s
 *   - Organizing (storage writes + manifest): ~3s
 *   - Subtotal: ~50s
 *
 * With 50s exactly = 50_000 we have NO headroom for the DALL-E p90 tail.
 * This is a known Tier 1 limitation — see the JSDoc on `PIPELINE_BUDGET_MS`
 * in `lib/pipeline/pipeline.ts` for the retry-budget trade-off. For
 * Tier 2+ accounts with faster p90 latency, this budget is comfortable.
 *
 * If you need to push this higher without changing the stagger, you
 * must ALSO raise `CLIENT_REQUEST_TIMEOUT_MS` and negotiate Vercel's
 * 60s cap via the Pro plan (300s limit) or streaming responses.
 */
export const PIPELINE_BUDGET_MS = 50_000;

/**
 * Server-side budget for the multi-agent brief orchestration endpoint
 * (`/api/orchestrate-brief`).
 *
 * Typical wall time is ~10-12s (triage ~2s + draft ~3s + 4 parallel
 * reviewers ~3s + synthesis ~3s). 45s gives ~3-4x headroom at Tier 1
 * p99 while staying comfortably under Vercel's 60s guillotine.
 *
 * The orchestration runs BEFORE the pipeline on a SEPARATE POST call,
 * so it has its own staggered budget independent of `PIPELINE_BUDGET_MS`.
 * Without this guard, a slow OpenAI call could let the function hang
 * until Vercel's 60s hard kill, returning no JSON envelope and no
 * `requestId` — the client would see an opaque AbortError instead
 * of a structured `UPSTREAM_TIMEOUT` 504.
 *
 * Caller wraps `orchestrateBrief()` in `Promise.race` against a
 * `setTimeout` reject so the typed error path always wins.
 */
export const ORCHESTRATE_BUDGET_MS = 45_000;

/**
 * Client-side fetch timeout for `/api/orchestrate-brief`. 5s above the
 * server budget so the server's graceful 504 (`UPSTREAM_TIMEOUT`) always
 * wins the race against the client's `AbortSignal.timeout` — same stagger
 * pattern as `PIPELINE_BUDGET_MS` ↔ `CLIENT_REQUEST_TIMEOUT_MS`.
 */
export const ORCHESTRATE_CLIENT_TIMEOUT_MS = 50_000;
