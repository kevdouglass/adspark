/**
 * Invariants for the staggered timeout constants.
 *
 * The three layers of the request path (pipeline budget, HTTP client
 * timeout, Vercel serverless hard limit) MUST be strictly ordered so
 * the inner layer always fails gracefully before the outer layer kills
 * the request. A previous version of these constants set the pipeline
 * budget equal to the client timeout (both 55s), creating a race where
 * the client's AbortSignal could fire at the same moment the server
 * was preparing its graceful partial-result response.
 *
 * This file pins the stagger invariants so any future edit that would
 * re-introduce the race fails at test time, not in production.
 */

import { describe, it, expect } from "vitest";
import {
  PIPELINE_BUDGET_MS,
  CLIENT_REQUEST_TIMEOUT_MS,
  SERVERLESS_EXECUTION_BUDGET_MS,
} from "@/lib/api/timeouts";

describe("staggered timeout invariants", () => {
  it("PIPELINE_BUDGET_MS is strictly below CLIENT_REQUEST_TIMEOUT_MS", () => {
    // Server must finish its graceful partial-result path BEFORE the
    // client's AbortSignal fires. Anything less than a strict `<` here
    // re-introduces the race condition that prompted this test.
    expect(PIPELINE_BUDGET_MS).toBeLessThan(CLIENT_REQUEST_TIMEOUT_MS);
  });

  it("CLIENT_REQUEST_TIMEOUT_MS is strictly below SERVERLESS_EXECUTION_BUDGET_MS", () => {
    // Client's own timeout must fire before Vercel's hard kill so the
    // user sees a clean error envelope instead of a connection reset.
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBeLessThan(
      SERVERLESS_EXECUTION_BUDGET_MS
    );
  });

  it("the inner stagger is at least 10 seconds and the outer at least 60", () => {
    // Inner stagger (PIPELINE_BUDGET → CLIENT_REQUEST_TIMEOUT): 15 seconds.
    //   With Vercel Pro's 300s ceiling we have plenty of headroom and
    //   restored a generous inner stagger. The server has 15 seconds to
    //   compose, serialize, and send a typed 504 error before the client
    //   gives up — comfortable margin even on slow Vercel cold starts.
    //
    // Outer stagger (CLIENT_REQUEST_TIMEOUT → VERCEL HARD KILL): 165 seconds.
    //   Massively widened from the previous 2-second margin (which was
    //   constrained by the Hobby 60s cap). With Pro's 300s cap and a
    //   135s client timeout, we have 165 seconds of slack — far more
    //   than we need. We could theoretically push CLIENT_REQUEST_TIMEOUT
    //   higher, but that erodes the user-perceived patience budget. 135s
    //   is enough to comfortably handle 12-image briefs at Tier 1.
    //
    // The minimum-stagger thresholds below are intentionally generous to
    // catch any future "let me trim a few seconds off" edit that would
    // tighten the contract beyond what production needs.
    const innerToMiddle = CLIENT_REQUEST_TIMEOUT_MS - PIPELINE_BUDGET_MS;
    const middleToOuter =
      SERVERLESS_EXECUTION_BUDGET_MS - CLIENT_REQUEST_TIMEOUT_MS;

    expect(innerToMiddle).toBeGreaterThanOrEqual(10_000);
    expect(middleToOuter).toBeGreaterThanOrEqual(60_000);
  });

  it("locks in the current canonical values to catch unauthorized edits", () => {
    // Any change to these values should be an explicit, reviewed edit —
    // not a drive-by tweak. Pinning the exact values means a future
    // "I'll just bump this by N seconds" patch fails the test and
    // forces a conversation about the stagger math.
    //
    // History:
    //   - Original Hobby cascade: 50_000 / 55_000 / 60_000
    //   - Bumped client to 58_000 to give 6-image Hobby briefs more headroom
    //   - Upgraded to Vercel Pro: 120_000 / 135_000 / 300_000
    //
    // Each route handler must ALSO declare `export const maxDuration = 300`
    // to actually use Pro's longer duration. Without that export, Vercel
    // still falls back to 60s. See:
    //   - app/api/generate/route.ts
    //   - app/api/orchestrate-brief/route.ts
    //
    // See lib/api/timeouts.ts for the full math and trade-off discussion.
    expect(PIPELINE_BUDGET_MS).toBe(120_000);
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBe(135_000);
    expect(SERVERLESS_EXECUTION_BUDGET_MS).toBe(300_000);
  });
});
