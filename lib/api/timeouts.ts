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
 * Vercel's hard upper bound for serverless function execution.
 *
 * **Updated from 60_000 → 300_000 for Vercel Pro tier.** The platform
 * kills the function at exactly this point with no graceful shutdown.
 *
 * Tier reference:
 *   - Hobby (Free):  60 seconds
 *   - Pro ($20/mo):  300 seconds (5 minutes)   <-- current setting
 *   - Enterprise:    900 seconds (15 minutes)
 *
 * Note: each route handler must ALSO declare `export const maxDuration = 300`
 * to actually use the longer Pro duration. Without that export, Vercel
 * falls back to the 60s default even on Pro. See:
 *   - app/api/generate/route.ts
 *   - app/api/orchestrate-brief/route.ts
 *
 * Reference: https://vercel.com/docs/functions/runtimes#max-duration
 */
export const SERVERLESS_EXECUTION_BUDGET_MS = 300_000;

/**
 * Client-side `fetch` timeout via `AbortSignal.timeout()`.
 *
 * **Bumped from 58_000 → 135_000 (2:15) for Vercel Pro.** Previously
 * the value was 5 seconds below Vercel's 60s Hobby cap; with Pro's
 * 300s ceiling we have plenty of headroom and can give the client
 * a generous 2 minutes 15 seconds before aborting.
 *
 * Why this specific value: the longest realistic brief (12 images:
 * 4 products × 3 ratios) takes ~100-130 seconds on Tier 1 DALL-E
 * with `DALLE_CONCURRENCY_LIMIT = 3` (4 sequential waves of 3 images
 * each at ~25s per wave + ~10s for compositing/save). Adding 5
 * seconds of safety margin gives 135s.
 *
 * Cascade after the bump:
 *   PIPELINE_BUDGET_MS              (120s)  - server graceful timeout
 *   CLIENT_REQUEST_TIMEOUT_MS       (135s)  - client gives up   <-- bumped
 *   SERVERLESS_EXECUTION_BUDGET_MS  (300s)  - Vercel Pro hard kill
 *
 * Inner stagger (PIPELINE → CLIENT): 15 seconds — generous, lets the
 * server compose and send a typed 504 even on a slow Vercel function.
 * Outer stagger (CLIENT → VERCEL): 165 seconds — huge margin, fine.
 *
 * For 1-3 image briefs (which fit in a single DALL-E wave), this
 * bump is invisible — they complete in 25-30s well under any timeout.
 */
export const CLIENT_REQUEST_TIMEOUT_MS = 135_000;

/**
 * Server-side pipeline budget.
 *
 * **Bumped from 50_000 → 120_000 (2 min) for Vercel Pro.** Previously
 * calibrated to 50s to fit inside Hobby's 60s cap with stagger; with
 * Pro's 300s ceiling, we can give the pipeline 2 full minutes of
 * server-side budget, which comfortably handles 6-9 image briefs at
 * Tier 1 DALL-E + Tier 1 retry windows.
 *
 * Realistic wall-clock math for various brief sizes (Tier 1 DALL-E,
 * `DALLE_CONCURRENCY_LIMIT = 3`, p75 latency ~22s per image):
 *
 *   1 image:          ~22s + ~3s composite  = ~25s   (1 wave)
 *   3 images:         ~22s + ~3s            = ~25s   (1 wave)
 *   6 images:         ~44s + ~5s            = ~49s   (2 waves of 3)
 *   9 images:         ~66s + ~6s            = ~72s   (3 waves of 3)
 *   12 images:        ~88s + ~7s            = ~95s   (4 waves of 3)
 *
 * Add ~10-12s for the optional orchestration phase (multi-agent brief
 * refinement) when the AI Brief Orchestrator is used. Add ~12s per
 * 429 retry hit on a wave (rare with concurrency=3).
 *
 * 120s gives:
 *   - Comfortable margin for 6-image briefs (49 + 12 = 61s used, 59s slack)
 *   - Reliable 9-image briefs (72 + 12 = 84s used, 36s slack)
 *   - Feasible 12-image briefs (95 + 12 = 107s used, 13s slack)
 *
 * Cascade:
 *   PIPELINE_BUDGET_MS              (120s)  - this constant   <-- bumped
 *   CLIENT_REQUEST_TIMEOUT_MS       (135s)  - 15s outer stagger
 *   SERVERLESS_EXECUTION_BUDGET_MS  (300s)  - Vercel Pro cap (165s slack)
 *
 * The 15-second outer stagger to CLIENT_REQUEST_TIMEOUT_MS lets the
 * server compose a typed 504 with a complete error envelope before the
 * client gives up. The 165-second slack to Vercel's hard kill is huge
 * — we're not even close to needing the full 5 minutes.
 *
 * If you ever exceed 120s of pipeline runtime in practice, the right
 * fix is streaming responses (let the client see partial results as
 * they complete), NOT raising this constant further. Bumping past 150s
 * starts eating into UX patience.
 */
export const PIPELINE_BUDGET_MS = 120_000;

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
