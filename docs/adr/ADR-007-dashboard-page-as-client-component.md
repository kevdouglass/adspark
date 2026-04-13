# ADR-007: Dashboard Page as a Single Client Component

**Status:** Accepted
**Date:** 2026-04-12
**Decision Makers:** Kevin Douglass
**Origin:** ADS-006 (BriefForm) implementation — the dashboard page needs to host React Context providers, interactive form state, and client-only hooks. The default Next.js 15 App Router page is a Server Component, which doesn't support any of those.

## Decision

`app/page.tsx` is marked `"use client"` and renders the entire dashboard (BriefForm, PipelineProgress, CreativeGallery, D3Charts) as one client-rendered tree.

The rest of the App Router — `layout.tsx`, API route handlers in `app/api/`, and any future static pages — stays server-rendered. Only this one page opts out.

## Context

Next.js 15 App Router defaults every `page.tsx` to a **Server Component**. Server Components are rendered to HTML on the server and cannot:
- Use `useState`, `useReducer`, `useEffect`, `useContext`, or any other React hook
- Host Context Providers
- Register event handlers on DOM elements
- Import modules that depend on the browser environment

The AdSpark dashboard needs all of the above:
- `<PipelineStateProvider>` wraps the entire dashboard (ADR-004, ADS-025) — a Context Provider
- `<BriefForm>` uses `react-hook-form` (ADS-006) — a client-only library that calls `useState` internally
- `<CreativeGallery>` (ADS-007) and `<PipelineProgress>` (ADS-008) consume the hook via `useContext`
- `<D3Charts>` (ADS-009) will manipulate the DOM directly via D3.js

Any one of these requires the hosting page to be a Client Component. Four of them together make the decision unambiguous.

## Options Considered

### Option A: Entire `page.tsx` as a Client Component (Selected)

Put `"use client"` at the top of `page.tsx`. Every child component renders on the client. The page compiles to a tiny server-rendered shell that hydrates into the interactive dashboard.

**Pros:**
- **Simplest possible setup.** One directive, no wrapper components, no prop-drilling between server and client boundaries.
- Every component in the dashboard tree has free access to hooks, context, and event handlers without a "client boundary" refactor every time a new interactive feature lands.
- D3 charts (ADS-009) work out of the box — no "useEffect + ref" gymnastics to escape a Server Component.
- Next.js still server-renders the `<html>` and `<body>` shell via `layout.tsx`, so SEO metadata and initial HTML delivery are unchanged.
- The bundle cost is the same as Option B — the components themselves are identical, only the boundary location differs.

**Cons:**
- The dashboard page produces no useful Server Component HTML — the server sends an empty shell that hydrates on the client. For a SPA-style interactive tool this is the correct trade-off, but it's worth naming.
- Any future "static section" on the dashboard (e.g., a footer with pre-rendered marketing copy) would need to be extracted into a separate server-rendered component and imported as `children`.

### Option B: Server `page.tsx` + a `<DashboardShell>` Client Wrapper

Keep `page.tsx` as a Server Component. Create `components/DashboardShell.tsx` with `"use client"`. The page's only job is to render the shell:

```tsx
// app/page.tsx (server)
import DashboardShell from "@/components/DashboardShell";
export default function Home() {
  return <DashboardShell />;
}
```

**Pros:**
- Keeps the page technically server-rendered — "rule compliance" with the Next.js default.
- If we later add server-rendered content alongside the dashboard (a static hero, SEO footer, etc.), the server page becomes the natural home.

**Cons:**
- **Two files where one would do.** The `page.tsx` exists only to import `DashboardShell` — pure indirection with zero logic.
- Developer onboarding: "Why does the page import a component instead of being the component?" requires an explanation that the Option A approach doesn't.
- Any future page-level interaction (e.g., reading URL params via `useSearchParams`) now has to cross the shell boundary, adding prop-drilling debt.
- Doesn't buy any real SEO benefit because the server-rendered HTML is just `<DashboardShell />`, which renders nothing until hydration anyway.

### Option C: Individual Component `"use client"` Directives

Leave `page.tsx` as a Server Component. Mark each interactive component (`BriefForm`, `PipelineProgress`, etc.) with `"use client"` individually. The page renders them as children; each one becomes a client island.

**Pros:**
- Most granular control — server-renders as much of the tree as possible.

**Cons:**
- **Doesn't work for this project.** `<PipelineStateProvider>` is a Context Provider that must be mounted ABOVE the components that consume it. If the provider is a client component, `page.tsx` (server) cannot render it directly. The provider would have to be its own client wrapper, collapsing this option into Option B anyway.
- Every new interactive component needs its own `"use client"` directive — easy to forget.
- Client islands can't share Context — `usePipelineState()` would break across island boundaries.

### Option D: Suspend the Providers in a Layout

Hoist `<PipelineStateProvider>` into `app/layout.tsx` so it wraps every page in the app.

**Pros:**
- Provider is available everywhere without per-page setup.

**Cons:**
- **Wrong scope.** The pipeline state is local to one generation session, not a global app concept. Mounting it in the layout would let the state leak across routes (if AdSpark ever had multiple pages), create cross-page stale state on the back button, and break the "reset on route change" semantic that ADR-004 explicitly calls out as a benefit of keeping the provider scoped to the dashboard page.
- The layout file mixes layout concerns (header, fonts, metadata) with feature-specific state management — a violation of single responsibility.

## Decision Criteria

| Criteria | A: `"use client"` page | B: Client shell wrapper | C: Per-component | D: Layout-hoisted |
|---|:---:|:---:|:---:|:---:|
| Works with `<PipelineStateProvider>` | ✅ | ✅ | ❌ | ✅ (but wrong scope) |
| Zero indirection files | ✅ | ❌ | ✅ | ❌ |
| Pipeline state scoped to one page | ✅ | ✅ | ✅ | ❌ |
| D3 charts work without ceremony | ✅ | ✅ | ✅ | ✅ |
| SEO cost (dashboard has no static content anyway) | ⚠️ empty shell | ⚠️ empty shell | ✅ minimal | ✅ minimal |
| Developer ergonomics | ✅ | ⚠️ why the wrapper? | ⚠️ per-file toil | ⚠️ wrong scope |

## The Tiebreaker: The Dashboard is a SPA, Not a Marketing Page

AdSpark's dashboard has zero static content. Every pixel is driven by the user's form input and the pipeline's async response. There's nothing a Server Component could contribute to the first-paint HTML beyond an empty container waiting for hydration.

In that world, pretending the page is server-rendered via Option B or Option C buys nothing — the bundle is the same, the first meaningful paint is the same, and the only practical difference is one extra file (Option B) or one extra directive per component (Option C). Option A is **smaller, simpler, and honest about what the page actually is**.

A reviewer reading `app/page.tsx` with `"use client"` at the top immediately understands the intent. The ADR documents why the default was flipped.

## Implementation Notes

### The Directive Goes at the Top of `page.tsx` Only

```tsx
// app/page.tsx
"use client";

import { AppProviders } from "@/components/providers/AppProviders";
import { BriefForm } from "@/components/BriefForm";
import { PipelineProgress } from "@/components/PipelineProgress";
import { CreativeGallery } from "@/components/CreativeGallery";

export default function Home() {
  return (
    <AppProviders>
      {/* Firefly-style sidebar + canvas layout — see ADR-004 for the
          state machine that drives these components. */}
      <div className="flex min-h-screen ...">
        <aside className="w-[300px] ..."><BriefForm /></aside>
        <main className="flex-1 ...">
          <PipelineProgress />
          <CreativeGallery />
        </main>
      </div>
    </AppProviders>
  );
}
```

### `layout.tsx` Stays Server-Rendered

`layout.tsx` owns the HTML document shell (`<html>`, `<body>`, metadata, fonts). It has no state, no hooks, no providers. Keeping it server-rendered means:
- `<Metadata>` works natively
- Fonts are injected via Next.js's font loader without client overhead
- The response still streams an HTML shell immediately on first request

### API Routes Are Unaffected

`app/api/*/route.ts` handlers are server-only by definition — they never execute in the browser. This ADR doesn't touch them.

### D3Charts (ADS-009) Benefits Most

D3 manipulates the DOM via imperative APIs (`d3.select`, `.attr()`, `.append()`). Inside a Client Component, this works in a `useEffect` with a `ref`. Inside a Server Component, it wouldn't work at all — the DOM doesn't exist yet. Option A is the only choice that makes D3 a straightforward drop-in.

## Consequences

### Positive
- **Zero indirection.** The page file IS the dashboard. No wrapper component.
- `<PipelineStateProvider>` mounts in the page, scoped to the page, teardown on route change.
- All four dashboard components (BriefForm, PipelineProgress, CreativeGallery, D3Charts) share context without any per-component `"use client"` directives.
- D3 charts work without any "useEffect-ref" dance beyond the normal D3 pattern.
- `layout.tsx` stays clean and server-rendered.

### Negative
- The dashboard page produces no useful server HTML beyond an empty shell. Acceptable for a SPA dashboard; not acceptable for a content-heavy page.
- If AdSpark ever adds a public marketing page or a campaign-history landing page, those should be Server Components — this ADR does NOT apply to them.

### Risks
- **Bundle size drift:** every import into `page.tsx` becomes part of the client bundle. If someone accidentally imports a heavy server-only utility (e.g., the pipeline orchestrator), it ships to every visitor. **Mitigation:** keep `lib/pipeline/*` off the client import graph via convention, and rely on `lib/api/client.ts` as the only HTTP boundary. Long-term mitigation would be an ESLint rule forbidding `lib/pipeline/*` imports from files under `components/` and `app/page.tsx`.
- **SSR benefits lost:** no first-contentful-paint from server HTML. For a dashboard where the first paint is a blank form waiting for user input, this is fine. For any future marketing page, pick Option C (per-component client islands) instead.

## References

- `app/page.tsx` — the dashboard page (this ADR's subject)
- `components/providers/AppProviders.tsx` — client wrapper around `<PipelineStateProvider>`
- ADR-004 — useReducer + Context for pipeline state (why the provider exists at all)
- ADR-006 — API wire format parallel shapes (why the client calls `generateCreatives` directly)
- Next.js docs on the `"use client"` directive: https://nextjs.org/docs/app/api-reference/directives/use-client
