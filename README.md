# AdSpark — Creative Automation for Social Ad Campaigns

**Brief in, 6 campaign-ready social ad creatives out, ~45 seconds.**

AdSpark is a creative automation pipeline for enterprise marketing teams. It turns a structured campaign brief into platform-ready ad creatives across multiple aspect ratios using DALL-E 3 for image generation, `@napi-rs/canvas` for text compositing, and a multi-agent orchestrator for brief refinement. Designed as a **week-one Forward Deployed Engineer deliverable** — not a toy.

> Built for the **Adobe Forward Deployed AI Engineer — Firefly team** take-home assessment (Apr 2026). Live defense-ready. See the [Evaluation Criteria](#evaluation-criteria) section below for how each rubric point is addressed.

---

## Table of Contents

- [What problem this solves](#what-problem-this-solves)
- [Quick demo](#quick-demo)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start (local)](#quick-start-local)
- [Full setup](#full-setup)
- [Example brief (input) + output](#example-brief-input--output)
- [AWS S3 setup (for hosted deploy)](#aws-s3-setup-for-hosted-deploy)
- [Multi-agent brief orchestrator](#multi-agent-brief-orchestrator)
- [Prompt engineering — the star component](#prompt-engineering--the-star-component)
- [Design decisions + ADRs](#design-decisions--adrs)
- [Evaluation criteria](#evaluation-criteria)
- [Known limitations + self-critique](#known-limitations--self-critique)
- [Production considerations](#production-considerations)
- [Project structure](#project-structure)
- [Commands reference](#commands-reference)
- [Credits](#credits)

---

## What problem this solves

A global consumer goods company (think P&G, Unilever, Nike, L'Oréal) runs **hundreds of localized social ad campaigns per month** across 100+ countries. Each campaign requires creative assets in multiple sizes, languages, and market-specific variants.

**Today this process is manual, expensive, and slow:**

| Stage | Time | Cost |
|---|---|---|
| Creative agency designs hero assets | 1-2 weeks | $50K-500K |
| Production team creates 50-100 variants | 1-2 weeks | included |
| Legal / compliance review | 3-5 days | ongoing |
| Regional team approval | 3-5 days | ongoing |
| Media upload | 1-2 days | ongoing |
| **Total** | **4-8 weeks** | **$50K-500K per campaign** |

At scale: **50 products × 3 ratios × 12 markets × 4 languages = 7,200 assets**. No creative team can produce that manually and maintain brand consistency.

**With AdSpark:**

```
Campaign Brief (JSON or natural language)
  → AI Brief Orchestrator (~10s)      [5 stakeholder agents refine the brief]
  → Brief Parser (~1s)                [Zod schema validation]
  → Asset Resolver (~1s)              [local/S3 lookup + reuse]
  → Prompt Builder (~1s)              [template-based, auditable]
  → DALL-E 3 Image Generator (~25s)   [parallel, p-limit 5]
  → Text Overlay (~3s)                [Sharp resize + Canvas composite]
  → Output Organizer (~3s)            [manifest.json + structured folders]
  → 6 campaign-ready creatives
```

**Total: ~45 seconds. Cost: ~$0.50 in API calls per campaign.**

What used to take 4-8 weeks of agency work now takes less than a minute. [See the full business context →](knowledge-base/01-assessment/business-context.md)

---

## Quick demo

> **Loom walkthrough:** *[2-3 min screen recording — link to be added on submission]*

**What the demo shows:**
1. Landing on the dashboard → AI Brief Orchestrator textarea visible, "How it works" idle state
2. Typing a natural-language description ("Launch a premium line of reusable glass food containers...")
3. Clicking **Generate Creatives** → sidebar shows cascading stakeholder agent phases (*Orchestrator triaging → Campaign Manager drafting → Creative Director, Regional Lead, Legal, CMO reviewing in parallel → Synthesizing*)
4. Form atomically repopulates with the AI-refined brief
5. DALL-E pipeline runs → staggered masonry gallery renders 6 creatives (2 products × 3 ratios)
6. Each creative shows the campaign message composited at the bottom, with aspect-ratio labels (Feed Post / Story-Reel / Landscape) and per-image generation times

---

## Architecture

### The pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js App Router, React 19, Tailwind v4)                  │
│  ┌──────────────────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │  BriefGeneratorAI    │   │   BriefForm    │   │ CreativeGallery  │  │
│  │  (NL prompt input)   │   │  (react-hook-  │   │  (masonry grid)  │  │
│  │                      │   │   form + Zod)  │   │                  │  │
│  └──────────┬───────────┘   └────────┬───────┘   └────────▲─────────┘  │
│             └───────────────┬────────┘                    │            │
│                             ▼                             │            │
│                    usePipelineState hook                  │            │
│                   (reducer + submissionId)                │            │
└─────────────────────────────┬────────────────────────────┬─────────────┘
                              │                            │
                              ▼                            │
                  POST /api/orchestrate-brief              │ POST /api/generate
                              │                            │
                              ▼                            │
┌─────────────────────────────────────────────────────────┐ │
│  Multi-Agent Brief Orchestrator (lib/ai/agents.ts)      │ │
│                                                          │ │
│    Phase 1: Triage          (1 OpenAI call)             │ │
│    Phase 2: Draft           (Campaign Manager agent)    │ │
│    Phase 3: Review          (4 parallel reviewers:      │ │
│                              Creative Director,          │ │
│                              Regional Marketing Lead,    │ │
│                              Legal / Compliance,         │ │
│                              CMO)                        │ │
│    Phase 4: Synthesis       (orchestrator merge call)   │ │
└─────────────────────────────┬────────────────────────────┘ │
                              │                              │
                              ▼                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Core Pipeline (lib/pipeline/ — ZERO framework deps)                   │
│                                                                         │
│  Brief Parser    →  Asset Resolver  →  Prompt Builder*  →  Image Gen   │
│  (Zod schema)       (local/S3       →   (*THE STAR)        (DALL-E 3,  │
│                      lookup,             template-based    p-limit 5,  │
│                      reuse path)         5-layer prompt)   partial     │
│                                                            failure)    │
│                                                             │           │
│                                                             ▼           │
│                                              Text Overlay → Output     │
│                                              (Sharp resize  (manifest, │
│                                               + Canvas       org'd     │
│                                               composite)     folders)  │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Storage Abstraction (lib/storage/)                                     │
│                                                                         │
│    StorageProvider interface                                            │
│         ├── LocalStorage  (./output/ on disk — dev default)            │
│         └── S3Storage     (AWS S3 + pre-signed URLs — production)      │
└────────────────────────────────────────────────────────────────────────┘
```

### Clean architecture — dependency direction

```
React UI → API Routes → Pipeline ← Storage
                           ↓
                     Zero framework deps
```

**Absolute rules** (enforced by file structure and import discipline):

- **Pipeline layer** (`lib/pipeline/`) has ZERO framework dependencies. No Next.js, no React, no AWS SDK. Pure TypeScript functions that take data and return data.
- **Storage layer** (`lib/storage/`) implements interfaces defined in `lib/pipeline/types.ts`. Domain defines the contract; infrastructure fulfills it (dependency inversion).
- **API routes** (`app/api/`) are thin. Parse request, call pipeline, map errors to HTTP, return response. No business logic.
- **React components** consume API responses through a typed client (`lib/api/client.ts`). Never call the pipeline directly.

This means **swapping any infrastructure piece is a new implementation of an existing interface, not a rewrite.** DALL-E → Firefly? New `ImageGenerator` implementation. S3 → Azure Blob? New `StorageProvider` implementation. Next.js → Python FastAPI? Copy `lib/pipeline/` verbatim and wrap it in a different HTTP layer.

---

## Tech stack

| Category | Tool | Why |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | JD-preferred stack, full-stack in one codebase, one-click Vercel deploy for a clickable reviewer URL |
| **Language** | TypeScript (strict mode) | Type safety across pipeline + frontend, alignment with JD |
| **UI** | React 19 + Tailwind v4 | Dashboard with brief form, progress UI, creative gallery. Tailwind v4 uses CSS custom properties for theming (Firefly palette lives in `app/globals.css`) |
| **State management** | `useReducer` + Context | Discriminated-union state machine (idle → submitting → generating → complete/error) with stable-event IDs to drop stale async dispatches. See [ADR-004](docs/adr/ADR-004-frontend-state-management.md) |
| **Form state** | `react-hook-form` + `@hookform/resolvers/zod` | Same Zod schema validates client AND server via `z.infer` |
| **Image generation** | OpenAI DALL-E 3 | Best quality + simplest API for POC. *In production, I'd evaluate Firefly to stay within the Adobe ecosystem and Creative Cloud licensing.* |
| **AI orchestrator** | OpenAI gpt-4o-mini (JSON mode) | 4-phase multi-agent brief refinement (5 stakeholder agents) — fast (~10s wall), cheap (~$0.02/call), grounded in [business-context.md](knowledge-base/01-assessment/business-context.md) |
| **Image processing** | [Sharp](https://sharp.pixelplumbing.com/) + [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) | Sharp for resize/crop/format conversion; Canvas for rich text compositing with word-wrapping and accent bars |
| **Schema validation** | [Zod](https://zod.dev/) | Single source of truth for request body validation — server AND client share the same schema. See [ADR-005](docs/adr/ADR-005-runtime-schema-validation-zod.md) |
| **Storage** | AWS S3 (production) + local filesystem (dev) | Pluggable `StorageProvider` interface. Pre-signed URLs for S3 (24hr TTL) mean the frontend never holds AWS credentials |
| **Testing** | [Vitest](https://vitest.dev/) | Fast, TypeScript-native, vite-compatible. 206 tests across 11 files: pipeline, orchestrator, API routes, state reducer, timeouts, files route, etc. |
| **Deployment** | Vercel (one-click) | Auto-deploys on push via GitHub integration. Preview URLs per branch for stakeholder review |

---

## Quick start (local)

**Prerequisites:** Node 20+, npm, an OpenAI API key.

```bash
# 1. Clone + install
git clone https://github.com/kevdouglass/adspark.git
cd adspark
npm install

# 2. Configure your OpenAI key
cp .env.example .env.local
# Open .env.local and set OPENAI_API_KEY=sk-proj-...

# 3. Run
npm run dev
# → http://localhost:3000
```

Click a sample brief (Adobe Firefly / Nike / Summer Suncare) in the sidebar → click **Generate Creatives** → the pipeline runs and the gallery renders in 30-50 seconds depending on your OpenAI Tier.

**Tier 1 note:** DALL-E 3 Tier 1 accounts are capped at ~5 images/minute. The 6-image demo brief may take ~50 seconds wall-clock on Tier 1. Tier 2+ accounts see ~25-30s. This is documented more in the [Known Limitations](#known-limitations--self-critique) section.

---

## Full setup

### Required environment variables

```bash
OPENAI_API_KEY=sk-proj-...    # Required — DALL-E 3 + gpt-4o-mini
STORAGE_MODE=local            # Default — use ./output/ on disk
```

### Optional (for hosted deploy with persistent image serving)

```bash
STORAGE_MODE=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=adspark-demo-2026
S3_REGION=us-east-1
```

See the [AWS S3 setup](#aws-s3-setup-for-hosted-deploy) section below for the full provisioning guide.

### Vercel deployment

If the GitHub repo is connected to Vercel, every push auto-deploys a preview URL:

1. Go to the Vercel dashboard → your AdSpark project → **Settings → Environment Variables**
2. Add `OPENAI_API_KEY` (and optionally the S3 vars) to both **Preview** and **Production** scopes
3. Push to a branch → Vercel builds automatically
4. Pull request gets a preview URL in the checks section

---

## Example brief (input) + output

### Input — `examples/campaign-brief.json`

```json
{
  "campaign": {
    "id": "summer-2026-suncare",
    "name": "Summer Sun Protection 2026",
    "message": "Stay Protected All Summer",
    "targetRegion": "North America",
    "targetAudience": "Health-conscious adults 25-45",
    "tone": "vibrant, trustworthy, active lifestyle",
    "season": "summer"
  },
  "products": [
    {
      "name": "SPF 50 Mineral Sunscreen",
      "slug": "spf-50-mineral-sunscreen",
      "description": "Reef-safe mineral sunscreen with non-nano zinc oxide. Broad spectrum SPF 50 with 80-minute water resistance.",
      "category": "sun protection",
      "keyFeatures": [
        "reef-safe zinc oxide",
        "80-minute water resistance",
        "fragrance-free formula"
      ],
      "color": "#F4A261",
      "existingAsset": null
    },
    {
      "name": "After-Sun Aloe Gel",
      "slug": "after-sun-aloe-gel",
      "description": "Cooling aloe vera gel with vitamin E and chamomile extract. Soothes post-sun skin and locks in hydration.",
      "category": "skincare",
      "keyFeatures": [
        "organic aloe vera",
        "vitamin E enriched",
        "dermatologist-tested"
      ],
      "color": "#2A9D8F",
      "existingAsset": null
    }
  ],
  "aspectRatios": ["1:1", "9:16", "16:9"],
  "outputFormats": { "creative": "png", "thumbnail": "webp" }
}
```

### Output — folder structure

```
output/
└── summer-2026-suncare/
    ├── manifest.json                           ← audit trail: every prompt, timing, and error
    ├── brief.json                              ← the validated input that generated this run
    ├── spf-50-mineral-sunscreen/
    │   ├── 1x1/
    │   │   ├── creative.png     (1080×1080)
    │   │   └── thumbnail.webp   (400×400)
    │   ├── 9x16/
    │   │   ├── creative.png     (1080×1920)
    │   │   └── thumbnail.webp   (225×400)
    │   └── 16x9/
    │       ├── creative.png     (1200×675)
    │       └── thumbnail.webp   (400×225)
    └── after-sun-aloe-gel/
        └── (same structure)
```

`manifest.json` records **every DALL-E prompt**, generation + compositing times, storage paths, and any partial-failure errors. It is the audit trail a brand safety reviewer can grep.

### Output — response body

The API route returns a typed `GenerateSuccessResponseBody`:

```json
{
  "campaignId": "summer-2026-suncare",
  "creatives": [
    {
      "productName": "SPF 50 Mineral Sunscreen",
      "productSlug": "spf-50-mineral-sunscreen",
      "aspectRatio": "1:1",
      "dimensions": "1080x1080",
      "creativePath": "summer-2026-suncare/spf-50-mineral-sunscreen/1x1/creative.png",
      "thumbnailPath": "summer-2026-suncare/spf-50-mineral-sunscreen/1x1/thumbnail.webp",
      "creativeUrl": "https://adspark-demo.s3.amazonaws.com/...?X-Amz-Signature=...",
      "thumbnailUrl": "https://adspark-demo.s3.amazonaws.com/...?X-Amz-Signature=...",
      "prompt": "Professional product photography of SPF 50 Mineral Sunscreen...",
      "generationTimeMs": 18432,
      "compositingTimeMs": 284
    }
  ],
  "totalTimeMs": 45230,
  "totalImages": 6,
  "errors": [],
  "requestId": "a1b2c3d4-..."
}
```

`creativeUrl` is populated in S3 mode (pre-signed 24hr URL); `creativePath` is always populated for both modes.

---

## AWS S3 setup (for hosted deploy)

The default `STORAGE_MODE=local` writes creatives to `./output/` on disk. **This does NOT work on serverless hosting** (Vercel, Netlify, AWS Lambda) because each function invocation runs in an isolated sandbox — files written by `/api/generate` are gone by the time `/api/files/[...path]` tries to read them.

For any hosted deploy, switch to `STORAGE_MODE=s3` and follow this provisioning guide.

### 1. Create the S3 bucket

```bash
aws s3 mb s3://adspark-demo-2026 --region us-east-1
```

Or via the AWS console: **S3 → Create bucket**. Pick a globally unique name. Leave "Block all public access" **ON** — we use pre-signed URLs, not public reads.

### 2. Configure CORS on the bucket

The browser fetches creatives via pre-signed URLs (not through your Next.js domain), so the bucket needs a CORS policy allowing GET from your deployment domain:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://adspark-*.vercel.app",
      "https://your-production-domain.com"
    ],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

Apply via console: **Bucket → Permissions → Cross-origin resource sharing (CORS) → Edit**.

### 3. Create an IAM user with scoped permissions

Create an IAM user (e.g., `adspark-deploy`) with programmatic access. Attach this minimal inline policy — it grants access only to the specific bucket, nothing more:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AdSparkS3Access",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::adspark-demo-2026/*"
    },
    {
      "Sid": "AdSparkS3List",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::adspark-demo-2026"
    }
  ]
}
```

Generate an access key pair for this user. **Copy the access key ID and secret immediately** — AWS won't show the secret again.

### 4. Set the environment variables

**Locally** (`.env.local`):

```bash
STORAGE_MODE=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=adspark-demo-2026
S3_REGION=us-east-1
```

**On Vercel** (Dashboard → Settings → Environment Variables → add the same five vars to both Preview and Production scopes). Push a commit to redeploy.

### 5. Verify

```bash
# Local check
STORAGE_MODE=s3 npm run dev
# Submit a brief in the browser → check bucket for uploaded objects:
aws s3 ls s3://adspark-demo-2026/ --recursive
```

### How the storage abstraction works

Every pipeline call site uses the `StorageProvider` interface — it has no knowledge of which backend is active:

```typescript
// lib/pipeline/outputOrganizer.ts
await storage.save(key, buffer, "image/png");
const url = await storage.getUrl(key);
```

The factory at `lib/storage/index.ts` reads `STORAGE_MODE` at request time and returns the appropriate implementation:

- `STORAGE_MODE=local` → `LocalStorage` (writes to `./output/`, serves via `/api/files/[...path]` route with path-traversal protection)
- `STORAGE_MODE=s3` → `S3Storage` (uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` to mint 24hr pre-signed URLs; frontend never touches AWS credentials)

**Swapping storage backends is a config change, not a code change.**

---

## Multi-agent brief orchestrator

One of the key features: users can describe a campaign in plain English, and a team of 5 specialist AI agents refines the description into a production-ready structured brief before the DALL-E pipeline even starts.

**The stakeholders are grounded in the real enterprise workflow** documented in [business-context.md](knowledge-base/01-assessment/business-context.md) — the five users the business context explicitly calls out as "the 5 users who care":

| Agent | Real-world stakeholder pain | What they review |
|---|---|---|
| **Campaign Manager** | *"I need 200 localized variants by Friday and my agency quoted 3 weeks."* | Drafts the initial brief. Biased toward shipping. |
| **Creative Director** | *"The Bangalore team cropped the logo off the 9:16 version."* | Visual/creative direction. Ensures descriptions are VISUAL enough for DALL-E to render. |
| **Regional Marketing Lead** | *"The US message doesn't resonate in Japan."* | Cultural/regional fit. Challenges Western defaults. |
| **Legal / Compliance** | *"Someone used a competitor's trademark in the Brazil campaign."* | Catches unverified claims, competitor references, regulated-category cues. |
| **CMO** | *"We spend $12M/year on creative production. I can't tell what drives conversions."* | ROI/conversion signal. Specificity, measurability. |

### The 4-phase orchestration flow

```
User prompt → POST /api/orchestrate-brief
                  │
                  ▼
   ┌──── Phase 1: Triage ────────┐
   │  Orchestrator LLM decides    │   (1 OpenAI call, ~2s)
   │  per-agent review priorities │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──── Phase 2: Draft ─────────┐
   │  Campaign Manager drafts the │   (1 OpenAI call, ~3s)
   │  initial brief from prompt   │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──── Phase 3: Review ────────┐
   │  4 reviewers in parallel:    │
   │   ├─ Creative Director        │   (4 parallel OpenAI calls,
   │   ├─ Regional Marketing Lead  │    ~3s wall time)
   │   ├─ Legal / Compliance       │
   │   └─ CMO                      │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──── Phase 4: Synthesis ─────┐
   │  Orchestrator merges all     │   (1 OpenAI call, ~3s)
   │  reviewer edits → final brief│
   └──────────────┬───────────────┘
                  │
                  ▼
          Schema-validated brief
                  │
                  ▼
          Frontend form.reset()
                  │
                  ▼
          POST /api/generate (pipeline runs)
```

**~10-12s total wall time** for the orchestration (parallel reviewers cut what would be 12s sequential down to 3s), followed by the normal ~30-50s DALL-E pipeline.

### Partial-failure tolerance

Each phase has its own failure mode:

- **Triage fails:** orchestration continues with default priorities (reviewers still run)
- **Draft fails:** the whole orchestration fails — the draft is the foundation
- **A reviewer fails:** logged, excluded from synthesis input. The other 3 still contribute.
- **Synthesis fails:** fall back to the draft brief (which is already schema-valid)

Every phase re-validates the LLM output with the same `campaignBriefSchema` as the runtime gate — structural invalid output is rejected before it can reach the pipeline. See [ADR-008 — Testing Strategy for LLM-Generated Outputs](docs/adr/ADR-008-testing-llm-generated-outputs.md) for the full non-determinism + testing story.

### Lite RAG: static corpus as few-shot examples

The 4-phase orchestrator uses **context-augmented generation** rather than a bare prompt:

- The draft agent's system prompt embeds **all 3 sample briefs** from `lib/briefs/sampleBriefs.ts` as reference examples — quality-bar grounding via few-shot learning
- The user's current form state (if any) is passed as `existingBrief` so intentional manual edits are preserved
- The system prompt includes a **distilled marketing-image-brief best practices block** (10 actionable directives for writing briefs that translate to great DALL-E output)

Adding new sample briefs automatically expands the reference corpus — no code change needed. See `lib/ai/agents.ts` for the full implementation and `docs/adr/ADR-008` for the non-determinism tradeoffs.

---

## Prompt engineering — the star component

Per Adobe Round 1 feedback (Quinn Frampton): *"We're interested in HOW he got the AI to do it — show us in your code where the prompt is generated."*

`lib/pipeline/promptBuilder.ts` is designed to be read front-to-back. It uses a **five-layer prompt template** with every layer heavily commented:

| Layer | Purpose | Example |
|---|---|---|
| **Subject** | Product identity — name, description, key features, brand color | *"SPF 50 Mineral Sunscreen, a reef-safe mineral sunscreen with non-nano zinc oxide..."* |
| **Context** | Audience + region + tone + season mood | *"For health-conscious adults 25-45 in North America, vibrant trustworthy tone, summer mood"* |
| **Composition** | Aspect-ratio-specific layout guidance | *"Vertical composition for Stories/Reels. Position product in upper two-thirds, leave space at bottom for text overlay."* |
| **Style** | Photography direction — lighting, color grading, quality markers | *"Professional product photography, natural lighting, editorial quality"* |
| **Exclusions** | What to keep out of the image | *"No text, no logos, no watermarks"* |

Every prompt is:

1. **Template-based** (not LLM-generated) — reviewers can predict what will come out for a given input. Brand safety requires predictability.
2. **Traceable** — every field in the brief maps to a specific layer of the prompt. You can point at any part of a generated image and show which brief field produced it.
3. **Category-aware** — `isLifestyleCategory()` routes lifestyle categories (sportswear, skincare, beauty) to prompts with *"people may appear naturally"* while product categories (software, beverage) get *"no humans in the scene"*. This avoids generic stock-photo lifestyle shots when they don't fit the product.
4. **Aspect-ratio-aware** — the composition layer differs per ratio because DALL-E doesn't know how the image will be used downstream.
5. **Output-stable** — `temperature: 0.8` for creativity but with a rigid prompt template, we get variation in surface detail while the structure stays consistent.

Read the module comments for the full design rationale and future improvements (A/B testing per category, brand-profile-driven style tokens, prompt versioning).

---

## Design decisions + ADRs

Every significant architectural decision is captured as an ADR in `docs/adr/`:

| ADR | Topic | TL;DR |
|---|---|---|
| [ADR-001](docs/adr/ADR-001-nextjs-full-stack-typescript.md) | Next.js full-stack TypeScript | Framework choice + tech stack defense |
| [ADR-002](docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md) | Direct SDK over MCP | Why the pipeline uses OpenAI SDK directly, not MCP |
| [ADR-003](docs/adr/ADR-003-typed-error-cause-discriminants.md) | Typed error cause discriminants | Compile-time exhaustive error → HTTP status mapping |
| [ADR-004](docs/adr/ADR-004-frontend-state-management.md) | Frontend state management | `useReducer` + Context + submissionId stale-event guards |
| [ADR-005](docs/adr/ADR-005-runtime-schema-validation-zod.md) | Runtime schema validation (Zod) | Single source of truth for client + server validation |
| [ADR-006](docs/adr/ADR-006-api-wire-format-parallel-shapes.md) | API wire format parallel shapes | Explicit mappers over structural aliases — review gate for wire contract |
| [ADR-007](docs/adr/ADR-007-dashboard-page-as-client-component.md) | Dashboard as client component | Why `page.tsx` is `"use client"` |
| [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md) | Testing LLM-generated outputs | 4-layer strategy for non-deterministic systems (structural → property → golden fixtures → LLM-as-judge) |

---

## Evaluation criteria

Mapping the assessment rubric to what's in this repo:

| # | Criterion | Where it lives |
|---|---|---|
| **1** | **Prompt Engineering Quality** | `lib/pipeline/promptBuilder.ts` — 5-layer template system, heavily commented, auditable. Plus `lib/ai/agents.ts` multi-agent orchestrator with stakeholder-specific system prompts grounded in modern best practices. |
| **2** | **Architecture Cleanliness** | Clean architecture layering — `lib/pipeline/` has zero framework deps, `lib/storage/` is pluggable, `app/api/` is thin. See [Architecture](#architecture) section. |
| **3** | **Self-Awareness** | [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md) explicitly engages with the "how do you test non-deterministic LLMs" question. [Known Limitations](#known-limitations--self-critique) section below lists what's weak. |
| **4** | **Working Demo** | Localhost runs in 3 commands. Multi-agent orchestrator → DALL-E pipeline → staggered masonry gallery with real creatives. Loom video on submission. |
| **5** | **README Quality** | This document. Architecture diagrams, how to run, every design decision linked to an ADR, honest limitations. |
| **6** | **Success Metrics** | See the "What problem this solves" section — 4-8 weeks → 45 seconds, $50K-500K → $0.50, 6 → 7,200 assets via config change. |

---

## Known limitations + self-critique

**What I know is weak — and what I would do with more time.**

### DALL-E 3 specific

- **Text rendering is unreliable.** DALL-E 3 cannot reliably render legible text inside images. That's why we composite the campaign message via `@napi-rs/canvas` AFTER generation, not inside the prompt. A production version would A/B test Imagen 3 and Flux for scenes where short brand text matters.
- **Hex color adherence is weak.** DALL-E 3 interprets color hex codes inconsistently. Brief `color: "#F4A261"` doesn't reliably produce an image dominated by warm coral. Production fix: a color-name translation library that converts hex to human-readable names (*"warm coral orange"*) before injection.
- **Tier 1 rate limit (5 img/min) bites.** A 6-image brief runs as `[wave 1: 5 images in parallel, wave 2: 1 image]` — total ~40-50s wall time on Tier 1. Tier 2+ is ~25-30s. See [ADR-001](docs/adr/ADR-001-nextjs-full-stack-typescript.md) and the pipeline timeout stagger in `lib/api/timeouts.ts`.

### Brief orchestrator specific

- **Non-determinism is a known hard problem.** The orchestrator runs ~6 OpenAI calls producing a JSON brief. We've shipped **layer 1 (Zod schema validation at runtime)** as the authoritative safety net, plus [ADR-008](docs/adr/ADR-008-testing-llm-generated-outputs.md) + spike ticket [#57](https://github.com/kevdouglass/adspark/issues/57) for layers 2-4 (property tests, golden fixtures, LLM-as-judge). This is an unsolved problem industry-wide, not a unique AdSpark gap.
- **No semantic quality testing today.** Layer 4 (LLM-as-judge) is planned but deferred — ADR-008 explicitly considers whether it earns its cost before committing.
- **Orchestrator adds ~10s to the user's wait.** A production version might make this opt-in, or cache orchestration results by prompt hash.

### Scope-bounded for the POC

- **English only.** The assessment brief says localization is a bonus. Architecture supports it — a translation API between brief parser and prompt builder is a new pipeline stage, not a rewrite. See ADR-001 risks section.
- **No A/B test framework.** The manifest captures everything needed to run A/B tests (prompts, timings, creative variants) but there's no UI or analytics integration.
- **No brand-triage agent yet.** The planned "brand profile" layer (see `docs/architecture/brand-triage-agent.md`) would make every creative hyper-specific to a given client's visual identity. Onboarding a new client would be adding a JSON brand profile, not rewriting code. Deferred to post-assessment roadmap.
- **No `existingAsset` UI yet.** The pipeline supports asset reuse (`assetResolver.ts` checks for pre-provided images), but the BriefForm doesn't have an upload control. ADS-013 in the ticket plan. Would be the demo "money shot" — *"if the user already has brand-approved imagery, AdSpark respects it and only uses GenAI to fill the gaps."*

### What I'd do differently if I could restart

1. **Start with the brand-triage agent, not the pipeline.** The brand profile is what makes AdSpark differentiated from a toy. Building it last means the samples feel generic.
2. **Pin DALL-E model snapshots from day one.** Testing against `dall-e-3` (floating) vs `dall-e-3-2024-01-15` (pinned) is the difference between stable regression testing and chasing your tail.
3. **Ship the observability dashboard with the first creative.** The manifest has the data but there's no live visualization. A simple D3 pie chart of *"where did the time go?"* per stage would sell the production story better than any README paragraph.

---

## Production considerations

**This is the POC roadmap to production** — week-by-week from where this code sits today.

| Week | Focus | What lands |
|---|---|---|
| **1** | Pilot with client | This POC, running against the client's brand guidelines in Kevin's laptop |
| **2** | Enterprise auth + Firefly | Replace DALL-E with Adobe Firefly API + Adobe IMS authentication |
| **3** | Brand Triage Agent | Multi-tenant brand context — one JSON per client, injected into every pipeline stage |
| **4** | Advanced dashboard | D3 metrics, brand compliance scoring, generation history, manifest search |
| **5** | S3 + CDN + Content Credentials | Production delivery, C2PA content provenance for AI transparency |
| **6** | A/B testing + analytics | Variant tracking, conversion signal, feedback loop into prompt refinement |

See [business-context.md — Production Mapping](knowledge-base/01-assessment/business-context.md) for the full line-by-line justification.

### Security + secrets (current state)

- **Zero client-side secret exposure.** No `NEXT_PUBLIC_*` env vars carry keys. All secrets live in server-side route handlers only.
- **Vercel encrypts env vars at rest (AES-256).** Injected into function invocations only, never into the client bundle.
- **`.env.local` is gitignored.** Verified via `git log` — only `.env.example` (placeholder template with empty values) has ever been in the repository.
- **S3 uses pre-signed URLs with 24hr expiry.** The frontend never holds AWS credentials. See [ADR-002](docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md) encryption section.
- **IAM policy is minimal** — the example in the [AWS S3 Setup](#aws-s3-setup-for-hosted-deploy) section grants access to exactly one bucket, nothing more.
- **Path traversal protection on `LocalStorage`** — any user-derived string used in `path.join()` is validated against the base directory prefix (`safePath()` in `lib/storage/localStorage.ts`).
- **Content policy errors are propagated, not silenced.** DALL-E 400 rejections surface as typed `PipelineError` with `cause: "content_policy"` so the UI can surface actionable messages instead of a generic crash.

---

## Project structure

```
adspark/
├── README.md                         ← you are here
├── CLAUDE.md                         ← agent persona config
├── package.json                      ← Node.js + deps
├── tsconfig.json                     ← strict TypeScript config
├── next.config.ts                    ← Next.js configuration
├── .env.example                      ← env template (copy to .env.local)
│
├── app/                              ← Next.js App Router
│   ├── page.tsx                      ← Dashboard (client component)
│   ├── layout.tsx                    ← Root layout
│   ├── globals.css                   ← Firefly theme tokens
│   └── api/                          ← API route handlers
│       ├── generate/route.ts         ← POST — runs pipeline, returns creatives
│       ├── orchestrate-brief/route.ts ← POST — multi-agent brief refinement
│       ├── files/[...path]/route.ts  ← GET — local-mode file server (with path traversal protection)
│       ├── upload/route.ts           ← POST — pre-signed S3 URL for asset upload
│       └── campaigns/[id]/route.ts   ← GET — fetch campaign results
│
├── components/                       ← React UI
│   ├── BriefForm.tsx                 ← 651-line structured brief form
│   ├── BriefGeneratorAI.tsx          ← Natural-language prompt textarea
│   ├── CreativeGallery.tsx           ← Staggered masonry gallery
│   ├── DashboardIdleState.tsx        ← Empty-state hero
│   ├── PipelineProgress.tsx          ← Progress bar + stage display
│   └── providers/AppProviders.tsx    ← Client-side provider boundary
│
├── lib/                              ← Core logic (framework-agnostic)
│   ├── pipeline/                     ← Pipeline modules (ZERO framework deps)
│   │   ├── briefParser.ts            ← Zod validation
│   │   ├── assetResolver.ts          ← Local/S3 lookup + reuse
│   │   ├── promptBuilder.ts          ← ⭐ 5-layer template system (the star)
│   │   ├── imageGenerator.ts         ← DALL-E 3 API, p-limit parallel
│   │   ├── retry.ts                  ← Exponential backoff helper
│   │   ├── textOverlay.ts            ← Sharp + @napi-rs/canvas compositing
│   │   ├── outputOrganizer.ts        ← Manifest + structured folders
│   │   ├── pipeline.ts               ← Orchestrator (the "glue")
│   │   └── types.ts                  ← Domain types (no Next.js/React)
│   ├── api/                          ← API contract layer
│   │   ├── types.ts                  ← Parallel wire-format types
│   │   ├── client.ts                 ← Typed fetch wrapper
│   │   ├── errors.ts                 ← Typed error discriminants
│   │   ├── mappers.ts                ← Domain → wire projections
│   │   ├── services.ts               ← Per-request dependency injection
│   │   └── timeouts.ts               ← Staggered timeout constants (50/55/60)
│   ├── ai/
│   │   └── agents.ts                 ← Multi-agent brief orchestrator
│   ├── hooks/
│   │   └── usePipelineState.tsx      ← State machine hook (ADR-004)
│   ├── briefs/
│   │   └── sampleBriefs.ts           ← 3 demo briefs, schema-validated at module load
│   └── storage/
│       ├── index.ts                  ← Factory: S3Storage | LocalStorage
│       ├── localStorage.ts           ← ./output/ filesystem implementation
│       └── s3Storage.ts              ← AWS S3 with pre-signed URLs
│
├── __tests__/                        ← Vitest test suite (206 tests / 11 files)
│   ├── pipeline.test.ts              ← End-to-end pipeline tests
│   ├── promptBuilder.test.ts         ← Prompt builder (P0 — most evaluated)
│   ├── imageGenerator.test.ts        ← DALL-E 3 with mocked responses
│   ├── textOverlay.test.ts           ← Canvas compositing
│   ├── outputOrganizer.test.ts       ← Storage provider integration
│   ├── apiClient.test.ts             ← Frontend API client
│   ├── generateRoute.test.ts         ← API route handler
│   ├── filesRoute.test.ts            ← Path traversal defenses
│   ├── pipelineReducer.test.ts       ← State machine reducer
│   ├── timeouts.test.ts              ← Stagger invariants
│   └── fixtures/                     ← Shared test data
│
├── docs/                             ← Architecture docs + ADRs
│   ├── adr/                          ← Architecture decision records (ADR-001 to ADR-008)
│   ├── architecture/                 ← orchestration.md, image-processing.md, deployment.md
│   └── TICKET-PLAN.md                ← 24-ticket decomposition plan
│
├── knowledge-base/                   ← Assessment context (partially gitignored)
│   └── 01-assessment/
│       ├── assessment-brief.md       ← The full take-home requirements
│       └── business-context.md       ← Why this matters, 5 stakeholders, production story
│
├── examples/                         ← Sample campaign briefs
│   └── campaign-brief.json
│
└── output/                           ← Local dev output (gitignored)
```

---

## Commands reference

```bash
# Development
npm run dev          # Next.js dev server on http://localhost:3000
npm run build        # Production build (what Vercel runs)
npm run start        # Run the production build locally
npm run lint         # ESLint + Next.js rules

# Type checking
npm run type-check   # tsc --noEmit — strict TypeScript, no emit

# Testing
npm run test         # Vitest watch mode
npm run test:run     # Vitest single run (use in CI / pre-commit)

# Run a single test file
npx vitest run __tests__/promptBuilder.test.ts

# Run tests matching a name
npx vitest run -t "builds 1:1 prompt"

# Storage mode toggle (affects dev server behavior)
STORAGE_MODE=local npm run dev   # Default — writes to ./output/
STORAGE_MODE=s3 npm run dev      # Requires AWS_* env vars set
```

### Pre-merge local gate

```bash
npm run type-check && npm run test:run && npm run lint
```

CI will enforce the same gate when GitHub Actions is wired up (currently there are no `.github/workflows/` — deferred).

---

## Credits

**Author:** Kevin Douglass
**Built with:** [Claude Code](https://claude.com/claude-code) (Opus 4.6) as a pair-programming collaborator for code generation, architecture review, and documentation
**Target submission:** Adobe Forward Deployed AI Engineer — Firefly team (via Conexess Group)
**Submission date:** 2026-04-12

### Notable inspirations

- Adobe Firefly's [Content Credentials (C2PA)](https://www.adobe.com/products/firefly/features/content-credentials.html) — the production version of this pipeline would embed C2PA metadata in every generated asset
- The [Firefly Services API](https://developer.adobe.com/firefly-services/docs/) — where the image generation layer would go in a production build targeting Adobe's ecosystem
- Wieden+Kennedy, Droga5, R/GA — the agency "voice" that shaped the multi-agent orchestrator's system prompts

---

*Brief in, 6 campaign-ready assets out, 45 seconds. That's AdSpark.*
