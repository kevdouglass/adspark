# AdSpark — Ticket Plan

> Decomposition of the AdSpark assessment into prioritized epics, stories, and tasks.
> Ordered by business impact × evaluation criteria weight.
> Prefix: `ADS-XXX` (no Jira — tracked in ACTION-TRACKER.md)

---

## Priority Framework

| Factor | Weight | Source |
|--------|:------:|--------|
| Prompt engineering quality | 30% | Quinn: "Show us where the prompt is generated" (eval criterion #1) |
| Working end-to-end demo | 25% | "Does the pipeline actually run?" (eval criterion #4) |
| Architecture cleanliness | 20% | "Can someone understand it reading for the first time?" (eval criterion #2) |
| Self-awareness / trade-offs | 10% | Jim: "We value self-critique" (eval criterion #3) |
| README / documentation | 10% | How to run, design decisions, limitations (eval criterion #5) |
| Bonus features | 5% | Brand compliance, legal checks, logging (nice-to-have) |

## Business Impact Drivers (from business-context.html)

| # | Driver | Impact | Maps To |
|:-:|--------|--------|---------|
| 1 | **Campaign Velocity** | 4-8 weeks → 45 seconds | Working pipeline demo |
| 2 | **Scale Without Cost** | 6 → 7,200 assets via config | Pipeline parallelism + brief schema |
| 3 | **Brand Safety** | Nothing embarrassing goes live | Prompt quality + compliance checks |
| 4 | **Actionable Insights** | Track what was generated, timing, reuse | Logging + D3 dashboard |

---

## Epics

| Epic | Title | Priority | Business Driver |
|------|-------|:--------:|:---------------:|
| **E1** | Core Pipeline | P0 | #1 Velocity, #2 Scale |
| **E2** | React Dashboard | P1 | #4 Insights, Demo impressiveness |
| **E3** | Cloud Infrastructure | P1 | #2 Scale, Reviewer access |
| **E4** | Quality & Testing | P1 | #3 Brand Safety, Self-critique |
| **E5** | Documentation & Submission | P0 | All drivers |
| **E6** | Bonus: Compliance & Intelligence | P2 | #3 Brand Safety |

---

## E1: Core Pipeline (P0 — Must Ship)

> **Why P0:** Without the pipeline, there is no demo. Quinn evaluates the prompt builder first.
> This epic directly proves "brief in, 6 campaign-ready assets out, 45 seconds."

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-001 | Implement DALL-E 3 image generator with parallel execution | Story | P0 | 45 min | — | TODO |
| ADS-002 | Implement text overlay compositing with @napi-rs/canvas | Story | P0 | 30 min | — | TODO |
| ADS-003 | Implement output organizer with manifest generation | Story | P0 | 20 min | ADS-001, ADS-002 | TODO |
| ADS-004 | Wire pipeline orchestrator (compose all steps end-to-end) | Story | P0 | 30 min | ADS-001, ADS-002, ADS-003 | TODO |
| ADS-005 | Connect API route POST /api/generate to pipeline | Story | P0 | 15 min | ADS-004 | TODO |

### ADS-001: Implement DALL-E 3 Image Generator
**As a** pipeline, **I need to** call DALL-E 3 API for each product × aspect ratio combination in parallel, **so that** 6 images are generated in ~20 seconds (not 120 sequential).

**Acceptance Criteria:**
- [ ] Calls `openai.images.generate()` with correct size param per aspect ratio
- [ ] Uses `p-limit` to cap concurrency at 5 (respects OpenAI Tier 1 rate limit)
- [ ] Retry with exponential backoff on 429/500 (max 3 attempts)
- [ ] No retry on 400 content policy rejection — surface as `PipelineError`
- [ ] Downloads image from URL to Buffer
- [ ] Returns `GeneratedImage[]` with timing metadata
- [ ] Handles partial failure: 5/6 succeed → return 5 + error for the 1

**Sub-tasks:**
- [ ] ADS-001a: OpenAI client setup (API key from env)
- [ ] ADS-001b: `withRetry()` utility function
- [ ] ADS-001c: `generateImage()` single-image function
- [ ] ADS-001d: `generateImages()` batch with p-limit
- [ ] ADS-001e: Integration test with mocked OpenAI responses

---

### ADS-002: Implement Text Overlay Compositing
**As a** pipeline, **I need to** overlay the campaign message onto each generated image using @napi-rs/canvas, **so that** final creatives are ready to post without manual editing.

**Acceptance Criteria:**
- [ ] Creates canvas at target dimensions, draws base image
- [ ] Renders semi-transparent black band in bottom 25%
- [ ] Word-wraps campaign message to max 3 lines
- [ ] Font size scales to image width (`width / 20`)
- [ ] Text is white, centered, with 5% padding
- [ ] Outputs PNG Buffer
- [ ] Handles edge cases: very short message (1 word), max length (140 chars)

**Sub-tasks:**
- [ ] ADS-002a: `wrapText()` utility (Canvas measureText + line break)
- [ ] ADS-002b: `overlayText()` main function
- [ ] ADS-002c: Sharp resize from DALL-E dimensions to target platform dimensions
- [ ] ADS-002d: Visual test — generate overlay on a test image, verify manually

---

### ADS-003: Implement Output Organizer
**As a** pipeline, **I need to** save creatives + thumbnails to storage with proper folder structure and manifest, **so that** output is organized, traceable, and reviewer-friendly.

**Acceptance Criteria:**
- [ ] Saves to `{campaignId}/{productSlug}/{ratio}/creative.png` using `ASPECT_RATIO_FOLDER` mapping
- [ ] Generates WebP thumbnail at 400px width via Sharp
- [ ] Creates `manifest.json` with paths, prompts, timing metadata
- [ ] Uses `StorageProvider` interface (works for both local + S3)
- [ ] Returns `CreativeOutput[]` with all paths/URLs populated

**Sub-tasks:**
- [ ] ADS-003a: Thumbnail generation (Sharp resize + WebP)
- [ ] ADS-003b: Manifest JSON structure + write
- [ ] ADS-003c: `organizeOutput()` main function

---

### ADS-004: Wire Pipeline Orchestrator
**As a** pipeline, **I need to** compose all steps into a single `runPipeline()` function that takes a brief and produces organized output, **so that** the API route has one clean function to call.

**Acceptance Criteria:**
- [ ] Validates brief (via `parseBrief`)
- [ ] Resolves assets (via `resolveAssets`)
- [ ] Builds generation tasks (via `buildGenerationTasks`)
- [ ] Generates images in parallel (via `generateImages`)
- [ ] Overlays text on each image (via `overlayText`)
- [ ] Organizes output (via `organizeOutput`)
- [ ] Returns `PipelineResult` with all creatives, timing, and errors
- [ ] Handles partial failure — returns what succeeded + error details

**Sub-tasks:**
- [ ] ADS-004a: Implement `runPipeline()` in `lib/pipeline/pipeline.ts`
- [ ] ADS-004b: Add progress tracking (PipelineProgress state transitions)
- [ ] ADS-004c: Integration test with fully mocked dependencies

---

### ADS-005: Connect API Route to Pipeline
**As a** user, **I need to** POST a campaign brief to `/api/generate` and get back creative URLs, **so that** the dashboard can trigger generation and display results.

**Acceptance Criteria:**
- [ ] Reads `OPENAI_API_KEY` from env, fails fast if missing
- [ ] Creates storage via `createStorage()`
- [ ] Calls `runPipeline(brief, storage, apiKey)`
- [ ] Returns `PipelineResult` as JSON (200 on success, 400 on validation, 500 on internal)
- [ ] Total response time under 60 seconds (Vercel Hobby limit)

**Sub-tasks:**
- [ ] ADS-005a: Env validation at route handler entry
- [ ] ADS-005b: Wire storage + pipeline
- [ ] ADS-005c: E2E test: POST brief → verify 200 + creative paths in response

---

## E2: React Dashboard (P1 — Makes Demo Impressive)

> **Why P1:** The hosted dashboard is what makes this submission stand out vs competitors
> who submit a CLI. Evaluators click a URL instead of cloning a repo.

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-006 | BriefForm component — campaign brief input + validation | Story | P1 | 45 min | ADS-005 | TODO |
| ADS-007 | CreativeGallery component — display generated creatives | Story | P1 | 30 min | ADS-005 | TODO |
| ADS-008 | PipelineProgress component — real-time generation status | Story | P1 | 30 min | ADS-005 | TODO |
| ADS-009 | D3.js pipeline metrics charts | Story | P2 | 45 min | ADS-005 | TODO |

### ADS-006: BriefForm Component
**Acceptance Criteria:**
- [ ] Form fields: campaign name, message, region, audience, tone, season (dropdown)
- [ ] Product fields: name, slug (auto-generated), description, category, key features (tag input), color (color picker), existing asset (file upload)
- [ ] Add/remove products (min 1, default 2)
- [ ] Aspect ratio checkboxes (default all 3 selected)
- [ ] Client-side Zod validation with inline error messages
- [ ] Submit → POST to /api/generate
- [ ] `"use client"` directive — this is a Client Component

### ADS-007: CreativeGallery Component
**Acceptance Criteria:**
- [ ] Displays generated creatives in a responsive grid
- [ ] Group by product, then by aspect ratio
- [ ] Click to enlarge (modal/lightbox)
- [ ] Show prompt used for each creative (expandable)
- [ ] Download individual creative (PNG)
- [ ] Show generation time per image
- [ ] `"use client"` directive

### ADS-008: PipelineProgress Component
**Acceptance Criteria:**
- [ ] Shows current pipeline stage (Validating → Generating → Compositing → Organizing → Complete)
- [ ] Per-image progress (X of 6 generated)
- [ ] Error display for partial failures
- [ ] Elapsed time counter
- [ ] `"use client"` directive

### ADS-009: D3.js Pipeline Metrics
**Acceptance Criteria:**
- [ ] Bar chart: generation time per image (product × ratio)
- [ ] Pie chart: time breakdown by pipeline stage
- [ ] Summary stats: total time, images generated, images reused
- [ ] `"use client"` directive, `useRef` + `useEffect` for D3 bindings
- [ ] Responsive — resizes with viewport

---

## E3: Cloud Infrastructure (P1 — Enables Hosted Demo)

> **Why P1:** A Vercel URL that evaluators can click beats "clone + install + API key" every time.

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-010 | Implement S3Storage provider | Story | P1 | 30 min | ADS-003 | TODO |
| ADS-011 | Implement file-serving API route for local storage mode | Story | P1 | 15 min | ADS-003 | TODO |
| ADS-012 | Deploy to Vercel + configure env vars | Story | P1 | 20 min | ADS-005 | TODO |
| ADS-013 | Asset upload via pre-signed S3 URLs | Story | P2 | 30 min | ADS-010 | TODO |

### ADS-010: S3Storage Provider
**Acceptance Criteria:**
- [ ] Implements `StorageProvider` interface using `@aws-sdk/client-s3`
- [ ] `save()`: PutObjectCommand with correct content type
- [ ] `exists()`: HeadObjectCommand
- [ ] `load()`: GetObjectCommand → Buffer
- [ ] `getUrl()`: Pre-signed GET URL (24hr TTL) via `@aws-sdk/s3-request-presigner`
- [ ] Error handling: clear messages for permission/bucket-not-found errors

### ADS-011: File-Serving API Route (Local Mode)
**Acceptance Criteria:**
- [ ] GET `/api/files/[key]` serves files from local output directory
- [ ] Uses `safePath()` pattern (path traversal protection)
- [ ] Sets correct `Content-Type` headers (image/png, image/webp)
- [ ] Returns 404 for missing files

### ADS-012: Vercel Deployment
**Acceptance Criteria:**
- [ ] `vercel deploy --prod` succeeds
- [ ] Env vars configured (OPENAI_API_KEY, S3 credentials)
- [ ] Build passes on Vercel (no native module issues with Sharp/@napi-rs/canvas)
- [ ] Homepage loads at production URL
- [ ] API route responds to POST /api/generate

---

## E4: Quality & Testing (P1 — Interview Defense)

> **Why P1:** Jim said "we value engineers who evaluate their own solutions critically."
> Tests + self-critique are part of the evaluation.

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-014 | Unit tests for briefParser | Story | P1 | 20 min | — | TODO |
| ADS-015 | Unit tests for promptBuilder | Story | P0 | 30 min | — | TODO |
| ADS-016 | Integration test for pipeline orchestrator | Story | P1 | 30 min | ADS-004 | TODO |
| ADS-017 | Vitest configuration + test runner setup | Task | P1 | 10 min | — | TODO |

### ADS-015: Unit Tests for Prompt Builder (P0)
> Elevated to P0 because the prompt builder is the #1 evaluated component.
> Tests prove the template system works and all brief fields are injected.

**Acceptance Criteria:**
- [ ] Test: prompt contains product name, description, key features, color
- [ ] Test: prompt contains audience, region, tone, seasonal mood
- [ ] Test: aspect-ratio-specific composition guidance is injected (3 different prompts for 1:1, 9:16, 16:9)
- [ ] Test: lifestyle category gets "people may appear" language
- [ ] Test: non-lifestyle category gets "no human faces" language
- [ ] Test: `buildGenerationTasks` produces 6 tasks for 2 products × 3 ratios
- [ ] Test: each task has unique prompt (no duplicates)
- [ ] Test: unknown season (if bypassing Zod) falls back to DEFAULT_MOOD

---

## E5: Documentation & Submission (P0 — Deliverables)

> **Why P0:** Without README and demo video, the assessment is incomplete.
> README quality is evaluation criterion #5.

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-018 | README.md — architecture, how to run, design decisions, limitations | Story | P0 | 30 min | ADS-004 | TODO |
| ADS-019 | Record 2-3 min Loom demo video | Task | P0 | 20 min | ADS-018 | TODO |
| ADS-020 | Submit to Jim Wilson — GitHub + Loom + availability | Task | P0 | 5 min | ADS-019 | TODO |

### ADS-018: README.md
**Acceptance Criteria:**
- [ ] Architecture diagram (pipeline flow)
- [ ] How to run locally (3 commands: clone, install, dev)
- [ ] How to run with Docker (if time)
- [ ] Example input (campaign brief JSON) + example output (screenshots)
- [ ] Key design decisions with WHY (reference ADR-001)
- [ ] Known limitations & future improvements (self-critique section)
- [ ] Success metrics: "Generates 6 creatives in ~30 seconds"
- [ ] Production considerations section
- [ ] Framed as "client deliverable" not "homework"

---

## E6: Bonus — Compliance & Intelligence (P2 — If Time Allows)

> **Why P2:** "Nice-to-have" in the assessment brief, but business-context.html says
> "enterprise clients pay premium for brand safety." Even a simple implementation signals awareness.

| Ticket | Title | Type | Priority | Estimate | Depends On | Status |
|--------|-------|------|:--------:|:--------:|:----------:|:------:|
| ADS-021 | Prohibited word filter (legal compliance check) | Story | P2 | 20 min | ADS-004 | TODO |
| ADS-022 | Brand color validation (compare generated vs brief) | Story | P2 | 30 min | ADS-003 | TODO |
| ADS-023 | Pipeline execution logging + JSON report | Story | P2 | 20 min | ADS-004 | TODO |
| ADS-024 | Company brand triage agent (multi-tenant brand context) | Spike | P2 | TBD | ADS-004 | TODO |

---

## Implementation Order (Impact × Priority)

```
Phase 1 — "Make It Work" (P0, ~2.5 hrs)
──────────────────────────────────────────
  ADS-017  Vitest setup                              10 min
  ADS-001  DALL-E 3 image generator (parallel)       45 min
  ADS-002  Text overlay (@napi-rs/canvas)            30 min
  ADS-003  Output organizer + manifest               20 min
  ADS-004  Pipeline orchestrator (wire everything)   30 min
  ADS-005  API route → pipeline connection           15 min
                                          Checkpoint: pipeline works E2E

Phase 2 — "Make It Impressive" (P1, ~2.5 hrs)
──────────────────────────────────────────────
  ADS-015  Prompt builder tests (P0 — most important tests)  30 min
  ADS-006  BriefForm component                       45 min
  ADS-007  CreativeGallery component                 30 min
  ADS-008  PipelineProgress component                30 min
  ADS-011  Local file-serving route                  15 min
                                          Checkpoint: dashboard works

Phase 3 — "Make It Shippable" (P0+P1, ~1.5 hrs)
─────────────────────────────────────────────────
  ADS-014  Brief parser tests                        20 min
  ADS-010  S3Storage provider                        30 min
  ADS-012  Vercel deployment                         20 min
  ADS-018  README.md                                 30 min
                                          Checkpoint: deployed + documented

Phase 4 — "Ship It" (P0, ~25 min)
──────────────────────────────────
  ADS-019  Loom demo video                           20 min
  ADS-020  Submit to Jim Wilson                       5 min
                                          ✓ SUBMITTED

Phase 5 — "Bonus Points" (P2, if time allows)
──────────────────────────────────────────────
  ADS-009  D3.js charts                              45 min
  ADS-016  Pipeline integration test                 30 min
  ADS-021  Prohibited word filter                    20 min
  ADS-023  Pipeline execution logging                20 min
  ADS-013  Asset upload (pre-signed S3)              30 min
  ADS-022  Brand color validation                    30 min
  ADS-024  Company brand triage agent                TBD
```

---

## Dependency Graph

```
ADS-017 (Vitest setup)
    │
    ├── ADS-015 (Prompt builder tests)
    └── ADS-014 (Brief parser tests)

ADS-001 (Image generator)──┐
ADS-002 (Text overlay)─────┤
ADS-003 (Output organizer)─┼── ADS-004 (Pipeline orchestrator)
                            │       │
                            │       ├── ADS-005 (API route)
                            │       │       │
                            │       │       ├── ADS-006 (BriefForm)
                            │       │       ├── ADS-007 (Gallery)
                            │       │       ├── ADS-008 (Progress)
                            │       │       └── ADS-009 (D3 charts)
                            │       │
                            │       ├── ADS-016 (Integration test)
                            │       ├── ADS-018 (README)
                            │       │       └── ADS-019 (Video)
                            │       │               └── ADS-020 (Submit)
                            │       │
                            │       ├── ADS-021 (Prohibited words)
                            │       └── ADS-023 (Logging)
                            │
                            ├── ADS-010 (S3Storage)
                            │       ├── ADS-012 (Deploy)
                            │       └── ADS-013 (Upload)
                            │
                            ├── ADS-011 (File serving)
                            └── ADS-022 (Brand color check)
```

---

## Decision: Jira vs ACTION-TRACKER

**For this assessment: ACTION-TRACKER.md is sufficient.** Reasons:

1. **Solo developer, 24-hour window** — Jira overhead (project setup, board config, workflow states) costs 30+ minutes with zero return for a one-person sprint.
2. **Tickets are small** — most are 15-45 minute tasks. Jira is designed for multi-day stories across teams.
3. **ACTION-TRACKER is already integrated** — agents read it, update it, and `/sync-tracker` keeps it current.
4. **The ticket plan lives here** (`docs/TICKET-PLAN.md`) as the durable reference. ACTION-TRACKER tracks execution status.

If this were a real engagement (multi-week, multi-person), Jira would be the right tool. For a take-home assessment, it's overhead.

---

## Gap Analysis Amendments

> Generated by 3 specialist agents (Pipeline, Frontend, Orchestration) reviewing
> every ticket's description and acceptance criteria. 25 gaps found, prioritized below.
> Amendments are patches to existing tickets — not new tickets unless noted.

### Critical / High Gaps (Must Address)

#### GAP-1: Native module build risk on Vercel (ADS-012) — CRITICAL
**Source:** Pipeline + Orchestration agents (cross-agent consensus)
**Problem:** Sharp and @napi-rs/canvas use native C++ bindings. Vercel serverless bundles only traced files — native `.node` binaries are silently excluded unless explicitly configured. This is the #1 Vercel deploy failure for image processing stacks.
**Patch ADS-012 AC:**
- [ ] Add `outputFileTracingIncludes` in `next.config.ts` for Sharp + @napi-rs/canvas `.node` files
- [ ] Verify Sharp is in `dependencies` (not `devDependencies`)
- [ ] Confirm @napi-rs/canvas has a Vercel-compatible prebuilt binary for `linux-x64-gnu`
- [ ] Run `next build` locally and verify no "Module not found" errors in function traces
- [ ] Smoke test: deploy to Vercel preview → POST /api/generate → verify image generation works

#### GAP-2: S3 CORS blocks browser access (ADS-010) — HIGH
**Source:** Orchestration agent
**Problem:** Dashboard on Vercel domain fetches pre-signed S3 URLs for images. Without bucket CORS config, browser blocks the response.
**Patch ADS-010 AC:**
- [ ] Configure S3 bucket CORS: allow GET from `NEXT_PUBLIC_APP_URL` origin
- [ ] Add `aws s3api put-bucket-cors` step to ADS-012 deploy checklist
- [ ] Test: open generated creative URL in browser → image loads (no CORS error)

#### GAP-3: resolveAssets step not ticketed (ADS-004) — CRITICAL
**Source:** Pipeline agent
**Problem:** `resolveAssets()` is already implemented but ADS-004 orchestrator doesn't have a sub-task to wire it. Skipping breaks the "reuse existing assets" requirement.
**Patch ADS-004 sub-tasks:**
- [ ] ADS-004d: Wire `resolveAssets()` into pipeline — check existing assets before generating, skip DALL-E for resolved products

#### GAP-4: No accessibility ACs on frontend tickets (ADS-006 through ADS-009) — HIGH
**Source:** Frontend agent
**Patch ALL frontend ticket ACs:**
- [ ] All form inputs have `aria-label` or visible `<label>`
- [ ] Gallery modal has `role="dialog"` + focus trap + Escape to close
- [ ] Progress component has `role="status"` + `aria-live="polite"`
- [ ] Touch targets minimum 44px on mobile
- [ ] Keyboard navigation: Tab through form, Enter to submit, Escape to cancel

#### GAP-5: No loading/error state coordination (ADS-006, ADS-007, ADS-008) — HIGH
**Source:** Frontend agent
**Problem:** Gallery renders empty grid during generation. No shared state contract between BriefForm (submit), PipelineProgress (status), and CreativeGallery (results).
**New sub-task:**
- [ ] ADS-025: Create `usePipelineState()` hook — shared state for pending/generating/complete/error across all dashboard components

### Medium Gaps (Should Address)

| # | Gap | Ticket | Patch |
|:-:|-----|--------|-------|
| 6 | DALL-E request timeout not capped — hanging socket blocks 60s budget | ADS-001b | Add AC: wrap API call with `AbortSignal.timeout(30_000)` |
| 7 | Pipeline timeout budget not tracked end-to-end | ADS-004 | Add AC: if elapsed > 40s after GENERATING, skip retries, return partial |
| 8 | `submitted` state missing from `PipelineStage` type | ADS-004b | Add `submitted` to union, emit as first progress event |
| 9 | `brief.json` not saved alongside `manifest.json` | ADS-003 | Add AC: save input brief to campaign root for reproducibility |
| 10 | Rate limit arithmetic untested for Tier 1 accounts | ADS-001 | Add AC: mock test verifying 6-image batch handles 429 backoff correctly |
| 11 | Env var validation is scattered — no startup guard | ADS-005 | Add AC: `validateEnv()` with Zod at route entry, fail fast with clear message |
| 12 | No consistent error response shape across routes | ADS-005 | Add AC: define `ApiError` type `{ code, message, details? }`, use in all routes |
| 13 | S3 IAM policy scope not specified | ADS-010 | Add AC: minimum permissions `s3:PutObject/GetObject/HeadObject` on `adspark-*/*` only |
| 14 | Zod errors not surfaced inline in form | ADS-006 | Add AC: field-level error messages below each input, submit disabled while invalid |
| 15 | Double-submit prevention missing | ADS-006 | Add AC: submit button disabled + spinner during pending, prevent concurrent requests |
| 16 | D3 cleanup on unmount + SSR prevention | ADS-009 | Add AC: `useEffect` cleanup removes D3 selections; `dynamic(import, { ssr: false })` wrapper |
| 17 | ADS-016 (integration test) deferred too late | ADS-016 | Move from Phase 5 → Phase 3, after ADS-004 but before ADS-012 |
| 18 | Prompt safety validation untested | ADS-015 | Add AC: test prompts do NOT contain prohibited patterns (brand names, "clinically proven") |

### Low Gaps (Nice to Have)

| # | Gap | Ticket | Patch |
|:-:|-----|--------|-------|
| 19 | Mobile responsive breakpoints not specified | ADS-006, ADS-007 | Add AC: 1-col on <640px, form single-column mobile |
| 20 | Toast/notification system for downloads + errors | ADS-007 | Add chore: install `sonner` toast provider |
| 21 | D3 ResizeObserver leak on viewport change | ADS-009 | Add AC: disconnect ResizeObserver in useEffect cleanup |
| 22 | CORS middleware for cross-origin POC deployments | ADS-012 | Add AC: configure headers in next.config.ts for /api/* |
| 23 | `/api/upload` route not linked to any ticket | ADS-013 | Add sub-task ADS-013a: implement POST /api/upload |
| 24 | Content policy prompt auditing | ADS-015 | Add negative test cases for DALL-E trigger patterns |
| 25 | `readEnvConfig()` missing `localUrlBase` mapping | ADS-010 | One-line fix: add to returned config object |

### New Tickets from Gap Analysis

| Ticket | Title | Type | Priority | Epic |
|--------|-------|------|:--------:|:----:|
| ADS-025 | Create `usePipelineState()` shared hook for dashboard state coordination | Story | P1 | E2 |

### Updated Implementation Order

Gap analysis moved ADS-016 earlier and added ADS-025:

```
Phase 1 — "Make It Work" (unchanged)
  ADS-017 → ADS-001 → ADS-002 → ADS-003 → ADS-004 → ADS-005

Phase 2 — "Make It Impressive" (ADS-025 added)
  ADS-015 → ADS-025 → ADS-006 → ADS-007 → ADS-008 → ADS-011

Phase 3 — "Make It Shippable" (ADS-016 moved here)
  ADS-014 → ADS-016 → ADS-010 → ADS-012 → ADS-018

Phase 4 — "Ship It" (unchanged)
  ADS-019 → ADS-020

Phase 5 — "Bonus Points" (unchanged)
  ADS-009 → ADS-021 → ADS-023 → ADS-013 → ADS-022 → ADS-024
```

---

## Integration Layer Analysis

> Audit of how each layer connects to the next. Identifies missing glue code,
> shared contracts, and clarifies why MCP is NOT the right pattern here.

### System Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                                 │
│                                                                         │
│  BriefForm ──┐                                                          │
│              │  lib/api/client.ts  (ADS-026)                            │
│              ├──── POST /api/generate ──────── fetch() ─────┐           │
│              │     POST /api/upload   ──────── fetch() ─────┤           │
│  Gallery ◄───┤     GET  /api/campaigns/:id ── fetch() ─────┤           │
│  Progress ◄──┘                                              │           │
│  D3Charts ◄──── reads PipelineResult                        │           │
│                                                              │           │
│  Shared state: usePipelineState() hook (ADS-025)            │           │
│  Shared types: lib/api/types.ts (ADS-027)                   │           │
└──────────────────────────────────────────────────────────────┼───────────┘
                                                               │
                          NETWORK BOUNDARY (fetch / JSON)       │
                                                               │
┌──────────────────────────────────────────────────────────────┼───────────┐
│                       BACKEND (Next.js API Routes)           │           │
│                                                              ▼           │
│  app/api/generate/route.ts ──── validates env ──┐                       │
│  app/api/upload/route.ts   ──── validates env ──┤                       │
│  app/api/campaigns/route.ts ─── validates env ──┤                       │
│  app/api/files/[key]/route.ts ── serves local ──┘                       │
│                                       │                                  │
│              createStorage() ─────────┤                                  │
│              runPipeline()  ──────────┤                                  │
│                                       │                                  │
└───────────────────────────────────────┼──────────────────────────────────┘
                                        │
                          FUNCTION CALLS (direct SDK, NOT MCP)
                                        │
┌───────────────────────────────────────┼──────────────────────────────────┐
│                    EXTERNAL SERVICES   │                                  │
│                                        ▼                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  OpenAI API   │  │  AWS S3      │  │  Filesystem  │                   │
│  │  DALL-E 3     │  │  (prod)      │  │  (local dev) │                   │
│  │              │  │              │  │              │                   │
│  │  Called via:  │  │  Called via:  │  │  Called via:  │                   │
│  │  openai SDK   │  │  @aws-sdk    │  │  node:fs     │                   │
│  │  (direct)     │  │  (direct)    │  │  (direct)    │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
│                                                                          │
│  NOT MCP — these are deterministic SDK calls, not agent tool discovery   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why NOT MCP for This Pipeline

| Question | Answer |
|----------|--------|
| Does an LLM decide which tool to call? | **No** — the pipeline is hardcoded: parse → generate → overlay → save |
| Are tools discovered at runtime? | **No** — we import `openai` and `@aws-sdk` statically |
| Does the system reason about which API to use? | **No** — it always calls DALL-E 3, always saves to StorageProvider |
| Is there an agent loop? | **No** — it's a linear pipeline, not a reasoning loop |

MCP is for **AI agents that reason about tool selection**. Our pipeline is a **deterministic function composition** — the code knows exactly what to call at every step.

**Where MCP IS the right pattern (future):**
- **Brand Triage Agent** (ADS-024): An LLM agent that decides which data sources to query for brand extraction — website scraper MCP, social media MCP, DAM connector MCP. The agent reasons about which tools are relevant for each company.
- **Prompt Refinement Agent** (V2): An LLM that evaluates generated images against brand guidelines and decides whether to regenerate, adjust prompts, or approve.

### Missing Integration Tickets

Three integration gaps exist between the layers above:

#### ADS-026: Frontend API Client Layer (NEW)

**As a** frontend developer, **I need** a typed fetch wrapper for all API endpoints, **so that** components don't duplicate fetch logic, error handling, or type parsing.

**Why this is missing:** ADS-006 says "Submit → POST to /api/generate" but doesn't specify HOW. Each component would independently write `fetch('/api/generate', ...)` with duplicated error handling, no shared types, and inconsistent timeout handling.

**Acceptance Criteria:**
- [ ] `lib/api/client.ts` exports typed functions:
  - `generateCreatives(brief: CampaignBriefInput): Promise<PipelineResult>`
  - `uploadAsset(file: File, campaignId: string): Promise<{ url: string }>`
  - `getCampaign(id: string): Promise<PipelineResult>`
- [ ] Shared error handling: network errors, 400 validation errors, 500 server errors all produce typed `ApiError` objects
- [ ] Request timeout: `AbortSignal.timeout(55_000)` on generate (leaves 5s buffer vs Vercel 60s)
- [ ] No duplicate fetch logic in components — all API calls go through this client
- [ ] Content-Type headers set correctly (JSON for briefs, multipart for file upload)

**Sub-tasks:**
- [ ] ADS-026a: Define `ApiError` type and error parsing utility
- [ ] ADS-026b: `generateCreatives()` — POST /api/generate with typed request/response
- [ ] ADS-026c: `uploadAsset()` — POST /api/upload with File handling
- [ ] ADS-026d: `getCampaign()` — GET /api/campaigns/[id]

---

#### ADS-027: Shared API Contract Types (NEW)

**As a** developer, **I need** a single source of truth for request/response shapes shared between frontend and backend, **so that** the API contract doesn't drift between what the route returns and what the component expects.

**Why this is missing:** `PipelineResult` lives in `lib/pipeline/types.ts` (domain layer). The frontend needs to consume this type, but importing from the pipeline layer creates a dependency direction violation (UI → Domain is fine, but the import path should be explicit).

**Acceptance Criteria:**
- [ ] `lib/api/types.ts` exports:
  - `GenerateRequest` — the JSON body POSTed to /api/generate (matches `CampaignBrief` but without internal-only fields)
  - `GenerateResponse` — the JSON returned by /api/generate (matches `PipelineResult` serialized)
  - `ApiError` — `{ code: string; message: string; details?: string[] }`
  - `UploadResponse` — `{ uploadUrl: string; key: string }`
  - `CampaignResponse` — same as `GenerateResponse` (retrieved by ID)
- [ ] Backend API routes use these types for response serialization
- [ ] Frontend API client uses these types for response parsing
- [ ] Zod schemas exist for response validation on the frontend (defensive parsing)
- [ ] No `any` casts — full type safety from route handler → JSON → client → component

---

#### ADS-028: Backend Dependency Injection / Service Setup (NEW)

**As a** backend developer, **I need** a clean way to construct pipeline dependencies (OpenAI client, storage provider) once per request, **so that** API routes don't duplicate setup logic and dependencies are testable.

**Why this is missing:** ADS-005 says "reads OPENAI_API_KEY from env" and "creates storage via createStorage()" but doesn't specify where this lives. If each route creates its own OpenAI client and storage provider, that's duplicated initialization. If env validation happens per-route, it's scattered.

**Acceptance Criteria:**
- [ ] `lib/api/services.ts` exports:
  - `getOpenAIClient(): OpenAI` — creates client with validated API key, configured timeout
  - `getStorage(): StorageProvider` — creates storage via `createStorage()`
  - `validateRequiredEnv(): void` — Zod-validates all required env vars at once, throws descriptive error
- [ ] Called once at the top of each API route handler
- [ ] In tests: mock `getOpenAIClient()` and `getStorage()` to inject test doubles
- [ ] OpenAI client created with `timeout: 30_000` and `maxRetries: 0` (we handle retries ourselves in `withRetry`)

---

### Updated Dependency Graph (with integration tickets)

```
                                   ADS-027 (shared API types)
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                  ▼
              ADS-026            ADS-028             ADS-005
          (API client)       (service setup)     (API route wiring)
                │                  │                    │
                ▼                  ▼                    │
           ADS-025          ADS-004 (pipeline)         │
        (usePipelineState)        │                    │
                │                  │                    │
     ┌──────────┼──────────┐      │                    │
     ▼          ▼          ▼      ▼                    ▼
  ADS-006   ADS-007   ADS-008   ADS-001...003      (routes)
  (Form)    (Gallery) (Progress)  (pipeline impl)
```

### Updated Phase 2

```
Phase 2 — "Make It Impressive" (3 new tickets added)
  ADS-015  → ADS-027 → ADS-028 → ADS-026 → ADS-025
  → ADS-006 → ADS-007 → ADS-008 → ADS-011
```

ADS-027 (types) → ADS-028 (services) → ADS-026 (client) must come before any frontend component, because every component imports the API client which imports the shared types.
