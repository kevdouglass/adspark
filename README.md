# AdSpark

**AI-powered creative automation for social ad campaigns.** A campaign brief in, 6 platform-ready creatives out, ~45 seconds.

AdSpark turns a structured campaign brief (or a natural-language prompt) into publish-ready ad creatives across multiple aspect ratios. It uses DALL-E 3 for image generation, `@napi-rs/canvas` for text compositing, and a 4-phase multi-agent orchestrator (5 stakeholder agents) for brief refinement. Built as a production-lean take-home for the Adobe Forward Deployed AI Engineer (Firefly) role — not a toy.

- **Live demo:** *(Vercel URL added on submission)*
- **Loom walkthrough:** [Watch the 2-3 min demo](https://www.loom.com/share/5119df38db1948e6802abc2f493f27bb)
- **Repo:** https://github.com/kevdouglass/adspark

---

## What it does

A global consumer goods company runs hundreds of localized social ad campaigns a month. Today each one takes 4-8 weeks and $50K-500K across creative agencies, production teams, legal review, and regional approval. AdSpark collapses that into ~45 seconds of pipeline time and ~$0.50 in API calls.

```
Campaign brief (JSON or natural language)
  → AI brief orchestrator   (~10s, 5 stakeholder agents)
  → Brief parser             (Zod schema validation)
  → Asset resolver           (local/S3 reuse lookup)
  → Prompt builder           (5-layer template, auditable)
  → DALL-E 3 image generator (parallel, retry, abortable)
  → Text overlay             (Sharp resize + Canvas composite)
  → Output organizer         (manifest.json + structured folders)
  → 6 campaign-ready creatives in 3 aspect ratios
```

[Full business context and production roadmap →](knowledge-base/01-assessment/business-context.md)

---

## Run it

Three ways to run AdSpark, pick whichever matches your environment.

### Local (fastest, for developers)

**Prerequisites:** Node 22+, an OpenAI API key.

```bash
git clone https://github.com/kevdouglass/adspark.git
cd adspark
npm install
cp .env.example .env.local
#    edit .env.local → OPENAI_API_KEY=sk-proj-...
npm run dev
```

Open <http://localhost:3000>. Creatives land in `./output/` by default; the dashboard's "✨ Load example" button pastes a sample prompt into the AI brief orchestrator.

### Docker (any machine, zero Node install)

**Prerequisites:** Docker Desktop 4.x+ (or Docker Engine + compose v2).

```bash
# 1. Clone + configure
git clone https://github.com/kevdouglass/adspark.git
cd adspark
cp .env.docker.example .env.docker
#    edit .env.docker → OPENAI_API_KEY=sk-proj-...

# 2. Build the image (~2-3 min first time, cached after)
docker compose build

# 3. Start the container (detached so your shell stays free)
docker compose up -d

# 4. Verify it's healthy
docker compose ps
#   → NAME      STATUS             PORTS
#     adspark   Up 30s (healthy)   0.0.0.0:3000->3000/tcp
curl http://localhost:3000/api/healthz
#   → {"ok":true,"storageMode":"local",...,"pipelineBudgetMs":120000,...}

# 5. Open the dashboard
#    http://localhost:3000

# 6. Tear down when done
docker compose down
```

The container ships on **Node 22** (bookworm-slim), runs as **non-root**, and writes output to a **named Docker volume** (`adspark-output`) that survives restarts. Graceful SIGTERM drain is wired via [`instrumentation.ts`](instrumentation.ts) — in-flight DALL-E calls have up to 120s to complete before the container is killed.

**Running side-by-side with `npm run dev`?** Start the container on a different host port:
```bash
HOST_PORT=3001 docker compose up -d
curl http://localhost:3001/api/healthz     # container
curl http://localhost:3000/api/healthz     # your dev server
```

See **[docs/side-by-side-cheatsheet.md](docs/side-by-side-cheatsheet.md)** for the complete side-by-side monitoring guide — every command end-to-end verified, troubleshooting table for the two real Next.js-standalone gotchas (missing `public/` directory + `HOSTNAME=0.0.0.0` binding), and a `watch`-based live dashboard recipe.

For the full container reference (design decisions with file:line citations, reverse-proxy configuration, observability event catalog, SIGTERM drain flow), see **[docs/docker.md](docs/docker.md)**.

### Vercel (hosted demo, one-click)

Push to a branch on GitHub and Vercel builds automatically. Add `OPENAI_API_KEY` (and the S3 vars if you set `STORAGE_MODE=s3`) under **Settings → Environment Variables** in both Preview and Production scopes. See **[docs/aws-setup.md](docs/aws-setup.md)** for the S3 provisioning guide required for persistent image serving on serverless.

---

## Architecture

### Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 15 App Router, React 19, Tailwind v4)               │
│  BriefGeneratorAI → BriefForm → CreativeGallery                        │
│            ↓                              ↑                             │
│       usePipelineState (MVI hook with submissionId guards)              │
└─────────┬────────────────────────────────────────────────────┬─────────┘
          │                                                    │
          ▼ POST /api/orchestrate-brief           POST /api/generate
          │                                                    │
          ▼                                                    ▼
┌────────────────────────────┐          ┌──────────────────────────────┐
│ lib/ai/agents.ts           │          │ lib/pipeline/ (framework-free)│
│  Phase 1: Triage           │  brief   │  briefParser → assetResolver │
│  Phase 2: Draft            │────────▶│  → promptBuilder ★ → imageGen │
│  Phase 3: 4 parallel revs  │          │  → textOverlay → organizer   │
│  Phase 4: Synthesis        │          └────────────┬─────────────────┘
└────────────────────────────┘                       │
                                                     ▼
                              ┌──────────────────────────────────────┐
                              │ lib/storage/ (StorageProvider iface) │
                              │   ├── LocalStorage  (./output/)      │
                              │   └── S3Storage     (pre-signed URLs)│
                              └──────────────────────────────────────┘
```

### Clean architecture rules (enforced by import discipline)

- **`lib/pipeline/`** has zero framework dependencies. Pure TypeScript functions that take data and return data. Drop it into a different HTTP layer and it still works.
- **`lib/storage/`** implements interfaces defined in `lib/pipeline/types.ts` — domain defines the contract, infrastructure fulfills it (dependency inversion).
- **`app/api/`** routes are thin: parse request, call pipeline, map errors to HTTP. No business logic.
- **Swapping DALL-E for Firefly** is a new `ImageGenerator` implementation. **Swapping S3 for Azure Blob** is a new `StorageProvider` implementation. **Swapping Next.js for Python FastAPI** is copying `lib/pipeline/` verbatim into a different HTTP wrapper.

Same code deploys to **Vercel (serverless functions)** and to **Docker (long-running container)** — see [docs/docker.md](docs/docker.md) for the parity story.

---

## Tech stack

| Category | Tool | Why |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | JD-preferred stack, full-stack in one codebase, one-click Vercel deploy |
| **Runtime** | Node 22 LTS | Node 20 hits EOL April 2026 — we ship on Active LTS |
| **Language** | TypeScript (strict mode) | Type safety across pipeline + frontend |
| **UI** | React 19 + Tailwind v4 | Dashboard with brief form, progress UI, masonry gallery. Firefly theme tokens in `app/globals.css` |
| **State** | `useReducer` + Context | Discriminated-union state machine with stable submissionIds (see [ADR-004](docs/adr/ADR-004-frontend-state-management.md)) |
| **Form state** | `react-hook-form` + Zod | Same schema validates client AND server via `z.infer` |
| **Image generation** | OpenAI DALL-E 3 | Best quality + simplest API. *In production I'd evaluate Firefly for Adobe-ecosystem alignment.* |
| **AI orchestrator** | OpenAI gpt-4o-mini (JSON mode) | 4-phase stakeholder brief refinement — ~10s wall, ~$0.02/call |
| **Image processing** | [Sharp](https://sharp.pixelplumbing.com/) + [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) | Sharp for resize/crop, Canvas for text compositing |
| **Schema validation** | [Zod](https://zod.dev/) | Single source of truth — server and client share the same schema |
| **Storage** | S3 (production) + local filesystem (dev) | Pluggable `StorageProvider` interface; pre-signed 24hr URLs in S3 mode |
| **Testing** | [Vitest](https://vitest.dev/) | 250 tests / 16 files — pipeline, orchestrator, API routes, abort control, structured logging, healthz, agent events |
| **Deployment** | Vercel Pro + Docker | Two targets, one codebase |

---

## Example brief + output

See [`examples/`](examples/) for the full sample corpus — five demo campaigns (coffee launch, streetwear drop, wellness lineup, festival energy drink, and a **coastal sun-protection campaign that exercises the asset-reuse branch end-to-end**) each with a `brief.json`, a natural-language seed prompt, the autogenerated DALL-E prompts, and a walkthrough script.

**Smallest valid brief** (`examples/minimal-brief.json`):

```json
{
  "campaign": {
    "id": "diagnostic-test",
    "name": "Minimal Diagnostic Test",
    "message": "Test",
    "targetRegion": "North America",
    "targetAudience": "Test audience",
    "tone": "minimal",
    "season": "summer"
  },
  "products": [
    {
      "name": "Test Product",
      "slug": "test-product",
      "description": "A simple red square for diagnostic testing",
      "category": "test",
      "keyFeatures": ["simple", "minimal"],
      "color": "#FF0000",
      "existingAsset": null
    }
  ],
  "aspectRatios": ["1:1"],
  "outputFormats": { "creative": "png", "thumbnail": "webp" }
}
```

**Output folder structure:**

```
output/
└── diagnostic-test/
    ├── manifest.json                          ← audit trail: every prompt, timing, error
    ├── brief.json                             ← the validated input
    └── test-product/
        └── 1x1/
            ├── creative.png     (1080×1080)
            └── thumbnail.webp   (400×400)
```

`manifest.json` records every DALL-E prompt, generation + compositing times, storage paths, and any partial-failure errors — the audit trail a brand-safety reviewer can grep.

### Asset library + reuse demo

The assignment asks the pipeline to *"reuse input assets when available"*. `assetResolver.resolveOne()` supports this via `product.existingAsset` — if the named file is present, the product skips DALL-E generation entirely and the composited creative is built on top of the existing asset. To make this branch visible on a fresh clone, two pieces are wired together:

1. **`examples/seed-assets/`** contains committed product images that stand in for a production brand asset library. They are produced by [`scripts/seed-from-output.ts`](scripts/seed-from-output.ts), which takes prior pipeline outputs from `./output/` (gitignored) and crops the text overlay band out before writing the cropped result as a WebP. Idempotent — re-running produces byte-identical output.

2. **`LocalStorage`** (see [`lib/storage/localStorage.ts`](lib/storage/localStorage.ts)) now accepts an optional `readOnlySeedDirs` list. `exists()` and `load()` fall through to each seed dir when the primary `LOCAL_OUTPUT_DIR` misses. Writes still go only to the primary. The factory in [`lib/storage/index.ts`](lib/storage/index.ts) passes `['./examples/seed-assets']` as the default seed dir in local mode, so on a fresh clone the seed assets are immediately visible to the resolver.

**[`examples/campaigns/coastal-sun-protection/`](examples/campaigns/coastal-sun-protection/)** is the canonical demo campaign — it references the fictional Coastal Wellness Co. brand (see [`examples/brand-profiles/coastal-wellness.json`](examples/brand-profiles/coastal-wellness.json)) and has two products: the SPF 50 Mineral Sunscreen uses a seed asset (reuse branch), and the After-Sun Cooling Aloe Gel goes through DALL-E (generation branch). Running this one brief demonstrates both paths side-by-side in a single manifest, with `generationTimeMs: 0` for the reused product.

### Manual upload — two-step init + PUT flow

The `BriefForm` also accepts **manually uploaded product images** via a visible file picker on each product card. The flow is a two-step init + PUT (SPIKE-003 / INVESTIGATION-003):

1. **Init** — frontend POSTs `{filename, contentType, campaignId?}` to `/api/upload`. Server validates the body, builds a safe storage key (`assets/<campaignId>/<timestamp>-<name>.<ext>`), and returns an `uploadUrl` + `key`.
2. **Upload** —
   - **Local mode:** `uploadUrl` points back at `PUT /api/upload?key=...`. Browser PUTs the binary body; the route reads it with a stream-level byte cap (10 MB), validates Content-Type + magic bytes (defeats Content-Type spoofing), and writes via `LocalStorage.save()`.
   - **S3 mode (deferred, see SPIKE-003 §Migration path):** `uploadUrl` would be a pre-signed S3 PUT URL — the browser uploads directly to S3, bypassing the Next.js function entirely.
3. **Wire into brief** — frontend saves the returned `key` into `product.existingAsset` (NOT the `uploadUrl` — keys are stable, signed URLs expire). The pipeline's `assetResolver.resolveOne` then finds the uploaded file via `storage.exists(key)` + `storage.load(key)` on the next `/api/generate` call, and the reuse branch fires just like it does for committed seed assets.

The on-disk layout separates committed seed assets from uploaded ones:

```
examples/seed-assets/             ← committed, read via LocalStorage seed-dir fallback
├── spf-50-sunscreen.webp
└── after-sun-aloe-gel.webp

output/                            ← gitignored (ephemeral)
├── <campaignId>/                  ← generated creatives (per run)
│   └── <productSlug>/<ratio>/...
└── assets/                        ← user-uploaded assets
    └── <campaignId>/<timestamp>-<name>.<ext>
```

See **[SPIKE-003](docs/spikes/SPIKE-003-asset-upload-flow.md)** for the strategic decision record and **[INVESTIGATION-003](docs/investigations/INVESTIGATION-003-upload-route-two-step-flow.md)** for the full file-by-file audit + 7-adjustment list applied to the external review.

---

## Prompt engineering — the star component

[`lib/pipeline/promptBuilder.ts`](lib/pipeline/promptBuilder.ts) is designed to be read front-to-back. It uses a **five-layer prompt template** with every layer heavily commented:

| Layer | Purpose |
|---|---|
| **Subject** | Product identity — name, description, key features, brand color |
| **Context** | Audience + region + tone + season mood |
| **Composition** | Aspect-ratio-specific layout guidance (where to place the product, leave room for overlay, etc.) |
| **Style** | Photography direction — lighting, color grading, quality markers |
| **Exclusions** | What to keep out (text, logos, watermarks) |

Every prompt is:

1. **Template-based** (not LLM-generated) — reviewers can predict what will come out for a given input. Brand safety requires predictability.
2. **Traceable** — every brief field maps to a specific prompt layer. Point at any part of a generated image and trace it back to a brief field.
3. **Category-aware** — lifestyle categories (skincare, beauty, sportswear) get prompts with *"people may appear naturally"*; product categories (beverage, electronics) get *"no humans in the scene"*.
4. **Aspect-ratio-aware** — different composition guidance per 1:1, 9:16, 16:9 because DALL-E doesn't know how the image will be used downstream.

The prompts for every demo campaign are autogenerated via [`__tests__/regen-example-prompts.test.ts`](__tests__/regen-example-prompts.test.ts), guaranteeing the committed `prompts.md` artifacts in `examples/campaigns/*` never drift from the live builder.

---

## Multi-agent brief orchestrator

Users can describe a campaign in plain English. A team of 5 specialist agents (grounded in the business-context's 5 real stakeholders) then refines it into a production-ready structured brief before the DALL-E pipeline runs.

| Agent | Real pain point | What they review |
|---|---|---|
| **Campaign Manager** | *"200 variants by Friday, agency quoted 3 weeks"* | Drafts the initial brief (biased toward shipping) |
| **Creative Director** | *"Bangalore team cropped the logo"* | Visual/creative direction — DALL-E renderability |
| **Regional Lead** | *"US message doesn't resonate in Japan"* | Cultural fit, regional nuance |
| **Legal / Compliance** | *"Competitor trademark in Brazil"* | Unverified claims, IP risk, regulated categories |
| **CMO** | *"$12M/year and I can't tell what converts"* | ROI signal, measurability, audience specificity |

The 4-phase flow (triage → draft → 4 parallel reviews → synthesis) runs in ~10-12 seconds and costs ~$0.02 per call. Partial-failure tolerant: a single reviewer going down doesn't kill the orchestration. Every phase re-validates output against the same `campaignBriefSchema` used by the pipeline.

Full implementation in [`lib/ai/agents.ts`](lib/ai/agents.ts). Non-determinism testing strategy in [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md).

---

## Design decisions + ADRs

Every significant architectural decision is captured in [`docs/adr/`](docs/adr/):

| ADR | Topic | TL;DR |
|---|---|---|
| [ADR-001](docs/adr/ADR-001-nextjs-full-stack-typescript.md) | Next.js full-stack TypeScript | Framework choice + tech stack defense |
| [ADR-002](docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md) | Direct SDK over MCP | Why the pipeline uses OpenAI SDK directly |
| [ADR-003](docs/adr/ADR-003-typed-error-cause-discriminants.md) | Typed error cause discriminants | Compile-time exhaustive error → HTTP status mapping |
| [ADR-004](docs/adr/ADR-004-frontend-state-management.md) | Frontend state management | `useReducer` + Context + submissionId stale-event guards |
| [ADR-005](docs/adr/ADR-005-runtime-schema-validation-zod.md) | Runtime schema validation (Zod) | Single source of truth for client + server |
| [ADR-006](docs/adr/ADR-006-api-wire-format-parallel-shapes.md) | API wire format parallel shapes | Explicit mappers as the wire-contract review gate |
| [ADR-007](docs/adr/ADR-007-dashboard-page-as-client-component.md) | Dashboard as client component | Why `page.tsx` is `"use client"` |
| [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md) | Testing LLM outputs | 4-layer strategy for non-deterministic systems |

---

## Testing

```bash
npm run test:run     # 250 tests / 16 files, ~25s
npm run type-check   # tsc --noEmit (strict mode)
npm run lint         # ESLint + Next.js rules
```

**Pre-merge local gate:**

```bash
npm run type-check && npm run test:run && npm run lint
```

Coverage highlights:

- **Pipeline contract** (`pipeline.test.ts`) — happy path, partial failure, stage ordering, timing instrumentation
- **Prompt builder** (`promptBuilder.test.ts`) — the P0 component, every layer asserted
- **Image generator** (`imageGenerator.test.ts`) — retry on 429/500, abort semantics, concurrency
- **Structured logging** (`logging.test.ts`, `loggingRoute.test.ts`) — event contract + sink pluggability
- **AbortController** (`abortController.test.ts`) — container-mode preemption end-to-end
- **Multi-agent events** (`agentEvents.test.ts`) — all 7 orchestrator phases emit structured events
- **Healthz contract** (`healthz.test.ts`) — timeout cascade invariants, 503 on drain
- **Files route** (`filesRoute.test.ts`) — path traversal + symlink escape defenses

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `OPENAI_API_KEY is required` | `.env.local` / `.env.docker` missing or empty | Copy the `.env*.example` template and fill in the key |
| DALL-E times out at 60s | OpenAI SDK per-request timeout hit | Check `dalle.start` / `dalle.failed` in logs — slow DALL-E day or network issue; retry |
| Images 404 after generation (local) | `LOCAL_OUTPUT_DIR` mismatch | `ls ./output/<campaign-id>/` — if present, check the `/api/files/[...path]` route is running |
| Images 403 after generation (S3) | CORS or signed URL expiry | Re-check [docs/aws-setup.md — Troubleshooting](docs/aws-setup.md#troubleshooting) |
| CORB blocks images in DevTools | S3 bucket CORS missing your origin | Add the page origin to `AllowedOrigins` per [docs/aws-setup.md step 2](docs/aws-setup.md#2-configure-cors-on-the-bucket) |
| Vercel 502 after ~60s | Proxy timeout < pipeline budget | Vercel Pro `maxDuration = 300` is already set; check function duration in Vercel logs |
| Docker container `unhealthy` | Healthcheck probing during startup | Wait 30s grace window; then `docker logs adspark` |
| Reviewer sees 502/504 through ALB/nginx | Proxy idle timeout < 140s | See [docs/docker.md — Reverse proxy configuration](docs/docker.md#reverse-proxy-configuration-non-negotiable) |

---

## Known limitations

**DALL-E 3 specific:**
- **Text rendering is unreliable.** That's why we composite campaign messages via Canvas AFTER generation, not inside the prompt.
- **Hex color adherence is weak.** Brief `color: "#F4A261"` doesn't reliably produce a warm-coral-dominated image. Production fix: hex → color-name translation before prompt injection.
- **Tier 1 rate limit (5 img/min)** bites on 6-image briefs. Tier 2+ accounts see ~25-30s wall time.

**Brief orchestrator specific:**
- **Non-determinism testing is industry-hard.** Layer 1 (Zod schema validation at runtime) is shipped; layers 2-4 (property tests, golden fixtures, LLM-as-judge) are deferred — see [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md).
- **Adds ~10s to the wait.** Could be made opt-in or cached by prompt hash in production.

**Scope-bounded for POC:**
- **English only.** Localization is architecturally supported (a translation stage between parser and prompt builder) but not wired yet.
- **No A/B test framework.** The manifest captures everything needed; no UI or analytics hook.
- **No brand-triage agent.** Planned post-assessment (see `docs/architecture/brand-triage-agent.md`).
- **No asset upload UI.** `assetResolver.ts` supports reuse; the BriefForm doesn't have an upload control yet.

**What I'd do differently with more time:** start with the brand-triage agent (the real differentiator), pin DALL-E model snapshots from day one (avoid floating-version drift), and ship an observability dashboard alongside the first creative (D3 pie chart of "where did the time go?" per stage).

---

## Project structure

```
adspark/
├── README.md                         ← you are here
├── Dockerfile                        ← multi-stage Node 22 build
├── docker-compose.yml                ← service + named volume + stop_grace_period
├── next.config.ts                    ← standalone output + native-dep tracing
├── instrumentation.ts                ← Next.js SIGTERM hook
│
├── app/                              ← Next.js App Router
│   ├── page.tsx                      ← Dashboard
│   └── api/                          ← Thin route handlers
│       ├── generate/                 ← POST — runs pipeline, returns creatives
│       ├── orchestrate-brief/        ← POST — multi-agent brief refinement
│       ├── healthz/                  ← GET — container drain probe
│       ├── files/[...path]/          ← GET — local-mode file server
│       └── upload/                   ← POST init + PUT bytes (2-step flow)
│
├── components/                       ← React 19 UI
│   ├── BriefForm.tsx                 ← Structured brief form
│   ├── BriefGeneratorAI.tsx          ← Natural-language prompt textarea
│   ├── CreativeGallery.tsx           ← Staggered masonry gallery
│   └── PipelineProgress.tsx          ← Stage progress bar
│
├── lib/                              ← Core logic
│   ├── pipeline/                     ← ZERO framework deps
│   │   ├── promptBuilder.ts          ★ 5-layer template (the star)
│   │   ├── imageGenerator.ts         ← DALL-E 3 + p-limit + abort
│   │   ├── retry.ts                  ← Exponential backoff with abort signal
│   │   ├── textOverlay.ts            ← Sharp + Canvas composite
│   │   ├── outputOrganizer.ts        ← Manifest + structured folders
│   │   └── pipeline.ts               ← Orchestrator
│   ├── api/                          ← Contract layer
│   │   ├── logEvents.ts              ← Structured event name constants
│   │   ├── services.ts               ← RequestLogger, getHealth, DI
│   │   ├── shutdown.ts               ← Isolated shutdown flag module
│   │   ├── errors.ts                 ← Typed error discriminants
│   │   └── timeouts.ts               ← Staggered timeout constants (120/135/300)
│   ├── ai/
│   │   └── agents.ts                 ← Multi-agent orchestrator (4 phases, 5 stakeholders)
│   └── storage/                      ← Factory: LocalStorage | S3Storage
│
├── __tests__/                        ← 250 tests / 16 files
├── docs/
│   ├── docker.md                     ← Full container reference
│   ├── aws-setup.md                  ← S3 provisioning guide
│   ├── adr/                          ← ADR-001 through ADR-008
│   └── architecture/                 ← orchestration.md, image-processing.md
├── examples/                         ← Demo campaigns + sample briefs
└── knowledge-base/                   ← Assessment context
```

---

## Where to dig deeper

- **[docs/docker.md](docs/docker.md)** — full container reference: design decisions, reverse-proxy config, observability event catalog, SIGTERM drain flow
- **[docs/aws-setup.md](docs/aws-setup.md)** — S3 bucket + IAM + CORS provisioning
- **[docs/adr/](docs/adr/)** — architectural decision records (ADR-001 through ADR-008)
- **[docs/architecture/](docs/architecture/)** — orchestration patterns, image processing spec
- **[knowledge-base/01-assessment/business-context.md](knowledge-base/01-assessment/business-context.md)** — the 5 stakeholders, production roadmap, why this matters
- **[examples/README.md](examples/README.md)** — walkthrough script for the 4 demo campaigns

---

## Credits

**Author:** Kevin Douglass
**Built with:** [Claude Code](https://claude.com/claude-code) (Opus 4.6) as a pair-programming collaborator — code generation, architecture review, multi-agent code review, documentation
**Role target:** Adobe Forward Deployed AI Engineer — Firefly team (via Conexess Group)
**Submission date:** 2026-04-12

**Notable inspirations**

- Adobe Firefly's [Content Credentials (C2PA)](https://www.adobe.com/products/firefly/features/content-credentials.html) — the production version of this pipeline would embed C2PA metadata in every generated asset
- The [Firefly Services API](https://developer.adobe.com/firefly-services/docs/) — where the image generation layer would sit in a production build targeting Adobe's ecosystem
