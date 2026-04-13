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

  it("the inner stagger is at least 5 seconds and the outer at least 2", () => {
    // Inner stagger (PIPELINE_BUDGET → CLIENT_REQUEST_TIMEOUT): 8 seconds.
    //   The server's graceful timeout fires at 50s; the client's abort
    //   fires at 58s. The 8-second window guarantees the server can
    //   compose, serialize, and send a typed 504 error before the client
    //   gives up.
    //
    // Outer stagger (CLIENT_REQUEST_TIMEOUT → VERCEL HARD KILL): 2 seconds.
    //   Tightened from the original 5s to give 6-image briefs a fighting
    //   chance to complete on Tier 1 DALL-E + Vercel Hobby. The client
    //   waits until 58s (vs 55s previously); Vercel still hard-kills at
    //   60s. The 2-second margin is intentionally narrow but defensible:
    //   the client only needs enough time to receive the response headers,
    //   and the server has already serialized the JSON body by the time
    //   it sends. Network latency from a Vercel function back to the
    //   client is typically <500ms.
    //
    // If you tighten these further you WILL re-introduce the race
    // condition. Bumping CLIENT_REQUEST_TIMEOUT to 59000 would leave only
    // 1s of margin to Vercel's kill, which is too narrow for production.
    // The proper way to push past 58s is to upgrade Vercel Pro (300s
    // function duration) or to implement streaming responses (which
    // sidestep the cap entirely).
    const innerToMiddle = CLIENT_REQUEST_TIMEOUT_MS - PIPELINE_BUDGET_MS;
    const middleToOuter =
      SERVERLESS_EXECUTION_BUDGET_MS - CLIENT_REQUEST_TIMEOUT_MS;

    expect(innerToMiddle).toBeGreaterThanOrEqual(5_000);
    expect(middleToOuter).toBeGreaterThanOrEqual(2_000);
  });

  it("locks in the current canonical values to catch unauthorized edits", () => {
    // Any change to these values should be an explicit, reviewed edit —
    // not a drive-by tweak. Pinning the exact values means a future
    // "I'll just bump this by 2 seconds" patch fails the test and
    // forces a conversation about the stagger math.
    //
    // CLIENT_REQUEST_TIMEOUT_MS was bumped from 55_000 to 58_000 to give
    // 6-image briefs more headroom on Tier 1 DALL-E. See
    // lib/api/timeouts.ts for the full rationale and trade-off discussion.
    expect(PIPELINE_BUDGET_MS).toBe(50_000);
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBe(58_000);
    expect(SERVERLESS_EXECUTION_BUDGET_MS).toBe(60_000);
  });
});
