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

  it("the stagger between layers is at least 5 seconds", () => {
    // A 5-second buffer between layers gives the inner layer enough
    // time to complete a graceful response on scheduling jitter. A
    // smaller buffer (e.g., 1s) would tempt a future dev to "optimize"
    // the budgets without understanding the stagger, introducing the
    // race condition this stagger is designed to prevent.
    const innerToMiddle = CLIENT_REQUEST_TIMEOUT_MS - PIPELINE_BUDGET_MS;
    const middleToOuter =
      SERVERLESS_EXECUTION_BUDGET_MS - CLIENT_REQUEST_TIMEOUT_MS;

    expect(innerToMiddle).toBeGreaterThanOrEqual(5_000);
    expect(middleToOuter).toBeGreaterThanOrEqual(5_000);
  });

  it("locks in the current canonical values to catch unauthorized edits", () => {
    // Any change to these values should be an explicit, reviewed edit —
    // not a drive-by tweak. Pinning the exact values means a future
    // "I'll just bump this by 2 seconds" patch fails the test and
    // forces a conversation about the stagger math.
    expect(PIPELINE_BUDGET_MS).toBe(50_000);
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBe(55_000);
    expect(SERVERLESS_EXECUTION_BUDGET_MS).toBe(60_000);
  });
});
