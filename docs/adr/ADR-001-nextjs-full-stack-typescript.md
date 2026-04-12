# ADR-001: Next.js Full-Stack with TypeScript for POC and Production Path

**Status:** Accepted
**Date:** 2026-04-11
**Decision Makers:** Kevin Douglass

## Decision

Use **Next.js (App Router) + TypeScript + DALL-E 3 + Sharp + @napi-rs/canvas** as a single full-stack application. The pipeline logic lives in `lib/pipeline/`, the API is Next.js Route Handlers, the frontend is React + D3.js, and deployment is Vercel. No Python. No polyglot split.

## Context

The Adobe Forward Deployed AI Engineer role (Firefly team) lists **React.js, Next.js, and Angular** as preferred front-end technologies. The assessment brief says: *"You may use any third-party tools available to you."*

The original plan (captured in the assessment prep docs) was Python CLI + Pillow. That plan was based on two assumptions that research invalidated:

1. **"Python is needed for LangGraph"** — False. `@langchain/langgraph` v1.2.8 (JS/TS, released 2026-04-07) is at near-parity with the Python SDK, including human-in-the-loop and checkpoint persistence. LangGraph is also unnecessary for this pipeline — it's a deterministic sequence, not an agentic reasoning loop.

2. **"Python is needed for image processing"** — False. `@napi-rs/canvas` (Skia-backed, Rust-native) provides Pillow-equivalent text compositing in Node.js. Sharp handles resize/optimize. The gap that historically made Pillow superior — font handling and native text rendering — has been closed.

With those constraints removed, the decision becomes: **use the JD-preferred stack and ship a more impressive demo, or use Python and ship faster but less aligned?**

## Options Considered

### Option A: Python CLI

**The pipeline as a command-line tool.**

- **Pros:**
  - Fastest path to working demo (~2 hours)
  - Pillow is slightly easier for text compositing (built-in multi-line text)
  - Python's OpenAI SDK has more community examples
  - Lower scope — no CSS, routing, or state management
- **Cons:**
  - Doesn't demonstrate the JD-preferred stack
  - Terminal-only demo (less visually impressive)
  - Adding a React dashboard later means two codebases, CORS, separate deploys
  - No hosted URL for reviewers — they must clone, install Python, add API key

### Option B: Next.js Full-Stack (Selected)

**React frontend + Next.js API routes + D3.js dashboard in a single codebase.**

- **Pros:**
  - **Directly demonstrates JD-preferred stack** (React/Next.js)
  - Visual demo: brief form, creative gallery, D3 pipeline metrics
  - **Hosted on Vercel** — reviewer clicks a URL, no setup
  - Single codebase, single deploy, single language
  - TypeScript strict mode enforces type safety across the entire pipeline
  - S3 integration for production-ready asset storage
  - Shows full-stack capability: frontend + API + AI integration + infrastructure
- **Cons:**
  - ~4-5 hours vs ~2 hours (still within 24-hour window)
  - Image processing in Node.js requires two libraries (Sharp + @napi-rs/canvas) vs one (Pillow)
  - Vercel Hobby tier has 60s function timeout (mitigated by parallel DALL-E calls)
  - More surface area for bugs

### Option C: Python CLI + React Viewer (Hybrid)

**Python pipeline + separate React app that displays output.**

- **Pros:**
  - Fast pipeline + visual output
- **Cons:**
  - Two codebases, two deploy targets, two languages
  - The React viewer would be trivially simple — not impressive
  - CORS configuration, inter-service communication overhead
  - Worst of both worlds: complexity of polyglot without the benefits of either pure approach

## Research Findings That Informed This Decision

### OpenAI SDK (DALL-E 3)

Full feature parity between Node.js and Python. Same API surface: `openai.images.generate()`, same parameters (`model`, `prompt`, `size`, `quality`, `style`), same return type. No functional limitations in either SDK. (Source: OpenAI documentation, npm/pypi package comparison)

### Image Processing (Node.js)

- **Sharp** (libvips): Fastest Node.js image library. Resize, crop, format conversion. No text API.
- **@napi-rs/canvas** (Skia, Rust): Canvas 2D API with TTF font loading, `fillText`, `measureText`. Pillow-equivalent quality. Requires manual word-wrapping (~20 lines) vs Pillow's built-in `multiline_text()`.
- Combined approach (Sharp for I/O + @napi-rs/canvas for compositing) is the established Node.js pattern for server-side image generation.

### LangGraph

Not needed for this pipeline. The pipeline is deterministic: `parse → resolve → build → generate → overlay → organize`. There's no LLM reasoning loop, no branching logic, no memory. Direct function composition is cleaner and faster. LangGraph JS (`@langchain/langgraph` v1.2.8) is available if a V2 learning loop is added.

### GenAI Pipeline Best Practices (2025-2026)

Production GenAI creative pipelines (Adobe, Canva, Meta) are **deterministic pipelines with one AI call sandwiched between traditional code** — not agentic systems. The architecture pattern is: input normalization → prompt construction → model API call → post-processing → output. This is exactly what AdSpark implements.

The best-practice full-stack pattern for AI apps with React frontends in 2025-2026 is: **Next.js + direct SDK calls** (not LangChain, not Vercel AI SDK for image generation).

### Vercel Deployment Viability

| Constraint | Vercel Hobby | AdSpark Need | Verdict |
|-----------|-------------|-------------|---------|
| Function timeout | 60s | ~20s (parallel DALL-E) | OK |
| Function memory | 1024 MB | Sharp + Canvas ~200-400 MB | OK |
| `/tmp` storage | 512 MB | Ephemeral image buffer | OK |
| Bandwidth | 100 GB/mo | Images served from S3 CDN | OK |

## Architecture

### Module Mapping

```
Next.js Full-Stack (Single Codebase)
─────────────────────────────────────
app/                           # Next.js App Router
  page.tsx                     # Dashboard: brief form + creative gallery + D3 charts
  api/generate/route.ts        # POST — runs pipeline, returns results
  api/upload/route.ts          # POST — pre-signed S3 URL for asset upload
  api/campaigns/[id]/route.ts  # GET — fetch campaign results

lib/pipeline/                  # Core pipeline logic (pure TypeScript, no framework deps)
  briefParser.ts               # JSON parsing + Zod schema validation
  assetResolver.ts             # S3/local lookup, route to DALL-E if missing
  promptBuilder.ts             # *** THE STAR *** Template-based prompt construction
  imageGenerator.ts            # DALL-E 3 API, parallel generation, retry logic
  textOverlay.ts               # @napi-rs/canvas text compositing
  outputOrganizer.ts           # S3 upload or local filesystem save
  pipeline.ts                  # Orchestrator: compose all steps, manage state
  types.ts                     # Domain types (CampaignBrief, Product, Creative, etc.)

lib/storage/                   # Storage abstraction
  index.ts                     # Factory: S3Storage | LocalStorage based on env
  s3Storage.ts                 # AWS S3 implementation (pre-signed URLs)
  localStorage.ts              # Filesystem fallback for local dev

components/                    # React UI components
  BriefForm.tsx                # Campaign brief input form + asset upload
  CreativeGallery.tsx          # Generated creative display grid
  PipelineProgress.tsx         # Real-time generation progress
  D3Charts.tsx                 # Pipeline metrics visualization

__tests__/                     # Test files
  briefParser.test.ts
  promptBuilder.test.ts
  pipeline.test.ts
```

### Clean Architecture Boundaries

```
React UI (components/) → API Routes (app/api/) → Pipeline Orchestrator (lib/pipeline/) ← Storage (lib/storage/)
```

- `lib/pipeline/` has ZERO framework dependencies. No Next.js imports, no React, no AWS SDK.
- `lib/storage/` implements the storage interface defined by the pipeline. Domain defines the contract; infrastructure fulfills it.
- API routes are thin — parse request, call pipeline, return response. No business logic.
- React components consume API responses. No direct pipeline calls from the frontend.

### PocketDev Pattern Reuse

This architecture shares structural DNA with Kevin's PocketDev project (natural language → deployed web app):

| Pattern | PocketDev | AdSpark |
|---------|-----------|---------|
| Input | Natural language prompt | Campaign brief JSON |
| Orchestration | LangGraph (non-deterministic) | Direct function composition (deterministic) |
| Generation | Container deployment | Image generation + compositing |
| Frontend | React UI | React + D3 dashboard |
| Output | Deployed web app | Generated ad creatives |
| Storage | Containerized artifacts | S3 images + manifest |

The key difference: PocketDev required LangGraph because LLM reasoning paths branch non-deterministically. AdSpark's pipeline is linear and predictable — every input produces a deterministic sequence of operations. This is WHY we don't use LangGraph here, and being able to articulate that distinction demonstrates architectural maturity.

## Consequences

### Positive
- Directly demonstrates the JD-preferred stack (React/Next.js)
- Hosted demo URL — reviewer clicks and sees it working
- Single codebase, single deploy, single language
- D3 dashboard adds visual polish the competition won't have
- S3 integration shows production infrastructure awareness
- Architecture docs (orchestration, image-processing, deployment) provide interview defense depth

### Negative
- ~2-3 hours more build time than Python CLI
- Image processing requires two libraries (Sharp + @napi-rs/canvas) instead of one (Pillow)
- Vercel free tier constraints require parallel DALL-E calls (solved, but worth noting)

### Risks
- **Timeline pressure.** Mitigation: checkpoint approach — pipeline logic alone is shippable at any point. Dashboard, D3, S3 are additive layers.
- **Unfamiliar libraries.** Sharp and @napi-rs/canvas are new to Kevin. Mitigation: well-documented APIs, and the agent team has researched implementation patterns.
- **Vercel cold starts.** First request after inactivity may take 5-10s. Mitigation: acceptable for POC, document as known limitation.

## References

- Assessment brief: `knowledge-base/01-assessment/assessment-brief.md`
- JD preferred stack: React.js, Next.js, Angular (from job description)
- Jim Wilson FAQ: *"You may use any third-party tools available to you"*
- Quinn Frampton: *"Interested in HOW he got the AI to do it — show us where the prompt is generated"*
- Architecture docs: `docs/architecture/orchestration.md`, `docs/architecture/image-processing.md`, `docs/architecture/deployment.md`
- Research: LangGraph JS SDK at parity (v1.2.8), OpenAI Node SDK at parity, @napi-rs/canvas closes Pillow gap
