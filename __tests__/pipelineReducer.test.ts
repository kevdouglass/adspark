/**
 * Unit tests for pipelineReducer — the pure function at the heart of
 * the dashboard state machine.
 *
 * Per ADR-004, the reducer is deliberately a pure function with no React
 * dependencies. That means every state transition can be tested without
 * mounting a provider, using vitest alone — fast, deterministic, easy
 * to debug.
 *
 * What these tests prove:
 * 1. Every valid transition does what the state machine diagram says
 * 2. Invalid-in-context events are silently dropped (same reference
 *    returned, so React skips re-rendering — important for perf)
 * 3. Stale events from an earlier session don't clobber a later state
 * 4. RESET works from any state
 * 5. TypeScript narrowing: each terminal state carries the fields it
 *    should (e.g., `complete` carries `result`, not `error`)
 */

import { describe, it, expect } from "vitest";
import {
  pipelineReducer,
  type PipelineSessionState,
  type PipelineAction,
} from "@/lib/hooks/usePipelineState";
import type {
  GenerateRequestBody,
  GenerateSuccessResponseBody,
} from "@/lib/api/types";
import type { ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Test fixtures — minimal-but-realistic values for brief, result, error
// ---------------------------------------------------------------------------

const VALID_BRIEF: GenerateRequestBody = {
  campaign: {
    id: "summer-2026-suncare",
    name: "Summer Suncare 2026",
    message: "Stay Protected All Summer",
    targetRegion: "North America",
    targetAudience: "Outdoor enthusiasts 25-45",
    tone: "vibrant, trustworthy",
    season: "summer",
  },
  products: [
    {
      name: "SPF 50 Sunscreen",
      slug: "spf-50-sunscreen",
      description: "Reef-safe mineral sunscreen",
      category: "sun protection",
      keyFeatures: ["reef-safe", "mineral"],
      color: "#F4A261",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

const ANOTHER_BRIEF: GenerateRequestBody = {
  ...VALID_BRIEF,
  campaign: { ...VALID_BRIEF.campaign, id: "winter-2026-suncare" },
};

const SUCCESS_RESULT: GenerateSuccessResponseBody = {
  campaignId: "summer-2026-suncare",
  creatives: [
    {
      productName: "SPF 50 Sunscreen",
      productSlug: "spf-50-sunscreen",
      aspectRatio: "1:1",
      dimensions: "1080x1080",
      creativePath:
        "summer-2026-suncare/spf-50-sunscreen/1x1/creative.png",
      thumbnailPath:
        "summer-2026-suncare/spf-50-sunscreen/1x1/thumbnail.webp",
      prompt: "A premium sun protection product...",
      generationTimeMs: 15_000,
      compositingTimeMs: 500,
    },
  ],
  totalTimeMs: 18_000,
  totalImages: 1,
  errors: [],
  requestId: "abc-123",
};

const API_ERROR: ApiError = {
  code: "UPSTREAM_ERROR",
  message: "DALL-E returned 500",
  requestId: "abc-123",
};

// Convenience factory: seed a state with a known brief so transitions from
// non-idle states have something to carry forward. Using a factory keeps
// the per-test setup readable.
function generatingState(
  brief: GenerateRequestBody = VALID_BRIEF
): PipelineSessionState {
  return { status: "generating", brief, stage: "generating" };
}

function submittingState(
  brief: GenerateRequestBody = VALID_BRIEF
): PipelineSessionState {
  return { status: "submitting", brief };
}

function completeState(
  brief: GenerateRequestBody = VALID_BRIEF
): PipelineSessionState {
  return { status: "complete", brief, result: SUCCESS_RESULT };
}

function errorState(
  brief: GenerateRequestBody = VALID_BRIEF
): PipelineSessionState {
  return { status: "error", brief, error: API_ERROR };
}

// ---------------------------------------------------------------------------
// Group 1: SUBMIT transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — SUBMIT", () => {
  it("transitions idle → submitting carrying the brief", () => {
    const next = pipelineReducer(
      { status: "idle" },
      { type: "SUBMIT", brief: VALID_BRIEF }
    );
    expect(next).toEqual({ status: "submitting", brief: VALID_BRIEF });
  });

  it("allows SUBMIT from complete (resubmit after success)", () => {
    const next = pipelineReducer(completeState(), {
      type: "SUBMIT",
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({ status: "submitting", brief: ANOTHER_BRIEF });
  });

  it("allows SUBMIT from error (retry after failure)", () => {
    const next = pipelineReducer(errorState(), {
      type: "SUBMIT",
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({ status: "submitting", brief: ANOTHER_BRIEF });
  });
});

// ---------------------------------------------------------------------------
// Group 2: STAGE_CHANGED transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — STAGE_CHANGED", () => {
  it("transitions submitting → generating carrying stage and brief", () => {
    const next = pipelineReducer(submittingState(), {
      type: "STAGE_CHANGED",
      stage: "generating",
    });
    expect(next).toEqual({
      status: "generating",
      brief: VALID_BRIEF,
      stage: "generating",
    });
  });

  it("updates stage within generating (generating → compositing)", () => {
    const next = pipelineReducer(generatingState(), {
      type: "STAGE_CHANGED",
      stage: "compositing",
    });
    expect(next).toEqual({
      status: "generating",
      brief: VALID_BRIEF,
      stage: "compositing",
    });
  });

  it("returns same reference when STAGE_CHANGED arrives in idle (no-op)", () => {
    const before: PipelineSessionState = { status: "idle" };
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      stage: "generating",
    });
    // Reference equality matters here — React uses it to skip re-render
    expect(after).toBe(before);
  });

  it("returns same reference when STAGE_CHANGED arrives in complete (stale)", () => {
    const before = completeState();
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      stage: "compositing",
    });
    expect(after).toBe(before);
  });

  it("returns same reference when STAGE_CHANGED arrives in error (stale)", () => {
    const before = errorState();
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      stage: "compositing",
    });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Group 3: SUCCEEDED transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — SUCCEEDED", () => {
  it("transitions submitting → complete carrying brief and result", () => {
    const next = pipelineReducer(submittingState(), {
      type: "SUCCEEDED",
      result: SUCCESS_RESULT,
    });
    expect(next).toEqual({
      status: "complete",
      brief: VALID_BRIEF,
      result: SUCCESS_RESULT,
    });
  });

  it("transitions generating → complete carrying brief and result", () => {
    const next = pipelineReducer(generatingState(), {
      type: "SUCCEEDED",
      result: SUCCESS_RESULT,
    });
    expect(next).toEqual({
      status: "complete",
      brief: VALID_BRIEF,
      result: SUCCESS_RESULT,
    });
  });

  it("preserves the original brief across success", () => {
    const before = submittingState(ANOTHER_BRIEF);
    const after = pipelineReducer(before, {
      type: "SUCCEEDED",
      result: SUCCESS_RESULT,
    });
    // The brief in `complete` must be the SAME brief that was submitted,
    // not the one that might have been queued behind (if any). No queueing
    // today, but the invariant is worth locking in.
    if (after.status !== "complete") {
      throw new Error("Expected complete status");
    }
    expect(after.brief).toBe(ANOTHER_BRIEF);
  });

  it("drops stale SUCCEEDED events from idle state (returns same ref)", () => {
    // Scenario: user submits → awaits → calls reset() → original request
    // resolves late → SUCCEEDED dispatched. The reducer must drop this
    // event so it doesn't overwrite the user's intentional reset.
    const before: PipelineSessionState = { status: "idle" };
    const after = pipelineReducer(before, {
      type: "SUCCEEDED",
      result: SUCCESS_RESULT,
    });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Group 4: FAILED transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — FAILED", () => {
  it("transitions submitting → error carrying brief and error", () => {
    const next = pipelineReducer(submittingState(), {
      type: "FAILED",
      error: API_ERROR,
    });
    expect(next).toEqual({
      status: "error",
      brief: VALID_BRIEF,
      error: API_ERROR,
    });
  });

  it("transitions generating → error carrying brief and error", () => {
    const next = pipelineReducer(generatingState(), {
      type: "FAILED",
      error: API_ERROR,
    });
    expect(next).toEqual({
      status: "error",
      brief: VALID_BRIEF,
      error: API_ERROR,
    });
  });

  it("drops stale FAILED events from idle state (returns same ref)", () => {
    // Mirror of the stale-SUCCEEDED test: a late FAILED after a reset
    // must not overwrite idle with a ghost error.
    const before: PipelineSessionState = { status: "idle" };
    const after = pipelineReducer(before, {
      type: "FAILED",
      error: API_ERROR,
    });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Group 5: RESET transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — RESET", () => {
  it("transitions complete → idle", () => {
    const next = pipelineReducer(completeState(), { type: "RESET" });
    expect(next).toEqual({ status: "idle" });
  });

  it("transitions error → idle", () => {
    const next = pipelineReducer(errorState(), { type: "RESET" });
    expect(next).toEqual({ status: "idle" });
  });

  it("transitions submitting → idle (user cancels mid-flight)", () => {
    // Resetting from an in-flight state is a legitimate user action
    // (e.g., navigating away or clicking a cancel button). The reducer
    // doesn't know or care about in-flight promises — any late SUCCEEDED
    // or FAILED will be dropped by the stale-event guards.
    const next = pipelineReducer(submittingState(), { type: "RESET" });
    expect(next).toEqual({ status: "idle" });
  });

  it("transitions generating → idle (user cancels mid-generation)", () => {
    const next = pipelineReducer(generatingState(), { type: "RESET" });
    expect(next).toEqual({ status: "idle" });
  });

  it("is a no-op on already-idle state (still transitions to a fresh idle)", () => {
    // RESET from idle returns INITIAL_STATE which may be a new reference,
    // but the status is still idle. We don't promise reference equality
    // here because the common case is "reset to clear whatever was there"
    // and returning a fresh object is simpler than special-casing idle.
    const next = pipelineReducer({ status: "idle" }, { type: "RESET" });
    expect(next).toEqual({ status: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Group 6: Exhaustiveness + type narrowing
// ---------------------------------------------------------------------------

describe("pipelineReducer — exhaustiveness", () => {
  it("throws on an unknown action type (defensive, should be unreachable)", () => {
    // TypeScript's exhaustive switch makes this unreachable at compile
    // time, but we use a cast to prove the runtime guard fires if an
    // unknown action somehow arrives (e.g., from an older client bundle
    // dispatching a removed action type).
    const bogusAction = { type: "NUCLEAR_OPTION" } as unknown as PipelineAction;
    expect(() =>
      pipelineReducer({ status: "idle" }, bogusAction)
    ).toThrow(/Unhandled pipeline action/);
  });

  it("TypeScript narrows complete state to include result", () => {
    const state = pipelineReducer(submittingState(), {
      type: "SUCCEEDED",
      result: SUCCESS_RESULT,
    });
    // This test exists to LOCK IN the type narrowing — if someone
    // accidentally widens PipelineSessionState, this code won't compile.
    if (state.status === "complete") {
      expect(state.result).toBe(SUCCESS_RESULT);
      expect(state.brief).toBe(VALID_BRIEF);
      // @ts-expect-error — 'error' does not exist on complete state
      expect(state.error).toBeUndefined();
    } else {
      throw new Error(`Expected complete, got ${state.status}`);
    }
  });

  it("TypeScript narrows error state to include error", () => {
    const state = pipelineReducer(submittingState(), {
      type: "FAILED",
      error: API_ERROR,
    });
    if (state.status === "error") {
      expect(state.error).toBe(API_ERROR);
      expect(state.brief).toBe(VALID_BRIEF);
      // @ts-expect-error — 'result' does not exist on error state
      expect(state.result).toBeUndefined();
    } else {
      throw new Error(`Expected error, got ${state.status}`);
    }
  });
});
