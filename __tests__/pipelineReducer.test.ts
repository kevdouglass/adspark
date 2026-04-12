/**
 * Unit tests for pipelineReducer — the pure function at the heart of
 * the dashboard state machine.
 *
 * Per ADR-004, the reducer is deliberately a pure function with no React
 * dependencies. Every state transition can be tested without mounting a
 * provider, using vitest alone — fast, deterministic, easy to debug.
 *
 * What these tests prove:
 * 1. Every valid (state × action) transition does what the state machine
 *    diagram says (5 states × 5 actions — 25 cells)
 * 2. Stale events (wrong submissionId) are dropped with reference equality
 *    preserved — React skips re-rendering on reference-equal return values
 * 3. The resubmit-race described in the module JSDoc is actually prevented:
 *    stale SUCCEEDED from a completed session cannot clobber a newer one
 * 4. RESET works from ANY state (including mid-flight cancel)
 * 5. TypeScript narrowing: each terminal state carries the fields it should
 */

import { describe, it, expect } from "vitest";
import {
  pipelineReducer,
  INITIAL_STATE,
  type PipelineSessionState,
  type PipelineAction,
} from "@/lib/hooks/usePipelineState";
import type { GenerateRequestBody } from "@/lib/api/types";
import {
  VALID_BRIEF,
  ANOTHER_BRIEF,
  SUCCESS_RESULT,
  STALE_SUCCESS_RESULT,
  API_ERROR,
} from "./fixtures/pipelineFixtures";

// ---------------------------------------------------------------------------
// State factories — seed a state with a known brief + submissionId so
// transition tests have something concrete to carry forward. Using
// factories keeps per-test setup readable.
// ---------------------------------------------------------------------------

function submittingState(
  brief: GenerateRequestBody = VALID_BRIEF,
  submissionId = 1
): PipelineSessionState {
  return { status: "submitting", submissionId, brief };
}

function generatingState(
  brief: GenerateRequestBody = VALID_BRIEF,
  submissionId = 1
): PipelineSessionState {
  return {
    status: "generating",
    submissionId,
    brief,
    stage: "generating",
  };
}

function completeState(
  brief: GenerateRequestBody = VALID_BRIEF,
  submissionId = 1
): PipelineSessionState {
  return {
    status: "complete",
    submissionId,
    brief,
    result: SUCCESS_RESULT,
  };
}

function errorState(
  brief: GenerateRequestBody = VALID_BRIEF,
  submissionId = 1
): PipelineSessionState {
  return {
    status: "error",
    submissionId,
    brief,
    error: API_ERROR,
  };
}

// ---------------------------------------------------------------------------
// Group 1: SUBMIT transitions from every source state
// ---------------------------------------------------------------------------

describe("pipelineReducer — SUBMIT", () => {
  it("transitions idle → submitting carrying the brief and submissionId", () => {
    const next = pipelineReducer(INITIAL_STATE, {
      type: "SUBMIT",
      submissionId: 1,
      brief: VALID_BRIEF,
    });
    expect(next).toEqual({
      status: "submitting",
      submissionId: 1,
      brief: VALID_BRIEF,
    });
  });

  it("allows SUBMIT from submitting (covers the 'SUBMIT is valid from any state' claim)", () => {
    // Documents that the reducer itself does not guard double-submit.
    // The provider's inFlightRef handles rapid-click prevention.
    const next = pipelineReducer(submittingState(VALID_BRIEF, 1), {
      type: "SUBMIT",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({
      status: "submitting",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
  });

  it("allows SUBMIT from generating", () => {
    const next = pipelineReducer(generatingState(VALID_BRIEF, 1), {
      type: "SUBMIT",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({
      status: "submitting",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
  });

  it("allows SUBMIT from complete (resubmit after success)", () => {
    const next = pipelineReducer(completeState(VALID_BRIEF, 1), {
      type: "SUBMIT",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({
      status: "submitting",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
  });

  it("allows SUBMIT from complete with the SAME brief reference (guards against identity-comparison bugs)", () => {
    // If someone ever adds `if (action.brief === state.brief) return state`
    // to optimize "identical resubmit," this test catches it. The user may
    // legitimately want to re-run the same brief.
    const next = pipelineReducer(completeState(VALID_BRIEF, 1), {
      type: "SUBMIT",
      submissionId: 2,
      brief: VALID_BRIEF,
    });
    expect(next.status).toBe("submitting");
    if (next.status === "submitting") {
      expect(next.brief).toBe(VALID_BRIEF);
      expect(next.submissionId).toBe(2);
    }
  });

  it("allows SUBMIT from error (retry after failure)", () => {
    const next = pipelineReducer(errorState(VALID_BRIEF, 1), {
      type: "SUBMIT",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
    expect(next).toEqual({
      status: "submitting",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    });
  });
});

// ---------------------------------------------------------------------------
// Group 2: STAGE_CHANGED transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — STAGE_CHANGED", () => {
  it("transitions submitting → generating carrying stage, brief, and submissionId", () => {
    const next = pipelineReducer(submittingState(VALID_BRIEF, 5), {
      type: "STAGE_CHANGED",
      submissionId: 5,
      stage: "generating",
    });
    expect(next).toEqual({
      status: "generating",
      submissionId: 5,
      brief: VALID_BRIEF,
      stage: "generating",
    });
  });

  it("updates stage within generating (generating → compositing)", () => {
    const next = pipelineReducer(generatingState(VALID_BRIEF, 5), {
      type: "STAGE_CHANGED",
      submissionId: 5,
      stage: "compositing",
    });
    expect(next).toEqual({
      status: "generating",
      submissionId: 5,
      brief: VALID_BRIEF,
      stage: "compositing",
    });
  });

  it("preserves the brief reference across STAGE_CHANGED transitions", () => {
    // Prove the brief isn't silently swapped or re-constructed — the
    // same reference that went in comes out, which matters for React
    // memoization downstream.
    const next = pipelineReducer(submittingState(ANOTHER_BRIEF, 3), {
      type: "STAGE_CHANGED",
      submissionId: 3,
      stage: "generating",
    });
    if (next.status !== "generating") {
      throw new Error(`Expected generating, got ${next.status}`);
    }
    expect(next.brief).toBe(ANOTHER_BRIEF);
  });

  it("handles rapid successive STAGE_CHANGED events (idempotent chaining)", () => {
    // Stages can arrive in a burst from a streaming backend. Verify each
    // chained dispatch produces the right terminal stage.
    const stages = ["validating", "resolving", "generating", "compositing", "organizing"] as const;
    let state: PipelineSessionState = submittingState(VALID_BRIEF, 7);
    for (const stage of stages) {
      state = pipelineReducer(state, {
        type: "STAGE_CHANGED",
        submissionId: 7,
        stage,
      });
    }
    if (state.status !== "generating") {
      throw new Error(`Expected generating, got ${state.status}`);
    }
    expect(state.stage).toBe("organizing");
    expect(state.submissionId).toBe(7);
    expect(state.brief).toBe(VALID_BRIEF);
  });

  it("drops stale STAGE_CHANGED with wrong submissionId (returns same reference)", () => {
    // Race: user cancels session 1 and starts session 2. A stage event
    // from session 1 arrives late — reducer must drop it to prevent
    // stage-label flicker on the new session.
    const before = generatingState(ANOTHER_BRIEF, 2);
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      submissionId: 1, // stale id
      stage: "compositing",
    });
    expect(after).toBe(before);
  });

  it("returns same reference when STAGE_CHANGED arrives in idle (no active session)", () => {
    const after = pipelineReducer(INITIAL_STATE, {
      type: "STAGE_CHANGED",
      submissionId: 1,
      stage: "generating",
    });
    expect(after).toBe(INITIAL_STATE);
  });

  it("returns same reference when STAGE_CHANGED arrives in complete (terminal)", () => {
    const before = completeState();
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      submissionId: before.status === "complete" ? before.submissionId : 1,
      stage: "compositing",
    });
    expect(after).toBe(before);
  });

  it("returns same reference when STAGE_CHANGED arrives in error (terminal)", () => {
    const before = errorState();
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      submissionId: before.status === "error" ? before.submissionId : 1,
      stage: "compositing",
    });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Group 3: SUCCEEDED transitions — including the resubmit-race protection
// ---------------------------------------------------------------------------

describe("pipelineReducer — SUCCEEDED", () => {
  it("transitions submitting → complete carrying brief, result, and submissionId", () => {
    const next = pipelineReducer(submittingState(VALID_BRIEF, 3), {
      type: "SUCCEEDED",
      submissionId: 3,
      result: SUCCESS_RESULT,
    });
    expect(next).toEqual({
      status: "complete",
      submissionId: 3,
      brief: VALID_BRIEF,
      result: SUCCESS_RESULT,
    });
  });

  it("transitions generating → complete carrying brief, result, and submissionId", () => {
    const next = pipelineReducer(generatingState(VALID_BRIEF, 3), {
      type: "SUCCEEDED",
      submissionId: 3,
      result: SUCCESS_RESULT,
    });
    expect(next).toEqual({
      status: "complete",
      submissionId: 3,
      brief: VALID_BRIEF,
      result: SUCCESS_RESULT,
    });
  });

  it("preserves the original brief reference across success", () => {
    const before = submittingState(ANOTHER_BRIEF, 3);
    const after = pipelineReducer(before, {
      type: "SUCCEEDED",
      submissionId: 3,
      result: SUCCESS_RESULT,
    });
    if (after.status !== "complete") {
      throw new Error("Expected complete status");
    }
    expect(after.brief).toBe(ANOTHER_BRIEF);
  });

  it("drops stale SUCCEEDED events from idle state (returns same reference)", () => {
    // Scenario: user submits → awaits → calls reset() → original request
    // resolves late → SUCCEEDED dispatched. The reducer must drop this
    // event so it doesn't overwrite the user's intentional reset.
    const after = pipelineReducer(INITIAL_STATE, {
      type: "SUCCEEDED",
      submissionId: 1,
      result: SUCCESS_RESULT,
    });
    expect(after).toBe(INITIAL_STATE);
  });

  // ---------- THE RESUBMIT RACE — the central correctness claim ----------

  it("drops stale SUCCEEDED when state.submissionId has advanced (complete → complete resubmit-race protection)", () => {
    // THE RACE:
    //   t1: user submits brief A (id=1)
    //   t2: brief A completes (state = complete{id:1, brief:A, result:SUCCESS})
    //   t3: user submits brief B (state = submitting{id:2, brief:B})
    //   t4: brief B's fetch is fast, completes:
    //       state = complete{id:2, brief:B, result:STALE} ← pretend B resolves to STALE
    //       (not ACTUAL stale — just distinct so we can tell them apart in assertions)
    //   t5: brief A's fetch FINALLY resolves — dispatches SUCCEEDED{id:1, result:SUCCESS}
    //   EXPECTED: reducer drops A's late event; state stays with B's result
    //
    // If the reducer accepted A's late event, state would become
    // complete{id:2, brief:B, result:SUCCESS} — brief and result from
    // DIFFERENT submissions. That's the corruption bug.
    const stateAfterBCompletes: PipelineSessionState = {
      status: "complete",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
      result: STALE_SUCCESS_RESULT,
    };

    const after = pipelineReducer(stateAfterBCompletes, {
      type: "SUCCEEDED",
      submissionId: 1, // stale id from brief A
      result: SUCCESS_RESULT,
    });

    // Reference equality means React will skip re-rendering — critical
    // because it also means we prove the state didn't mutate.
    expect(after).toBe(stateAfterBCompletes);
  });

  it("drops stale SUCCEEDED when state is error{id:2} (error-state clobber protection)", () => {
    const stateInError: PipelineSessionState = {
      status: "error",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
      error: API_ERROR,
    };
    const after = pipelineReducer(stateInError, {
      type: "SUCCEEDED",
      submissionId: 1, // stale
      result: SUCCESS_RESULT,
    });
    expect(after).toBe(stateInError);
  });

  it("drops stale SUCCEEDED when state is submitting{id:2} (submitting-state clobber protection)", () => {
    const stateSubmittingNew: PipelineSessionState = {
      status: "submitting",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
    };
    const after = pipelineReducer(stateSubmittingNew, {
      type: "SUCCEEDED",
      submissionId: 1, // stale
      result: SUCCESS_RESULT,
    });
    expect(after).toBe(stateSubmittingNew);
  });
});

// ---------------------------------------------------------------------------
// Group 4: FAILED transitions — including stale-event protection
// ---------------------------------------------------------------------------

describe("pipelineReducer — FAILED", () => {
  it("transitions submitting → error carrying brief, error, and submissionId", () => {
    const next = pipelineReducer(submittingState(VALID_BRIEF, 4), {
      type: "FAILED",
      submissionId: 4,
      error: API_ERROR,
    });
    expect(next).toEqual({
      status: "error",
      submissionId: 4,
      brief: VALID_BRIEF,
      error: API_ERROR,
    });
  });

  it("transitions generating → error carrying brief, error, and submissionId", () => {
    const next = pipelineReducer(generatingState(VALID_BRIEF, 4), {
      type: "FAILED",
      submissionId: 4,
      error: API_ERROR,
    });
    expect(next).toEqual({
      status: "error",
      submissionId: 4,
      brief: VALID_BRIEF,
      error: API_ERROR,
    });
  });

  it("drops stale FAILED events from idle (returns same reference)", () => {
    const after = pipelineReducer(INITIAL_STATE, {
      type: "FAILED",
      submissionId: 1,
      error: API_ERROR,
    });
    expect(after).toBe(INITIAL_STATE);
  });

  it("drops stale FAILED when state.submissionId has advanced", () => {
    // Mirror of the SUCCEEDED race: a late FAILED from an earlier
    // submission must not overwrite a newer completed state.
    const stateAfterB: PipelineSessionState = {
      status: "complete",
      submissionId: 2,
      brief: ANOTHER_BRIEF,
      result: STALE_SUCCESS_RESULT,
    };
    const after = pipelineReducer(stateAfterB, {
      type: "FAILED",
      submissionId: 1, // stale
      error: API_ERROR,
    });
    expect(after).toBe(stateAfterB);
  });
});

// ---------------------------------------------------------------------------
// Group 5: RESET transitions
// ---------------------------------------------------------------------------

describe("pipelineReducer — RESET", () => {
  it("transitions complete → INITIAL_STATE (reference-equal)", () => {
    // Reference equality against the module-level INITIAL_STATE constant
    // is load-bearing: a future "spread fresh object" refactor would
    // silently trigger re-renders on every reset.
    const next = pipelineReducer(completeState(), { type: "RESET" });
    expect(next).toBe(INITIAL_STATE);
  });

  it("transitions error → INITIAL_STATE", () => {
    const next = pipelineReducer(errorState(), { type: "RESET" });
    expect(next).toBe(INITIAL_STATE);
  });

  it("transitions submitting → INITIAL_STATE (user cancels mid-flight)", () => {
    const next = pipelineReducer(submittingState(), { type: "RESET" });
    expect(next).toBe(INITIAL_STATE);
  });

  it("transitions generating → INITIAL_STATE (user cancels mid-generation)", () => {
    const next = pipelineReducer(generatingState(), { type: "RESET" });
    expect(next).toBe(INITIAL_STATE);
  });

  it("RESET from idle is still reference-equal to INITIAL_STATE", () => {
    const next = pipelineReducer(INITIAL_STATE, { type: "RESET" });
    expect(next).toBe(INITIAL_STATE);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Exhaustiveness + type narrowing
// ---------------------------------------------------------------------------

describe("pipelineReducer — exhaustiveness", () => {
  it("throws on an unknown action type (defensive runtime guard)", () => {
    // TypeScript's exhaustive switch makes this unreachable at compile
    // time, but we cast to prove the runtime guard fires if an unknown
    // action somehow arrives (e.g., from an older client bundle
    // dispatching a removed action type).
    const bogusAction = { type: "NUCLEAR_OPTION" } as unknown as PipelineAction;
    expect(() =>
      pipelineReducer(INITIAL_STATE, bogusAction)
    ).toThrow(/Unhandled pipeline action/);
  });

  it("TypeScript narrows complete state to include result and brief", () => {
    // The surrounding assertions that COMPILE are the real test — if
    // the discriminated union is ever widened, these lines stop
    // type-checking. We don't need @ts-expect-error theater; narrowing
    // is proven by what compiles, not by what throws.
    const state = pipelineReducer(submittingState(VALID_BRIEF, 1), {
      type: "SUCCEEDED",
      submissionId: 1,
      result: SUCCESS_RESULT,
    });
    if (state.status === "complete") {
      expect(state.result).toBe(SUCCESS_RESULT);
      expect(state.brief).toBe(VALID_BRIEF);
      expect(state.submissionId).toBe(1);
    } else {
      throw new Error(`Expected complete, got ${state.status}`);
    }
  });

  it("TypeScript narrows error state to include error and brief", () => {
    const state = pipelineReducer(submittingState(VALID_BRIEF, 1), {
      type: "FAILED",
      submissionId: 1,
      error: API_ERROR,
    });
    if (state.status === "error") {
      expect(state.error).toBe(API_ERROR);
      expect(state.brief).toBe(VALID_BRIEF);
      expect(state.submissionId).toBe(1);
    } else {
      throw new Error(`Expected error, got ${state.status}`);
    }
  });
});
