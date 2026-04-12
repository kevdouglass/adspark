# ADR-004: Frontend State Management — useReducer + React Context

**Status:** Accepted
**Date:** 2026-04-12
**Decision Makers:** Kevin Douglass
**Origin:** Phase 2 planning — state coordination across dashboard components

## Decision

Use **React's built-in `useReducer` + `Context`** for coordinating pipeline state across dashboard components. The state is a **discriminated union** that models the pipeline's state machine (`idle → submitting → generating → compositing → organizing → complete | error`). A single `usePipelineState()` hook (implemented in ADS-025) provides the reducer and context consumer for every downstream component (ADS-006 BriefForm, ADS-007 CreativeGallery, ADS-008 PipelineProgress, ADS-009 D3Charts).

**No external state library. No server-state caching. No observable stores.**

## Context

Phase 2 introduces multiple React components that must coordinate around a single concept: the current generation session. When a user clicks "Generate" in `BriefForm`, the app transitions through stages that every component needs to observe:

```
idle
  ↓ user submits brief
submitting        ← BriefForm disables, PipelineProgress starts
  ↓ fetch in flight
generating        ← PipelineProgress shows "Generating 6 images..."
  ↓ pipeline progresses through stages (via onStageChange callback)
compositing       ← PipelineProgress shows "Overlaying text..."
  ↓
organizing        ← PipelineProgress shows "Saving creatives..."
  ↓
complete          ← CreativeGallery renders the result
   OR
error             ← Inline error displayed, BriefForm re-enabled
```

**The coordination problem:** All four components (BriefForm, Gallery, Progress, D3Charts) need read access to this state, and one (BriefForm) needs write access to dispatch `submit(brief)` and `reset()`. Without a shared mechanism, we'd either:
1. Prop-drill state down from the top-level page → ugly and fragile
2. Lift state to the page and duplicate logic → drift risk
3. Use a global store → consistent but may be over-engineering

The decision is about which mechanism fits this exact problem shape.

## The Scope: What This State IS and IS NOT

| Concern | This State? |
|---------|:-----------:|
| Current pipeline session (stage, result, error) | ✅ Yes |
| Form field values (campaign name, products) | ❌ No — lives in `react-hook-form` (see ADR-005) |
| URL state (which campaign is being viewed) | ❌ No — Next.js router |
| Server-cached data (previous campaigns) | ❌ No — out of scope for POC |
| Auth session | ❌ No — no auth in POC |
| Theme/preferences | ❌ No — hardcoded for POC |

This is **local ephemeral UI state for ONE generation session.** When the user leaves the page, it's gone. That framing matters for picking the right tool.

## Options Considered

### Option A: `useReducer` + React Context (Selected)

**How it works:** A single reducer defines the state machine as a discriminated union. React Context provides the state and dispatch to every component without prop drilling. The `usePipelineState()` hook is the only public API — components never call `useContext` directly.

```typescript
// lib/hooks/usePipelineState.ts (ADS-025)
export type PipelineSessionState =
  | { status: "idle" }
  | { status: "submitting"; brief: CampaignBrief }
  | { status: "generating"; brief: CampaignBrief; stage: PipelineStage }
  | { status: "complete"; result: PipelineResult }
  | { status: "error"; error: ApiError };

type PipelineAction =
  | { type: "SUBMIT"; brief: CampaignBrief }
  | { type: "STAGE_CHANGED"; stage: PipelineStage }
  | { type: "SUCCEEDED"; result: PipelineResult }
  | { type: "FAILED"; error: ApiError }
  | { type: "RESET" };

// Components consume via usePipelineState() — never useContext directly
export function usePipelineState() {
  const ctx = useContext(PipelineStateContext);
  if (!ctx) throw new Error("usePipelineState must be used within PipelineStateProvider");
  return ctx;
}
```

- **Pros:**
  - **Zero dependencies** — React's built-ins handle this perfectly
  - State machine maps 1:1 to discriminated union — TypeScript narrowing gives each component only the fields valid for the current stage (e.g., `result` only exists in `complete`)
  - Reducer is pure — trivially testable without mounting React
  - Matches the mental model of the pipeline (which is also a state machine per `orchestration.md`)
  - No magic — a new developer reads the reducer and understands every possible transition
  - Context re-renders only consumers of the hook, not the whole tree
  - No risk of state leaking across sessions or routes — the provider is scoped to the dashboard page
- **Cons:**
  - Requires a `<PipelineStateProvider>` wrapper around the dashboard components
  - Context re-renders can cause unnecessary work if a component consumes the whole context but only needs one field (mitigated: our state object is small, re-render cost is negligible)
  - More ceremony than Zustand for simple cases (acceptable: our case has well-defined states that benefit from the reducer pattern)

### Option B: Zustand

**How it works:** A store defined as a plain JavaScript object with actions. Components subscribe to slices of the store via a hook.

```typescript
const usePipelineStore = create<PipelineStore>((set) => ({
  status: "idle",
  submit: async (brief) => {
    set({ status: "submitting", brief });
    // ... fetch and update
  },
  reset: () => set({ status: "idle" }),
}));
```

- **Pros:**
  - Very popular in React/Next.js ecosystem (~20% of 2026 startups use it)
  - No provider needed — store is a singleton
  - Excellent selector-based subscriptions — components re-render only when their slice changes
  - Smaller boilerplate than useReducer for simple cases
  - Works outside React (for imperative state updates from non-React code)
- **Cons:**
  - **Adds a dependency** — 1KB but still one more package to pin
  - Singleton store is global — harder to isolate state between test cases or sub-pages
  - Actions are methods on the store, not a pure reducer — less obvious that state transitions are explicit
  - Doesn't naturally express state machines (discriminated unions require manual discipline)
  - Interview defense: "Why not React's built-ins?" — requires justification
  - **Kevin's goal is Staff-level architecture demonstration** — picking a library where built-ins suffice is a negative signal

### Option C: TanStack Query (React Query)

**How it works:** Wraps fetch calls in a `useQuery`/`useMutation` hook that handles caching, background refetching, and loading states.

```typescript
const mutation = useMutation({
  mutationFn: (brief: CampaignBrief) => generateCreatives(brief),
});
```

- **Pros:**
  - Industry standard for **server state** (caching, invalidation, background refetch)
  - Built-in loading/error/success states
  - Optimistic updates, retries, stale-while-revalidate patterns
- **Cons:**
  - **Wrong tool for this job** — we don't have server state in the React Query sense. There's no cache invalidation, no background refetch, no polling. The pipeline runs once per submission and results are local.
  - Using `useMutation` for a 25-30s fetch is fine, but `useMutation` is just an async wrapper — it doesn't model our multi-stage state machine
  - Can't naturally express the intermediate stages (generating → compositing → organizing) that come from `onStageChange`
  - Bundle cost (~13KB) for features we don't need
  - **Anti-pattern: using a server-state library for ephemeral UI state** — every experienced React dev would flag this

### Option D: Native `useState` + Prop Drilling

**How it works:** Lift state to the dashboard page, pass it down as props.

```typescript
// app/page.tsx
const [session, setSession] = useState<PipelineSessionState>({ status: "idle" });
return (
  <>
    <BriefForm onSubmit={...} disabled={session.status !== "idle"} />
    <PipelineProgress session={session} />
    <CreativeGallery result={session.status === "complete" ? session.result : null} />
  </>
);
```

- **Pros:**
  - Simplest possible implementation
  - Zero abstractions
- **Cons:**
  - **Breaks down at 4+ components** — prop drilling becomes noise
  - Every component has to defensively handle "wrong state" cases
  - Update logic lives in the page component — violates separation of concerns
  - No place to centralize state machine rules
  - D3Charts (ADS-009) in Phase 5 would inherit the prop-drilling debt

### Option E: Redux Toolkit

**How it works:** Full-featured flux pattern with slices, selectors, thunks, RTK Query.

- **Pros:**
  - Industry proven at scale
  - Excellent devtools
- **Cons:**
  - **Massive over-engineering** for ephemeral local UI state
  - Bundle cost (~20KB minimum)
  - Boilerplate even with RTK
  - Global singleton store creates test isolation issues
  - Interview red flag: "Why Redux for a form + results display?"

### Option F: Jotai / Valtio

**How it works:** Atomic state management. Each piece of state is an independent atom or a proxy object.

- **Pros:**
  - Fine-grained reactivity
  - Clever APIs
- **Cons:**
  - Niche in 2026 (~5% combined market share)
  - Doesn't naturally model state machines
  - Interview defensibility is weak — "Why Jotai?" is a harder question than "Why Zod?"
  - Adds a dependency for something we don't need

## Decision Criteria

| Criteria | A: useReducer + Context | B: Zustand | C: TanStack Query | D: useState | E: Redux | F: Jotai/Valtio |
|----------|:-----------------------:|:----------:|:-----------------:|:-----------:|:--------:|:---------------:|
| Zero dependencies | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Models state machine naturally | ✅ **Discriminated union** | ⚠️ Manual | ❌ | ⚠️ Manual | ✅ | ❌ |
| Cross-component access | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Pure reducer (testable) | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Bundle cost | ✅ 0KB | ⚠️ 1KB | ❌ 13KB | ✅ 0KB | ❌ 20KB | ⚠️ 2-3KB |
| Right tool for the job | ✅ | ⚠️ Overkill | ❌ Wrong tool | ❌ Doesn't scale | ❌ Overkill | ❌ Niche |
| Interview defensibility | ✅ "Built-ins are enough" | ⚠️ "Why not built-ins?" | ❌ "Wrong tool" | ⚠️ "Will it scale?" | ❌ "Overkill" | ❌ "Why niche?" |
| Staff Engineer signal | ✅ **"I know when NOT to reach for a library"** | ⚠️ | ❌ | ⚠️ | ❌ | ❌ |

## The Tiebreaker: "Know When NOT to Add a Dependency"

Staff Engineers are hired for judgment, not knowledge of the most libraries. **Picking React's built-ins when they suffice is a stronger signal than picking a trendy library.**

Quinn Frampton's feedback after Round 1: *"Interested in HOW he got the AI to do it."* By extension, the same principle applies to state management: **"How did you decide what tool to use?"** An evaluator seeing `useReducer + Context` reads: "This developer knows state machines, knows React's built-ins, and deliberately chose the simpler option."

The same evaluator seeing Zustand (for no reason beyond popularity) reads: "This developer defaulted to the popular choice without thinking."

The same evaluator seeing Redux Toolkit reads: "This developer over-engineered."

**The cost of picking the wrong library here isn't performance or bundle size — it's the implicit signal it sends about engineering maturity.**

## Implementation Notes

### State Machine as Discriminated Union

```typescript
// lib/hooks/usePipelineState.ts
import type { CampaignBrief, PipelineResult, PipelineStage } from "@/lib/pipeline/types";
import type { ApiError } from "@/lib/api/errors";

export type PipelineSessionState =
  | { status: "idle" }
  | { status: "submitting"; brief: CampaignBrief }
  | { status: "generating"; brief: CampaignBrief; stage: PipelineStage }
  | { status: "complete"; brief: CampaignBrief; result: PipelineResult }
  | { status: "error"; brief: CampaignBrief; error: ApiError };

type PipelineAction =
  | { type: "SUBMIT"; brief: CampaignBrief }
  | { type: "STAGE_CHANGED"; stage: PipelineStage }
  | { type: "SUCCEEDED"; result: PipelineResult }
  | { type: "FAILED"; error: ApiError }
  | { type: "RESET" };

function pipelineReducer(
  state: PipelineSessionState,
  action: PipelineAction
): PipelineSessionState {
  switch (action.type) {
    case "SUBMIT":
      return { status: "submitting", brief: action.brief };

    case "STAGE_CHANGED":
      if (state.status !== "submitting" && state.status !== "generating") {
        return state; // Ignore stage updates outside active generation
      }
      return { status: "generating", brief: state.brief, stage: action.stage };

    case "SUCCEEDED":
      if (state.status === "idle") return state; // Ignore stale success
      return { status: "complete", brief: state.brief, result: action.result };

    case "FAILED":
      if (state.status === "idle") return state; // Ignore stale failure
      return { status: "error", brief: state.brief, error: action.error };

    case "RESET":
      return { status: "idle" };
  }
}
```

**Key benefit:** TypeScript narrows the state type per branch. Inside `CreativeGallery`, checking `if (state.status === "complete")` lets the compiler know `state.result` exists without a non-null assertion.

### Component Consumption Pattern

```typescript
// components/CreativeGallery.tsx
"use client";

import { usePipelineState } from "@/lib/hooks/usePipelineState";

export function CreativeGallery() {
  const { state } = usePipelineState();

  if (state.status !== "complete") {
    return null; // Only render when we have a result
  }

  // TypeScript knows state.result exists here — no optional chaining needed
  return (
    <div>
      {state.result.creatives.map((creative) => (
        <img key={creative.creativePath} src={creative.creativeUrl} />
      ))}
    </div>
  );
}
```

### Provider Scoping

The `<PipelineStateProvider>` wraps the dashboard section of `app/page.tsx`, **not** the entire app layout. This ensures:
- State is local to the dashboard view
- Navigating away and returning resets the state naturally
- No global singleton pollution
- Each test can mount a fresh provider with custom initial state

### Reducer Testing Without React

```typescript
// __tests__/pipelineReducer.test.ts
import { pipelineReducer } from "@/lib/hooks/usePipelineState";

describe("pipelineReducer", () => {
  it("transitions idle → submitting on SUBMIT", () => {
    const result = pipelineReducer(
      { status: "idle" },
      { type: "SUBMIT", brief: VALID_BRIEF }
    );
    expect(result).toEqual({ status: "submitting", brief: VALID_BRIEF });
  });

  it("ignores STAGE_CHANGED when state is idle", () => {
    const before = { status: "idle" } as const;
    const after = pipelineReducer(before, {
      type: "STAGE_CHANGED",
      stage: "generating",
    });
    expect(after).toBe(before); // Reference equality — no state change
  });
});
```

No component mount, no React Testing Library, no Vitest React environment. Pure function tests that run in milliseconds.

## Consequences

### Positive
- Zero added dependencies — React's built-ins carry the design
- TypeScript narrowing makes invalid states unrepresentable (e.g., `state.result` only exists in `complete`)
- Reducer is pure — trivially unit-testable without React Testing Library
- State machine explicit in the type system — future contributors read the union and understand every possible state
- No risk of global singleton state leaking across test cases or sub-pages
- Interview defense: "I picked the simpler option because it was sufficient. That's a Staff Engineer judgment call, not a limitation."

### Negative
- `<PipelineStateProvider>` must be mounted in `app/page.tsx` — one extra component in the tree
- Context re-renders all consumers when state changes (acceptable: our state object is small, consumer count is ≤4)
- If the app grows to include server state (campaign history, user accounts), we'll need to introduce TanStack Query separately — but that's a later decision, not a now decision

### Risks
- **If Phase 5 adds real server state** (paginated campaign history, real-time status from a job queue), we'll need to layer TanStack Query on top. **Mitigation:** The reducer pattern doesn't conflict with TanStack Query — the two coexist cleanly (server state in queries, local UI state in reducer). This ADR will be superseded by a new ADR when that happens.
- **If the team grows and multiple developers need to understand the reducer** — `useReducer` has a steeper learning curve than `useState` for junior developers. **Mitigation:** The reducer is <100 lines and has inline tests. Documentation lives in the hook file itself.

## References

- `lib/hooks/usePipelineState.ts` (to be implemented in ADS-025)
- ADR-002 — Direct SDK integration + synchronous request/response pattern (why we don't need server state)
- ADR-005 — Zod for form validation (complementary — form state lives in `react-hook-form`, pipeline state lives in this reducer)
- `docs/architecture/orchestration.md` — Pipeline state machine spec
- React docs on `useReducer`: https://react.dev/reference/react/useReducer
- Dan Abramov on "when not to use Redux": https://redux.js.org/faq/general#when-should-i-use-redux
