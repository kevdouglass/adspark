# Interview Narrative Cheat-Sheet — AdSpark walkthrough

> **Purpose:** a single scannable document to read 30 minutes before the
> Microsoft Teams interview. It's organized in the order a walkthrough
> flows — opening hook, high-level architecture, deep dive on the star
> component, trade-offs, roadmap, and prepared answers to likely
> questions. Read top-to-bottom once; use as a reference during the call.
>
> **Role target:** Adobe Forward Deployed AI Engineer (Firefly team),
> via Conexess Group.
>
> **Not a script** — don't read it aloud verbatim. It's the structure
> to hang extemporaneous speech on, plus the specific technical details
> you'll want to cite confidently without hunting in the codebase.

---

## 0. The 60-second opening (practice this first)

> *"Hi, I'm Kevin. I'm going to walk you through AdSpark — a creative
> automation pipeline I built for the take-home. It takes a campaign
> brief in JSON and produces publish-ready ad creatives across the
> three social aspect ratios in about 30 seconds.*
>
> *The interesting parts for me were the prompt builder — which Adobe's
> brief specifically called out as the scrutiny point — the clean
> architecture separation between the pipeline domain and the storage
> infrastructure, and the trade-offs I had to make to ship something
> demo-safe inside the 48-hour window while still building a story for
> what I'd do post-MVP.*
>
> *I'm going to share my screen, show you the dashboard running locally,
> then drop into the code for the pieces that matter most. I'll pause
> whenever you want to ask questions. Ready?"*

**Key beats in 60 seconds:** my name → what the tool does → what I
optimized for → the three things I'll show → an invitation to interrupt.

---

## 0.1 Branch framing — three references on GitHub (optional opener)

Only say this if a reviewer asks about the repo structure, or if you
want to lead with engineering discipline before the product walkthrough.
Drops to ~45 seconds after the primary opener. See
`docs/branch-decision.html` for the full decision record.

> *"Three references on GitHub that matter for this walkthrough. There's
> a tag called `assessment-submission` pointing at commit `061f274` —
> that's the exact bit-perfect state I submitted, complete with the Loom
> walkthrough link and the demo scripts. `main` is that plus a cosmetic
> text-overlay rendering fix I pushed this week — the campaign-message
> band now gradients instead of flat-fills, and the glyphs have a subtle
> drop shadow. And `feat/interview-prep` is where I've been building
> post-submission feature work: the visible reuse story, the run summary
> panel, the D3 timing chart, the manual upload UI, plus a SPIKE doc and
> an INVESTIGATION for the upload work. I'm going to demo from
> `feat/interview-prep` because the visible reuse story is the strongest
> beat, but I can switch to any of the three — they're all the same
> underlying pipeline."*

**Three references, three distinct purposes:**

| Reference | What it is | Use when reviewer asks |
|---|---|---|
| **`assessment-submission`** (tag) | Exact 061f274 commit | *"show me the pristine submission"* |
| **`main`** (branch) | Submission + this week's overlay fix | *"show me current main"* |
| **`feat/interview-prep`** (branch) | Submission + overlay fix + Blocks B/C/D + SPIKE-003 + this narrative + decision doc | *"show me your best version"* (default) |

**If a reviewer pushes back on the 9-hour overtime window** between the
stated 15:44 PDT deadline and the `docs(submission):` commit at Monday
00:29 PDT:

> *"I kept polishing after the stated deadline — mostly infrastructure
> hardening, the Docker container, SPIKE-002 audit, and the Loom
> walkthrough link that gets reviewers from the GitHub landing page to
> the 2-minute video. The commit I labeled `docs(submission):` is where
> I declared done. The tag makes that declaration permanent and
> verifiable — if you check out `assessment-submission`, you get exactly
> that state, byte for byte."*

---

## 1. Live demo — the click path

### Before the call starts

1. `cd C:\dev\AI\Projects\Take-Home-Assessments\AdSpark`
2. Verify branch: `git rev-parse --abbrev-ref HEAD` — should be
   `feat/interview-prep` (or whichever branch has the latest)
3. Kill any existing dev servers: check `netstat -ano | grep :3000` and
   `taskkill //PID <pid> //F` if needed
4. Start fresh: `npm run dev` — wait for "Ready" message (~5 seconds)
5. Open **http://localhost:3000** in Chrome/Edge
6. Keep DevTools open (F12) → **Network tab** → you'll demo the
   client → server → pipeline trace via network logs
7. **Pre-baked fallback:** if DALL-E rate-limits or the network is
   flaky, your fallback is `examples/campaigns/coastal-sun-protection/`
   — point at the already-committed seed assets and explain "and here's
   a prior pipeline run showing the full output structure"

### The click path (3–4 minutes, start-to-finish)

**⭐ Demo path choice — lead with the STRUCTURED FORM, not natural language.**
Verified 2026-04-14: structured-form with `coastal-sun-protection` runs
in ~32 seconds and hits both the reuse and generation branches in a
single run. The natural-language path adds ~25 seconds of orchestrator
time AND produces a brief with `existingAsset: null` on every product
(so it misses the reuse story entirely). If the reviewer wants to see
the orchestrator specifically, do that as a SECOND demo after the
structured-form run has already landed the visible-reuse beat.

1. **Show the idle state.** "This is the dashboard. Empty on the left
   is the brief form; the right side hosts the progress UI, the
   timing chart, and the gallery once a run completes."
2. Click the **Demo Brief** dropdown → select **"Coastal Sun
   Protection — Summer 2026"**. The form pre-fills with 2 products,
   3 aspect ratios, and the SPF 50 product has `existingAsset` pointing
   at a committed seed asset.
3. Click **Generate Creatives**. The form disables, `PipelineProgress`
   shows each stage advancing: validating → resolving → generating →
   compositing → organizing → complete. Total wall time: ~25–45s.
4. **When the run finishes, point at three things in order:**
   - **RunSummaryPanel** at the top: "2 products, 6 creatives, **3
     reused, 3 generated**, 0 failed, status Complete." This is the
     single line that answers the assignment's 'reuse when available'
     requirement at a glance.
   - **PipelineTimingChart** below: "Each row is one creative, stacked
     bars show generation time (DALL-E, in sky blue) vs compositing
     time (Sharp + Canvas, in emerald). Notice the three reused
     creatives at the TOP of the chart — their bars are just the
     compositing sliver because their `generationTimeMs` is zero. The
     reuse story becomes a **shape**, not just a badge."
   - **CreativeGallery** masonry grid: "Each card has a top-left
     badge showing Reused or Generated. Top-right shows aspect ratio.
     Click any image to see the real creative served from the files
     route."
5. Open the one-liner bonus: `examples/campaigns/coastal-sun-protection/brief.json`
   in a split pane. "The brief is small JSON. The product with the
   `existingAsset` field is reused; the null one goes through DALL-E."
6. **Stop the demo.** That's the product; now drop into code.

---

## 2. Architecture walkthrough — the 90-second version

> *"Three layers. Frontend is Next.js 15 App Router + React 19 — one
> page, one form, state in a React Context with a discriminated-union
> reducer. The state management is ADR-004 — I can pull that up if you
> want."*
>
> *"Middle layer is `app/api/` — thin route handlers. Each one parses
> the request, delegates to a pipeline module, maps typed errors to
> HTTP status. No business logic in the routes themselves. That's ADR-006
> — the parallel wire-format shape I'll show in a minute."*
>
> *"Domain layer is `lib/pipeline/`. Zero framework imports. Pure
> TypeScript functions that take data and return data. `briefParser.ts`
> validates with Zod. `assetResolver.ts` checks for existing assets.
> `promptBuilder.ts` — the star component — constructs DALL-E prompts
> from a five-layer template. `imageGenerator.ts` calls DALL-E with
> retry and concurrency limits. `textOverlay.ts` composites the
> campaign message. `outputOrganizer.ts` writes everything to storage
> via a provider interface that has a local filesystem implementation
> and an S3 implementation. Swapping one for the other is a constructor
> argument."*
>
> *"If you wanted to port this to Python FastAPI, you'd copy
> `lib/pipeline/` verbatim into a different HTTP wrapper. That's the
> test of whether the clean architecture boundaries actually hold —
> and for AdSpark, they do."*

**Files to have open in tabs for quick reference:**
- `lib/pipeline/pipeline.ts` (orchestrator)
- `lib/pipeline/promptBuilder.ts` (star component — have at top)
- `lib/storage/s3Storage.ts` (provider interface impl)
- `lib/api/mappers.ts` (ADR-006 review gate)
- `docs/adr/ADR-003-typed-error-cause-discriminants.md` + `ADR-006-api-wire-format-parallel-shapes.md`

---

## 3. Deep dive — the prompt builder (the star component, 3–5 minutes)

**This is the walkthrough Adobe specifically asked for.** Quinn Frampton
in Round 1: *"Interested in HOW he got the AI to do it — show us in
your code where the prompt is generated."*

Read `lib/pipeline/promptBuilder.ts` front-to-back while screen-sharing.
The WHY-comments are the script. Key beats:

### The design decisions at the top of the file

Highlight the four listed in the JSDoc:
1. **Template-based, not LLM-generated.** *"A second-layer LLM writing
   prompts for the first-layer image model sounds clever but makes brand
   safety impossible to enforce — you can't audit what you can't
   predict. Templates are boring and predictable. That's the feature."*
2. **Variable injection, not string concatenation.** *"Every template
   slot maps to a named brief field. Point at any part of a generated
   image and I can trace it back to exactly which brief field drove it."*
3. **Aspect-ratio-aware composition.** *"A 9:16 vertical needs a
   different spatial layout than a 16:9 banner — product placement
   guidance changes per ratio."*
4. **Negative prompts via exclusion language.** *"DALL-E 3 doesn't
   support explicit negative prompts like Stable Diffusion, but we can
   steer it via phrases like 'no text, no logos, no watermarks'."*

### The five template layers

Walk through `buildPrompt()` and point at each layer:

1. **Subject** — product identity: name, description, key features, brand color
2. **Context** — audience + region + tone + season mood
3. **Composition** — aspect-ratio-specific layout guidance (`COMPOSITION_BY_RATIO`)
4. **Style** — photography direction: lighting, color grading, quality markers
5. **Exclusions** — what to keep out

### The category-aware branch

Highlight `PERSON_FRIENDLY_CATEGORIES` vs default. *"A skincare or
fitness brief gets 'people may appear naturally'. A beverage or
electronics brief gets 'no humans in the scene'. This kills a whole
class of ugly output where DALL-E inserts a human holding a can when
the brand wants the can alone on a pedestal."*

### The regen-example-prompts harness

Show `__tests__/regen-example-prompts.test.ts`. *"Every committed
example campaign has a `prompts.md` file that's autogenerated from the
live builder. The test is gated behind an env var so it only runs on
demand, but it means the committed artifacts CANNOT drift from the
actual code. If the builder changes, you regenerate, and the diff
shows exactly what changed in the prompts."*

**Takeaway line:** *"The prompt builder is designed to be read front-to-back,
audited layer-by-layer, and traced from brief field to generated pixel.
That's the answer to 'how did you get the AI to do it'."*

---

## 4. Two other things to point at briefly

### ADR-006 — parallel wire-format shapes (90 seconds)

Open `lib/api/mappers.ts` and `lib/api/types.ts` side by side.

> *"Middle-weight architectural decision worth flagging. A naive Next.js
> API would return `PipelineResult & { requestId }` — a transparent alias
> to the domain type. Works fine until a month later when you add a
> `costUsd` telemetry field to PipelineResult for internal dashboarding
> and it auto-ships over the wire to every client.*
>
> *Instead: `ApiCreativeOutput` is an explicit parallel shape to
> `CreativeOutput`. `toApiCreativeOutput` in mappers.ts enumerates every
> field by hand. The only way a new field reaches the wire is by a
> human updating both the interface AND the mapper. That's the review
> gate. One mapper function, zero auto-ship risk."*

### usePipelineState submissionId stale-event guards (60 seconds)

Open `lib/hooks/usePipelineState.tsx`.

> *"This is the hook that drives the dashboard. It's a
> `useReducer` + Context discriminated-union state machine with one
> correctness feature I'm proud of. Every non-idle state carries a
> monotonic submissionId. The race we're avoiding: user submits brief
> A, clicks reset, submits brief B, fetch B resolves, then fetch A
> FINALLY resolves and clobbers the UI with stale data.*
>
> *Every dispatch carries the id it was issued under. SUCCEEDED /
> FAILED / STAGE_CHANGED events whose id doesn't match the current
> state's id are silently dropped. The reducer returns the same
> reference so React skips re-rendering. ADR-004 documents the full
> race and the fix."*

---

## 5. Trade-offs taken for MVP — the honest list

When they ask *"what would you do differently with more time"*, have
this list ready. **Don't volunteer every item — pick 2-3 per question
and go deeper on those.**

### Cut for the assignment

- **No Firefly integration.** DALL-E 3 was the fastest path to a working
  demo. Firefly Services API would be a new `ImageGenerator`
  implementation — same interface, different backend. ADR-002 documents
  this as the natural port.
- **English only.** `targetRegion` and `targetAudience` flow through
  the prompt template but there's no translation step, no RTL text
  support, no region-specific visual adaptation. Architecturally a
  translation stage would sit between the parser and the prompt builder
  as a new pipeline module.
- **No brand-triage agent.** Planned post-MVP. `docs/architecture/brand-triage-agent.md`
  (if it exists in the branch) has the shape. Would enforce brand
  colors, tone compliance, logo placement rules before the image
  generation call.
- **DALL-E 3 Tier 1 rate limits bite on 6-image briefs.** 5 requests per
  minute means a 2-product × 3-ratio brief hits the rate limit exactly
  once mid-wave. Handled with 12-second retry backoff. Tier 2+ accounts
  see 2× wall time. Documented in SPIKE-002.
- **Localization stub.** No real translation; prompts just reference
  the region by name.
- **S3 upload path is deferred.** SPIKE-003 ships the local-mode upload
  flow; S3 mode returns 501. Enabling it needs a bucket CORS update
  (add PUT method) plus the S3 branch of the upload-init handler.
  Documented in SPIKE-003 §Migration path from D1.a to D1.b. The
  architecture is ready — I have the plan written out, I just chose not
  to ship it on the interview deadline because the test surface was
  larger than I wanted to land on eve-of.
- **No server-sent events for real-time pipeline progress.** The
  frontend polls its own state after a POST /api/generate that
  completes when the whole run is done. An SSE variant would dispatch
  stage transitions as they happen, giving finer-grained progress. The
  hook is already designed for it — `GenerateFnOptions.onStageChange`
  is threaded through but not fired by the sync client.

### Cut but architecturally ready

- **Pluggable storage** — `S3Storage` and `LocalStorage` implement the
  same `StorageProvider` interface. Adding Azure Blob, GCS, or Dropbox
  is a new class with four methods. Interface is defined in
  `lib/pipeline/types.ts` — I deliberately put it in the domain layer
  so adding a new storage backend doesn't need to modify any domain
  code.
- **Pluggable image generation** — same pattern. DALL-E 3 today,
  Firefly Services tomorrow, Imagen-3 the day after. Same `imageGenerator.ts`
  interface, different implementation. The prompt builder is
  provider-agnostic.
- **Per-run manifest** — every run produces `manifest.json` alongside
  the creatives with the full audit trail (prompts, timings, storage
  paths, errors). Lets a brand-safety reviewer grep the output
  retroactively.

### Known limitations I chose to ship

- **DALL-E 3 text rendering is unreliable.** That's why we composite
  campaign messages via Canvas AFTER generation, not inside the prompt.
- **Hex color adherence is weak.** Brief `color: "#F4A261"` doesn't
  reliably produce a warm-coral-dominated image. Production fix: hex →
  color-name translation before prompt injection.
- **Non-determinism testing is industry-hard.** Layer 1 (Zod schema
  validation at runtime) is shipped; layers 2–4 (property tests, golden
  fixtures, LLM-as-judge) are deferred. ADR-008 lays out the full
  strategy.

---

## 6. Production roadmap — what I'd ship next

If asked *"where would you take this next?"*, here's the sequence:

### Week 1 post-MVP

1. **Brand-triage agent** — enforce brand guidelines on the prompt
   before DALL-E. Rejects or rewrites any prompt that violates brand
   tone, color, or compliance rules. This is the REAL differentiator
   from a generic "call DALL-E with a template" product.
2. **Firefly Services adapter** — a second `ImageGenerator`
   implementation. Adobe-ecosystem alignment, C2PA content credentials
   baked in.
3. **S3 upload end-to-end** — finish SPIKE-003 D1.b. The architecture
   is ready; the bucket CORS needs a PUT method added.
4. **Vercel function bandwidth optimization** — right now the
   `/api/generate` response body contains the creative buffers in base64.
   Switch to streaming multipart responses so the frontend can render
   creatives as they become available (today it waits for all 6).

### Week 2–3

5. **SSE streaming** — pipeline stage transitions as they happen, not
   at the end. `GenerateFnOptions.onStageChange` is already plumbed
   through; just needs a streaming server handler.
6. **Session persistence** — reopenable campaign workspaces. Users come
   back tomorrow, click a session from the sidebar, see their past
   runs, iterate on the brief without losing state. ADR-014 (draft)
   lays out the state separation: session state is distinct from
   generation state.
7. **Multi-user asset library** — a real brand asset catalog (today
   just the seed-assets folder as a POC). Upload, tag, browse,
   categorize by product or campaign.
8. **Prompt fingerprint cache** — hash the computed prompt, cache the
   DALL-E result by hash. Same brief submitted twice returns cached
   images instantly. Cuts cost and wall time for iterative brief
   refinement.

### Quarter 1

9. **LLM-as-judge golden fixture tests** — ADR-008 layer 3 and 4.
   Freeze the output of every sample brief as a "golden image", run
   LLM-as-judge against new outputs to detect regressions.
10. **A/B testing hooks** — serve two prompt variants per product, track
    engagement signals, pick the winner. The manifest schema already
    has everything needed; just needs a UI and an analytics hook.
11. **Localization stage** — real translation between parser and prompt
    builder, RTL text overlay rendering, region-specific visual
    adaptations.

---

## 7. Likely questions — prepared answers

### *"Why Next.js? Couldn't you have built this as a Python CLI?"*

> *"I could have. ADR-001 documents the decision. The short version:
> Adobe's JD specifically lists Node + TypeScript as a preferred stack
> and a reviewer is more likely to clone-and-run if there's no Python
> env to set up. One codebase for backend + frontend, one-click Vercel
> deploy, and the `lib/pipeline/` layer is still framework-free — I
> can literally copy that directory into a FastAPI project tomorrow
> without changing a line. Next.js gave me the fastest path to a
> working hosted demo without sacrificing the architecture I'd want
> for a production version."*

### *"Why not use MCP for the OpenAI integration?"*

> *"ADR-002 documents this. I evaluated adding an MCP layer between
> the pipeline and OpenAI — theoretically it would let me swap
> providers via config instead of code. In practice for this POC,
> the OpenAI SDK is already an adapter, and adding another layer
> would have been architecture theater — it'd be a deferred cost with
> no immediate payoff. The `ImageGenerator` interface in types.ts
> already gives me provider-swapping ability at the module boundary.
> MCP would add two layers of indirection for the same benefit. I
> chose to ship the simpler structure and document the trade-off."*

### *"How do you handle failures in the middle of a run?"*

> *"Partial failure is a first-class concern. Every fan-out in the
> pipeline uses `Promise.allSettled` — if 5 of 6 DALL-E calls succeed
> and 1 fails with a content policy rejection, we return the 5
> creatives plus a typed error for the 1. The manifest is always
> written, even on total failure, so the audit trail is never lost.
> The frontend surfaces per-creative failures inline via the
> RunSummaryPanel's 'failed' row — non-zero count triggers an amber
> banner below the count tiles."*
>
> **Follow-up if asked about timeouts:** *"Three-layer staggered
> timeout cascade documented in `lib/api/timeouts.ts`: pipeline
> budget 120s, client AbortSignal 135s, Vercel hard cap 300s. The
> server wins the race against the client, which wins against the
> platform — the user always gets a typed error with a requestId,
> never an opaque 504."*

### *"How do you test non-deterministic systems?"*

> *"ADR-008 is my essay on this. Four layers:*
>
> *Layer 1, runtime schema validation — Zod schemas enforce the shape
> of every brief and every response. Shipped.*
>
> *Layer 2, property-based tests — invariants that must hold regardless
> of LLM output. Like 'the prompt builder must never emit a string
> containing the raw HTML encoding of the campaign message'. Not yet
> shipped.*
>
> *Layer 3, golden fixtures — freeze the output of sample briefs, diff
> new runs against the golden. Not yet shipped but planned.*
>
> *Layer 4, LLM-as-judge — use GPT-4 to score whether the generated
> creative matches the brief intent. Most expensive, most subjective,
> deferred furthest.*
>
> *Right now I've shipped Layer 1 and committed to the roadmap for
> layers 2–4. The honest answer is 'this is industry-hard and I'm
> not pretending to have it solved'."*

### *"What's the biggest limitation of the current implementation?"*

Pick ONE:
- **If they care about cost:** DALL-E 3 Tier 1 rate limits. 5 RPM caps
  the batch size; Tier 2+ unlocks fast path but costs more per image.
- **If they care about UX:** no streaming. A 6-image brief takes ~45
  seconds with no intermediate feedback beyond the progress bar.
  Switching to SSE would let creatives appear one-by-one as they
  complete.
- **If they care about scaling:** Vercel function bandwidth. The
  response body currently includes every creative's pre-signed URL
  metadata. For a 100-image batch this would blow past response size
  limits. Production would stream.
- **If they care about brand safety:** no brand-triage agent. A
  marketer running this against a real brand today could get a
  composition that violates their guidelines. The fix is the first
  item in the production roadmap.

### *"Why DALL-E 3 and not Firefly?"*

> *"DALL-E 3 is the fastest path to a working demo. The OpenAI SDK is
> more mature, the API surface is simpler, and response latency on
> Tier 1 is acceptable for a POC. For a production version targeting
> Adobe's ecosystem specifically, Firefly is the right backend — it
> has C2PA content credentials baked in, it's trained on licensed-only
> data, and it integrates with the Firefly Services API for brand-safe
> generation. I deliberately kept the `ImageGenerator` interface
> provider-agnostic so swapping is a new class, not a rewrite. ADR-002
> documents this."*

### *"Walk me through what happens when I click 'Generate'."*

> *"React handler calls `submit(brief)` on the `usePipelineState` hook.
> That dispatches a SUBMIT action with a fresh submissionId, then calls
> the injected `generateCreatives` function from `lib/api/client.ts`.
> The client POSTs to `/api/generate` with a 135-second AbortSignal
> timeout.*
>
> *Server side: the route handler in `app/api/generate/route.ts` validates
> required env, reads the body with a stream-level byte cap, parses it
> via Zod, then calls `runPipeline` with the validated brief, a
> StorageProvider from the factory, an OpenAI client, and a
> RequestContext for structured logging.*
>
> *`runPipeline` walks six stages: validating, resolving, generating,
> compositing, organizing, complete. Asset resolution is a Promise.allSettled
> over every product — existing assets get loaded as buffers, missing
> ones get routed to generation. Generation uses p-limit(3) for
> concurrency control on Tier 1 DALL-E. Compositing runs Sharp resize
> plus @napi-rs/canvas text overlay in parallel. Organizing writes
> creatives + thumbnails + manifest.json + brief.json via the storage
> provider.*
>
> *The response comes back as a `GenerateSuccessResponseBody` — the
> parallel wire shape from ADR-006 — containing each creative's
> storage key, pre-signed URL if in S3 mode, prompt, and timings.
> The frontend's reducer dispatches SUCCEEDED, which flips the state
> to `complete`, and the RunSummaryPanel + CreativeGallery render from
> `state.result`."*

---

## 8. Demo failure contingencies

### *If DALL-E fails mid-demo with a rate limit*

Say: *"You're watching a real DALL-E 3 Tier 1 rate limit hit. This is
exactly the limitation I flagged in my README's known-limitations
section. Let me show you a prior run instead."*

Open the file tree → navigate to `output/two-image-diagnostic/` or
`output/nike-move-with-purpose-2026/` → walk through the folder
structure. *"Every run writes to the same shape: `<campaignId>/<productSlug>/<ratio>/`
with creative.png + thumbnail.webp, plus a top-level manifest.json
and brief.json for the audit trail."*

Open `manifest.json` in the editor, show the schema. *"Every prompt,
every timing, every error captured with a requestId. This is what a
brand-safety reviewer would grep against."*

### *If the dev server won't start*

- Check the PowerShell window for the error
- Try a different port: `npm run dev -- --port 3010`
- Kill stale processes: `taskkill /F /IM node.exe` (nuclear option)
- Fallback to showing code files directly in VS Code + explaining the
  flow. The prompt builder walkthrough doesn't need a running server.

### *If the browser shows a blank page*

- Hard refresh: Ctrl+Shift+R
- Check DevTools console for JS errors
- Check Network tab for failed requests
- If `/api/healthz` returns 200 but the page is blank, it's a
  client-side hydration issue — restart the dev server

### *If OPENAI_API_KEY is missing*

- `cat .env.local` in a terminal to verify it's there
- Check it hasn't expired on platform.openai.com/usage
- Have a backup key ready in your password manager
- If genuinely broken: demo the code only, explain what WOULD happen

### *If the interviewer asks to see the hosted URL and Vercel is broken*

- Don't panic. Say: *"Vercel has the old AWS key from before I rotated
  it — the local version is fully working. Let me walk you through it
  locally and we can come back to the hosted version afterwards."*
- This is a real scenario if you didn't update Vercel env vars.

---

## 9. Pre-interview checklist (30 minutes before)

- [ ] Dev server running on :3000 with fresh state
- [ ] Browser open to http://localhost:3000 with DevTools Network tab visible
- [ ] VS Code open to `lib/pipeline/promptBuilder.ts` in one tab
- [ ] VS Code open to `lib/api/mappers.ts` + `lib/api/types.ts` side-by-side in another tab
- [ ] VS Code open to `docs/adr/` folder listing visible
- [ ] `OPENAI_API_KEY` verified in `.env.local`, not expired
- [ ] `aws sts get-caller-identity` returns valid JSON (proves S3 story works)
- [ ] `examples/campaigns/coastal-sun-protection/brief.json` open in a tab as demo brief reference
- [ ] Teams camera + mic tested, background set, notifications silenced
- [ ] Water within reach
- [ ] This cheat-sheet open in a tab but NOT visible to the reviewer
- [ ] Phone on silent
- [ ] Any second monitor only showing things you're comfortable being
  seen — no unrelated tabs, no personal info
- [ ] Backup: `output/` directory has prior runs in case live DALL-E fails

---

## 10. Three numbers to remember

These are the specific, concrete numbers a senior interviewer may ask
about. Have them memorized cold. **Verified by live timing instrumentation
on 2026-04-14** (see the Block F dry run + the natural-language end-to-end
test captured at the bottom of this file).

- **~32 seconds** — realistic wall-clock for the structured-form demo path with the `coastal-sun-protection` brief (2 products × 3 ratios, 3 reused + 3 generated). Measured live. **This is the demo path you should lead with tomorrow.**
- **~$0.50** — per-campaign API cost (6 DALL-E standard generations at ~$0.08 each, plus orchestrator overhead)
- **~$50K–$500K over 4–8 weeks** — what a traditional creative agency would bill for the same output. This is the "why does this matter" number.

### Additional timing numbers — have these ready if asked

- **~24 seconds** — orchestrator wall time (4 agent phases: triage ~7s + draft ~7s in parallel, review ~10s, synthesis ~7s). **NOT the 10-12s the old BriefForm JSDoc claimed** — that figure was stale and not verified against the current code path. Live-measured 2026-04-14.
- **~52 seconds** — natural-language path total (orchestrator + pipeline for a 1-product × 3-ratio refined brief). 25s orchestrator + 27s pipeline.
- **~80-85 seconds** — worst-case natural-language path for a 2-product × 3-ratio refined brief (25s orchestrator + ~55-60s pipeline with 2 DALL-E waves).
- **3 per wave** — DALL-E concurrency limit at Tier 1 (`DALLE_CONCURRENCY_LIMIT` in imageGenerator.ts). A 3-image brief fits in 1 wave; 6 images need 2 waves.
- **~22-28 seconds** — per-image DALL-E 3 latency at Tier 1 p75. Three parallel calls take ~the longest-single-call time because they're all running concurrently.

Plus these:

- **5 template layers** in the prompt builder (Subject / Context / Composition / Style / Exclusions)
- **3 aspect ratios** (1:1, 9:16, 16:9)
- **8 ADRs** documented (`docs/adr/ADR-001` through `ADR-008`)
- **282 tests** passing on the interview-prep branch
- **120 second** pipeline budget (PIPELINE_BUDGET_MS), **135 second** client timeout, **300 second** Vercel hard cap

---

## 11. Closing (60 seconds)

> *"So that's AdSpark — the star component is the prompt builder, the
> architecture is clean, the trade-offs are documented honestly, and
> the production roadmap is real. I'd love to talk about how you'd
> evaluate the brand-safety dimension in a production version, or what
> you'd prioritize differently for the Firefly team specifically.*
>
> *What questions do you have?"*

**Don't rush the close.** Let silence sit if needed. The first question
from an interviewer is often the most important one of the conversation.

---

## Quick reference — file paths for live reference

| What | Where |
|---|---|
| Prompt builder (the star) | `lib/pipeline/promptBuilder.ts` |
| Pipeline orchestrator | `lib/pipeline/pipeline.ts` |
| Wire mappers (ADR-006) | `lib/api/mappers.ts` + `lib/api/types.ts` |
| Error discriminants (ADR-003) | `lib/api/errors.ts` |
| State management (ADR-004) | `lib/hooks/usePipelineState.tsx` |
| Run summary helper | `lib/pipeline/runSummary.ts` |
| Storage abstraction | `lib/storage/` (index.ts + localStorage.ts + s3Storage.ts) |
| Magic-byte validator | `lib/pipeline/imageValidation.ts` |
| Upload flow | `app/api/upload/route.ts` |
| SPIKE-003 design doc | `docs/spikes/SPIKE-003-asset-upload-flow.md` |
| INVESTIGATION-003 plan | `docs/investigations/INVESTIGATION-003-upload-route-two-step-flow.md` |
| Canonical demo brief | `examples/campaigns/coastal-sun-protection/brief.json` |
| Regen harness (drift guard) | `__tests__/regen-example-prompts.test.ts` |
| Known limitations | `README.md` → "Known limitations" section |

---

## One final note to self

**You've built something real and you know it cold. The hard work is
already done. Your only job tomorrow is to explain what's already in
front of you, honestly, without overselling or underselling. If an
answer is "I don't know," say that. If something you shipped is a
compromise, own the compromise — don't hide it. The honest engineer
who explains trade-offs clearly wins over the one who performs
confidence.**

**Good luck. Sleep well tonight.**
