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
 * WHY dependency injection for the generator function:
 *
 * The hook does NOT import the ADS-026 API client directly. Instead, the
 * provider accepts a `generateCreatives` prop that conforms to the
 * `GenerateFn` contract. Benefits:
 * - ADS-025 has zero compile-time dependency on ADS-026 (ship them in
 *   either order)
 * - Tests can inject a fake generator without mocking modules
 * - The dashboard root wires the real client to the provider; components
 *   below never see the API client directly
 *
 * See docs/adr/ADR-004-frontend-state-management.md for the full rationale.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
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
 * Each variant carries only the fields that are valid in that state —
 * TypeScript narrowing prevents components from accessing `result` in
 * `idle` or `error` in `complete`. Invalid states are literally
 * unrepresentable in the type system.
 */
export type PipelineSessionState =
  | { status: "idle" }
  | { status: "submitting"; brief: GenerateRequestBody }
  | {
      status: "generating";
      brief: GenerateRequestBody;
      stage: PipelineStage;
    }
  | {
      status: "complete";
      brief: GenerateRequestBody;
      result: GenerateSuccessResponseBody;
    }
  | { status: "error"; brief: GenerateRequestBody; error: ApiError };

export type PipelineAction =
  | { type: "SUBMIT"; brief: GenerateRequestBody }
  | { type: "STAGE_CHANGED"; stage: PipelineStage }
  | { type: "SUCCEEDED"; result: GenerateSuccessResponseBody }
  | { type: "FAILED"; error: ApiError }
  | { type: "RESET" };

const INITIAL_STATE: PipelineSessionState = { status: "idle" };

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
 * Stale-event guards: SUCCEEDED / FAILED / STAGE_CHANGED from an `idle`
 * state are silently dropped (the reducer returns the same reference, so
 * React skips re-rendering). This protects against the race where a
 * generation completes after the user has already called reset().
 */
export function pipelineReducer(
  state: PipelineSessionState,
  action: PipelineAction
): PipelineSessionState {
  switch (action.type) {
    case "SUBMIT":
      // SUBMIT is valid from ANY state — the reducer transitions
      // unconditionally. Double-submit prevention lives in the provider's
      // `submit` wrapper, not here, because the reducer shouldn't know
      // about async orchestration.
      return { status: "submitting", brief: action.brief };

    case "STAGE_CHANGED":
      // Only valid while a session is in-flight. Stage events arriving in
      // idle/complete/error are stale and ignored.
      if (
        state.status !== "submitting" &&
        state.status !== "generating"
      ) {
        return state;
      }
      return {
        status: "generating",
        brief: state.brief,
        stage: action.stage,
      };

    case "SUCCEEDED":
      // Dropping stale success events prevents a reset-then-late-resolve
      // race from clobbering the user's intentional reset. `complete` and
      // `error` also accept SUCCEEDED because re-submission through those
      // terminal states is a valid path (user clicks submit again after
      // seeing an error).
      if (state.status === "idle") return state;
      return {
        status: "complete",
        brief: state.brief,
        result: action.result,
      };

    case "FAILED":
      if (state.status === "idle") return state;
      return {
        status: "error",
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
 * The async function that the provider calls on submit. ADS-026 implements
 * this contract (fetch the backend, parse the response, classify errors).
 * The hook doesn't care HOW the call is made — only that it resolves to a
 * GenerateOutcome.
 */
export type GenerateFn = (
  brief: GenerateRequestBody
) => Promise<GenerateOutcome>;

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

/**
 * The public hook surface — `state` for reading, `submit`/`reset` for
 * writing. Notice there's NO raw `dispatch` — the provider owns
 * orchestration (double-submit prevention, error classification) so
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
   */
  generateCreatives: GenerateFn;
}

export function PipelineStateProvider({
  children,
  generateCreatives,
}: PipelineStateProviderProps) {
  const [state, dispatch] = useReducer(pipelineReducer, INITIAL_STATE);

  // Double-submit prevention via ref, NOT via reading state.status in a
  // closure. If we used state.status in useCallback, the closure would
  // capture a possibly-stale status between renders and let a second call
  // slip through. A ref is updated synchronously and is always current.
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

      inFlightRef.current = true;
      try {
        dispatch({ type: "SUBMIT", brief });

        let outcome: GenerateOutcome;
        try {
          outcome = await generateCreatives(brief);
        } catch (caught) {
          // Defensive: the generator contract says it should return a
          // Result union, not throw. If ADS-026 (or a test fake) violates
          // the contract we surface it as a generic INTERNAL_ERROR rather
          // than letting the exception escape the provider and crash the
          // component tree.
          outcome = {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message:
                caught instanceof Error
                  ? caught.message
                  : "The generator function threw an unexpected error",
              requestId: "client-unknown",
            },
          };
        }

        if (outcome.ok) {
          dispatch({ type: "SUCCEEDED", result: outcome.data });
        } else {
          dispatch({ type: "FAILED", error: outcome.error });
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [generateCreatives]
  );

  const reset = useCallback((): void => {
    // Clearing the in-flight flag on reset is a belt-and-suspenders move —
    // the `finally` block in submit() already clears it, but if a caller
    // resets mid-flight (e.g. user navigates away) we want the next submit
    // to work even though the previous outcome may arrive later (and be
    // dropped by the reducer's stale-event guards).
    inFlightRef.current = false;
    dispatch({ type: "RESET" });
  }, []);

  // useMemo on the context value so consumers that only read `state` don't
  // re-render when `submit` and `reset` are recreated — those callbacks are
  // stable per `generateCreatives`, so this memo is cheap and correct.
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
 * Consume the pipeline state context.
 *
 * Throws if called outside a `<PipelineStateProvider>` — a missing provider
 * is always a programming error, not a runtime edge case, so a loud failure
 * is better than a silent null. The error message points the developer at
 * the fix.
 */
export function usePipelineState(): PipelineStateContextValue {
  const ctx = useContext(PipelineStateContext);
  if (!ctx) {
    throw new Error(
      "usePipelineState must be used within a <PipelineStateProvider>. " +
        "Wrap your dashboard tree in the provider and pass a `generateCreatives` prop."
    );
  }
  return ctx;
}
