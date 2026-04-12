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
 * Client-side `fetch` timeout via `AbortSignal.timeout()`. 5 seconds
 * below Vercel's limit so the client has a chance to receive a real
 * response body for any error the server chooses to surface before
 * Vercel would kill the function.
 */
export const CLIENT_REQUEST_TIMEOUT_MS = 55_000;

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
