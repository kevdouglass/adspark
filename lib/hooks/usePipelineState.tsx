/**
 * usePipelineState — Dashboard state coordination hook.
 *
 * Implements the state machine defined in ADR-004 (useReducer + Context)
 * as a discriminated union. Every component that touches the generation
 * session (BriefForm, PipelineProgress, CreativeGallery, D3Charts) consumes
 * this hook instead of prop-drilling or reaching into a global store.
 *
 * THE STATE MACHINE:
 *
 *   idle ──submit──▶ submitting ──stage──▶ generating ──┬──▶ complete
 *                                                        └──▶ error
 *   (any) ──reset──▶ idle
 *
 * WHY submissionId on every non-idle state:
 *
 * React's `useReducer` dispatches are synchronous, but the generator
 * function is async. Without a per-submission id, this race is possible:
 *
 *   1. user submits brief A      → state = submitting, fetch A starts
 *   2. user clicks reset()       → state = idle
 *   3. user submits brief B      → state = submitting, fetch B starts
 *   4. fetch B resolves          → state = complete{result: B}
 *   5. fetch A FINALLY resolves  → state = complete{result: A}  ← stale clobber
 *   6. UI shows brief B alongside creatives from brief A        ← corruption
 *
 * With `submissionId`, every non-idle state carries a monotonic counter.
 * SUCCEEDED/FAILED/STAGE_CHANGED actions carry the id they were issued
 * under. The reducer drops any event whose id doesn't match the current
 * state's id — so fetch A's late-arriving SUCCEEDED is ignored in step 5.
 *
 * WHY onStageChange is on the GenerateFn contract:
 *
 * The MVP sync client (ADS-026) won't fire stage events — the POST
 * /api/generate endpoint is one-shot. But we plumb the callback through
 * NOW so a future streaming variant (SSE, WebSocket) can dispatch
 * STAGE_CHANGED without changing the hook's public interface. The cost
 * today is zero — the sync client just won't call the optional callback.
 *
 * WHY dependency injection for the generator function:
 *
 * The hook does NOT import the ADS-026 API client directly. The provider
 * accepts `generateCreatives` as a prop. Benefits:
 * - ADS-025 has zero compile-time dependency on ADS-026
 * - Tests can inject a fake generator without mocking modules
 * - The dashboard root wires the real client to the provider; components
 *   below never see the API client directly
 *
 * The prop is stashed in a ref inside the provider so `submit` is
 * unconditionally stable. If consumers were forced to memoize the prop,
 * one forgotten `useCallback` would silently break every context
 * consumer's memoization and cascade re-renders through the tree.
 *
 * See docs/adr/ADR-004-frontend-state-management.md for the full rationale.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { PipelineStage } from "@/lib/pipeline/types";
import type {
  GenerateRequestBody,
  GenerateSuccessResponseBody,
} from "@/lib/api/types";
import type { ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// State machine — discriminated union
// ---------------------------------------------------------------------------

/**
 * Pipeline session state.
 *
 * Each non-idle variant carries a `submissionId` so stale async events
 * from a previous submission can be dropped by the reducer. Only valid
 * fields appear on each branch — TypeScript narrowing prevents
 * components from accessing `result` in `idle` or `error` in `complete`.
 */
export type PipelineSessionState =
  | { status: "idle" }
  | {
      status: "submitting";
      submissionId: number;
      brief: GenerateRequestBody;
    }
  | {
      status: "generating";
      submissionId: number;
      brief: GenerateRequestBody;
      stage: PipelineStage;
    }
  | {
      status: "complete";
      submissionId: number;
      brief: GenerateRequestBody;
      result: GenerateSuccessResponseBody;
    }
  | {
      status: "error";
      submissionId: number;
      brief: GenerateRequestBody;
      error: ApiError;
    };

export type PipelineAction =
  | { type: "SUBMIT"; submissionId: number; brief: GenerateRequestBody }
  | { type: "STAGE_CHANGED"; submissionId: number; stage: PipelineStage }
  | {
      type: "SUCCEEDED";
      submissionId: number;
      result: GenerateSuccessResponseBody;
    }
  | { type: "FAILED"; submissionId: number; error: ApiError }
  | { type: "RESET" };

/**
 * The initial state, exported so tests can assert reference equality
 * against it (useReducer skips re-render when the reducer returns the
 * same reference via `Object.is`).
 */
export const INITIAL_STATE: PipelineSessionState = { status: "idle" };

/**
 * Exhaustiveness helper — compile-time error if a new PipelineAction
 * variant is added without a matching case.
 */
function assertUnreachable(action: never): never {
  throw new Error(
    `Unhandled pipeline action: ${JSON.stringify(action)}. ` +
      `Add a case in pipelineReducer — see ADR-004.`
  );
}

/**
 * Pure reducer function — exported for unit testing without mounting React.
 *
 * Stale-event guards: SUCCEEDED / FAILED / STAGE_CHANGED events whose
 * `submissionId` doesn't match the current state's id are silently
 * dropped. The reducer returns the same reference so React skips
 * re-rendering.
 */
export function pipelineReducer(
  state: PipelineSessionState,
  action: PipelineAction
): PipelineSessionState {
  switch (action.type) {
    case "SUBMIT":
      // SUBMIT is valid from ANY state — the reducer transitions
      // unconditionally. Double-submit prevention lives in the provider's
      // `submit` wrapper (via inFlightRef), not here, because the reducer
      // shouldn't know about async orchestration.
      return {
        status: "submitting",
        submissionId: action.submissionId,
        brief: action.brief,
      };

    case "STAGE_CHANGED":
      // Only valid while a session is in-flight. Stage events arriving in
      // idle/complete/error are stale and ignored.
      if (
        state.status !== "submitting" &&
        state.status !== "generating"
      ) {
        return state;
      }
      // Even in an in-flight state, a stage event from an EARLIER
      // submission must be dropped — otherwise a late stage update
      // would corrupt a newer session.
      if (action.submissionId !== state.submissionId) {
        return state;
      }
      return {
        status: "generating",
        submissionId: state.submissionId,
        brief: state.brief,
        stage: action.stage,
      };

    case "SUCCEEDED":
      // Drop if there's no active session (idle means nothing to complete).
      if (state.status === "idle") return state;
      // Drop stale events from a previous submission. This is the guard
      // that prevents the resubmit-race described in the module JSDoc.
      if (action.submissionId !== state.submissionId) return state;
      return {
        status: "complete",
        submissionId: state.submissionId,
        brief: state.brief,
        result: action.result,
      };

    case "FAILED":
      if (state.status === "idle") return state;
      if (action.submissionId !== state.submissionId) return state;
      return {
        status: "error",
        submissionId: state.submissionId,
        brief: state.brief,
        error: action.error,
      };

    case "RESET":
      return INITIAL_STATE;

    default:
      return assertUnreachable(action);
  }
}

// ---------------------------------------------------------------------------
// Generator contract — what ADS-026 API client must conform to
// ---------------------------------------------------------------------------

/**
 * Result of a submission attempt — discriminated union that the generator
 * function returns. Using a Result union (instead of throwing) means the
 * provider doesn't need to classify exceptions at runtime; the API client
 * classifies errors once and the hook just dispatches.
 */
export type GenerateOutcome =
  | { ok: true; data: GenerateSuccessResponseBody }
  | { ok: false; error: ApiError };

/**
 * Options passed to the generator by the provider.
 *
 * `onStageChange` is optional so a sync client can ignore it. A future
 * streaming client (SSE, WebSocket) calls it for each stage transition
 * to drive real-time progress UI.
 */
export interface GenerateFnOptions {
  onStageChange?: (stage: PipelineStage) => void;
}

/**
 * The async function that the provider calls on submit. ADS-026 implements
 * this contract (fetch the backend, parse the response, classify errors).
 * The hook doesn't care HOW the call is made — only that it resolves to a
 * GenerateOutcome.
 */
export type GenerateFn = (
  brief: GenerateRequestBody,
  options?: GenerateFnOptions
) => Promise<GenerateOutcome>;

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

/**
 * The public hook surface — `state` for reading, `submit`/`reset` for
 * writing. Notice there's NO raw `dispatch` — the provider owns
 * orchestration (submissionId tracking, error classification) so
 * consumers can't accidentally bypass it.
 */
export interface PipelineStateContextValue {
  state: PipelineSessionState;
  submit: (brief: GenerateRequestBody) => Promise<void>;
  reset: () => void;
}

const PipelineStateContext = createContext<PipelineStateContextValue | null>(
  null
);

export interface PipelineStateProviderProps {
  children: ReactNode;
  /**
   * The function that actually submits a brief to the backend.
   * Injected so the hook has no compile-time dependency on the API client.
   *
   * Stability note: the provider stashes this prop in a ref and reads
   * `ref.current` inside `submit`, so consumers do NOT need to memoize
   * this prop. An inline `() => client.generate(b)` is safe.
   */
  generateCreatives: GenerateFn;
}

/**
 * Generic generic client-side error message. We never surface the raw
 * caught.message to users because it could contain stack traces, SDK
 * internals, or secrets. The real error is logged in development.
 */
const GENERIC_CLIENT_ERROR_MESSAGE =
  "An unexpected error occurred while submitting the brief. Please try again.";

export function PipelineStateProvider({
  children,
  generateCreatives,
}: PipelineStateProviderProps) {
  const [state, dispatch] = useReducer(pipelineReducer, INITIAL_STATE);

  // Latest-ref pattern for the generator prop. `submit` reads from the ref
  // so it doesn't need `generateCreatives` in its dependency array, which
  // means `submit` is STABLE across renders regardless of how the parent
  // passes the prop (inline arrow, useCallback, module-level, etc.).
  const generatorRef = useRef(generateCreatives);
  useEffect(() => {
    generatorRef.current = generateCreatives;
  }, [generateCreatives]);

  // Monotonic submission counter. Every call to `submit` increments this
  // and captures the new id. Later dispatches use the captured id so the
  // reducer can drop events from cancelled/superseded submissions.
  const submissionIdRef = useRef(0);

  // Boolean gate for rapid-click double-submit prevention. This is SEPARATE
  // from the submissionId check because we want to reject a double-click
  // BEFORE even incrementing the id — otherwise rapid clicks would bump
  // the counter and each would see its own id match.
  const inFlightRef = useRef(false);

  const submit = useCallback(
    async (brief: GenerateRequestBody): Promise<void> => {
      if (inFlightRef.current) {
        // Silent no-op — the caller's button should be disabled anyway, so
        // hitting this branch means the UI state and hook state drifted.
        // Logging helps detect that drift in development.
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[usePipelineState] submit() called while a session is already in flight — ignoring"
          );
        }
        return;
      }

      const capturedId = ++submissionIdRef.current;
      inFlightRef.current = true;

      try {
        dispatch({ type: "SUBMIT", submissionId: capturedId, brief });

        let outcome: GenerateOutcome;
        try {
          outcome = await generatorRef.current(brief, {
            onStageChange: (stage) => {
              // Only dispatch if this submission is still the current one —
              // if reset() and a new submit() happened while we were awaiting,
              // the reducer will drop this anyway, but the explicit check
              // saves an unnecessary dispatch round-trip.
              if (submissionIdRef.current !== capturedId) return;
              dispatch({
                type: "STAGE_CHANGED",
                submissionId: capturedId,
                stage,
              });
            },
          });
        } catch (caught) {
          // Defensive: the generator contract says it should return a
          // Result union, not throw. If ADS-026 (or a test fake) violates
          // the contract we surface a SANITIZED error — we never pipe
          // `caught.message` into the user-facing error field because it
          // could contain stack traces or secrets. Dev mode logs the full
          // error for debugging; production logs go through the logger.
          if (process.env.NODE_ENV !== "production") {
            console.error(
              "[usePipelineState] generator threw (contract violation):",
              caught
            );
          }
          outcome = {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: GENERIC_CLIENT_ERROR_MESSAGE,
              // crypto.randomUUID is available in all modern browsers and
              // Node 14+ — the client-side correlation id lets us trace
              // logs for a request that never reached the server.
              requestId: `client-${crypto.randomUUID()}`,
            },
          };
        }

        if (outcome.ok) {
          dispatch({
            type: "SUCCEEDED",
            submissionId: capturedId,
            result: outcome.data,
          });
        } else {
          dispatch({
            type: "FAILED",
            submissionId: capturedId,
            error: outcome.error,
          });
        }
      } finally {
        // Only clear the in-flight flag if WE are still the latest
        // submission. If reset() and a new submit() happened while we
        // were awaiting, the newer submit owns the flag and we must NOT
        // touch it.
        if (submissionIdRef.current === capturedId) {
          inFlightRef.current = false;
        }
      }
    },
    // Empty deps — `submit` is stable forever. Both refs are mutated
    // directly (no re-render needed), and `dispatch` from useReducer is
    // stable by React's guarantees.
    []
  );

  const reset = useCallback((): void => {
    // Clearing inFlightRef on reset is intentional: if the user resets
    // while a request is in flight, we want the next submit to work
    // immediately. The in-flight request's resolves will be dropped by
    // the submissionId guard in the reducer (because a newer SUBMIT will
    // have bumped the state's id).
    inFlightRef.current = false;
    dispatch({ type: "RESET" });
  }, []);

  // Memo the context value so consumers that only read `state` don't
  // re-render when the provider re-renders. `submit` and `reset` are
  // empty-deps callbacks so they're stable forever — the memo only needs
  // to update when `state` changes.
  const value = useMemo<PipelineStateContextValue>(
    () => ({ state, submit, reset }),
    [state, submit, reset]
  );

  return (
    <PipelineStateContext.Provider value={value}>
      {children}
    </PipelineStateContext.Provider>
  );
}

/**
 * Named error class for the missing-provider case so React error
 * boundaries can match on the class (or `.name`) rather than string-parsing
 * the message. A missing provider is always a programming error, so a
 * loud failure is better than a silent null.
 */
class PipelineProviderMissingError extends Error {
  constructor() {
    super(
      "usePipelineState must be used within a <PipelineStateProvider>. " +
        "Wrap your dashboard tree in the provider and pass a `generateCreatives` prop."
    );
    this.name = "PipelineProviderMissingError";
    // Standard ES2015 class inheritance fix for Error subclasses —
    // some bundlers/targets otherwise clobber the prototype chain.
    Object.setPrototypeOf(this, PipelineProviderMissingError.prototype);
  }
}

/**
 * Consume the pipeline state context.
 * Throws `PipelineProviderMissingError` if called outside a provider.
 */
export function usePipelineState(): PipelineStateContextValue {
  const ctx = useContext(PipelineStateContext);
  if (!ctx) {
    throw new PipelineProviderMissingError();
  }
  return ctx;
}
