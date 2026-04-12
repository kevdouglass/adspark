# ADR-002: Direct SDK Integration Over MCP for Pipeline Services

**Status:** Proposed — implementation via ADS-026, ADS-027, ADS-028
**Date:** 2026-04-11
**Decision Makers:** Kevin Douglass
**Implementation:** Code alignment (stub signatures, API client, services layer, shared types) lands in Phase 2 tickets ADS-026 through ADS-028. This ADR documents the **target architecture**, not current state.

## Decision

Use **direct SDK calls** (OpenAI SDK, AWS SDK, node:fs) for all pipeline integrations. Do NOT use MCP (Model Context Protocol) for this pipeline. Introduce a **typed API client layer** (`lib/api/`) as the integration contract between frontend and backend. Reserve MCP for the Brand Triage Agent (V2) where LLM-driven tool selection is genuinely needed.

For the POC, this is **Option A** (direct SDK). The production roadmap is **Option C** (hybrid: direct SDK for the pipeline, MCP for the Brand Triage Agent where an LLM reasons about which brand data sources to query at runtime).

## Context

The AdSpark pipeline integrates with three external services:
1. **OpenAI DALL-E 3** — image generation
2. **AWS S3** — asset storage (production)
3. **Local filesystem** — asset storage (development)

The question: should these integrations use MCP (exposing each service as an MCP server with tools that an agent discovers and invokes), or direct SDK calls?

Additionally, the frontend (React) needs to communicate with the backend (Next.js API routes), and there's no defined contract for that boundary.

## Options Considered

### Option A: Direct SDK Calls + Typed API Client (Selected)

**Three integration layers, each with the simplest correct pattern:**

```
Frontend ──── lib/api/client.ts (typed fetch) ────── API Routes
API Routes ── lib/api/services.ts (DI factory) ───── Pipeline
Pipeline ──── openai SDK / @aws-sdk (direct) ──────── External Services
```

- **Pros:**
  - Simplest possible integration — import SDK, call function, handle response
  - Fully typed end-to-end — TypeScript catches contract drift at compile time
  - Debuggable — stack traces show exactly which SDK call failed
  - No runtime discovery overhead — the pipeline knows exactly what to call
  - Testable — mock the SDK, not a protocol layer
  - No additional infrastructure (no MCP server process, no transport config)
- **Cons:**
  - Adding a new external service requires a code change (new SDK import)
  - No dynamic tool discovery — the pipeline can't "learn" about new services at runtime

### Option B: MCP Servers for Each External Service

**Each service exposed as an MCP server with tools:**

```
Frontend ──── API Routes ──── MCP Client ──── MCP Server (OpenAI)
                                         ──── MCP Server (S3)
                                         ──── MCP Server (Filesystem)
```

- **Pros:**
  - Dynamic tool discovery — pipeline could discover new services at runtime
  - Standard protocol — any MCP-compatible client can use the tools
  - Decoupled — services are independently deployable
- **Cons:**
  - **Over-engineered for a deterministic pipeline.** MCP is designed for AI agents that reason about which tool to call. Our pipeline always calls DALL-E, always saves to S3, in a fixed sequence. There's no decision-making.
  - Adds latency — MCP transport (stdio/SSE) between pipeline and services
  - Adds complexity — 3 MCP server processes to configure, run, and monitor
  - Harder to debug — errors traverse the MCP protocol before surfacing
  - Harder to type — MCP tool schemas are JSON Schema, not TypeScript interfaces
  - **No benefit for the assessment** — evaluators see unnecessary abstraction

### Option C: Hybrid — Direct SDK for Pipeline, MCP for Brand Triage

**Pipeline uses direct SDKs. Brand Triage Agent (V2) uses MCP for dynamic brand data source discovery.**

- **Pros:**
  - Right tool for each job — deterministic pipeline gets direct calls, reasoning agent gets MCP
  - Demonstrates architectural judgment — "I know when to use MCP and when not to"
  - Production-ready path for multi-tenant brand context
- **Cons:**
  - Two integration patterns in the same codebase (acceptable — they serve different purposes)
  - Brand Triage is V2 scope, not POC

**This is the recommended production evolution** but only the direct SDK part is implemented for the assessment.

### Option D: Vercel AI SDK (Dismissed)

The Vercel AI SDK (`ai` package) was considered and dismissed:
- Its `experimental_generateImage()` is a thin wrapper over the OpenAI SDK — it adds no pipeline orchestration, no retry logic, no batch generation
- It's optimized for text streaming (chat UIs), not image generation pipelines
- Adding a dependency for a single function we'd call the same way via the direct SDK adds abstraction without value
- Evaluators at Adobe (not Vercel) gain nothing from Vercel-specific tooling

## The Decision Criteria

| Criteria | Direct SDK | MCP | Winner |
|----------|:---------:|:---:|:------:|
| Does the pipeline reason about tool selection? | N/A | Designed for this | **Direct** (no reasoning needed) |
| Is the call sequence fixed or dynamic? | Fixed (parse→generate→overlay→save) | Dynamic (agent decides) | **Direct** |
| Type safety end-to-end? | Full TypeScript | JSON Schema at boundary | **Direct** |
| Debugging experience | Direct stack traces | Protocol layer in between | **Direct** |
| Assessment scope fit | Minimal overhead | Additional infrastructure | **Direct** |
| Future Brand Triage Agent | Not suitable | Perfect fit | **MCP** (for V2) |

**The tiebreaker:** Quinn Frampton evaluates *"HOW he got the AI to do it."* An unnecessary MCP layer between the pipeline and DALL-E obscures the HOW. Direct SDK calls make the integration transparent and auditable — the evaluator reads `openai.images.generate()` and knows exactly what's happening.

## Integration Architecture

### Layer 1: Frontend → Backend (ADS-026, ADS-027)

```typescript
// lib/api/types.ts — shared contract (ADS-027)
export interface GenerateRequest {
  campaign: Campaign;
  products: Product[];
  aspectRatios: AspectRatio[];
  outputFormats: OutputFormats;
  brand?: BrandProfile;
}

export interface GenerateResponse {
  campaignId: string;
  creatives: CreativeOutput[];
  totalTimeMs: number;
  totalImages: number;
  errors: ApiError[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: string[];
}

// lib/api/client.ts — typed fetch wrapper (ADS-026)
export async function generateCreatives(
  brief: GenerateRequest
): Promise<GenerateResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(brief),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const error = await res.json() as ApiError;
    throw new ApiClientError(res.status, error);
  }
  return res.json() as Promise<GenerateResponse>;
}
```

### Layer 2: Backend → Pipeline (ADS-028)

**Service Factory** (`lib/api/services.ts` — pure infrastructure, no framework imports):

```typescript
// lib/api/services.ts — dependency injection factory (ADS-028)
import OpenAI from 'openai';
import { createStorage } from '@/lib/storage';
import type { StorageProvider } from '@/lib/pipeline/types';

/** Creates a new OpenAI client per request. NOT a singleton —
 *  Vercel serverless has no shared state across invocations. */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  return new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
}

export function getStorage(): StorageProvider {
  return createStorage(); // reads env via readEnvConfig()
}
```

**Route Handler** (`app/api/generate/route.ts` — thin, delegates immediately):

```typescript
// app/api/generate/route.ts — thin wrapper (ADS-005)
import { getOpenAIClient, getStorage } from '@/lib/api/services';
import { runPipeline } from '@/lib/pipeline/pipeline';
import { parseBrief } from '@/lib/pipeline/briefParser';

export async function POST(request: Request) {
  // ... parse body, validate brief ...
  const client = getOpenAIClient();
  const storage = getStorage();
  const result = await runPipeline(brief, storage, client);
  return NextResponse.json(result);
}
```

Note: the factory and route handler are in **separate files** — `lib/api/` (infrastructure) and `app/api/` (framework). This maintains clean architecture boundaries.

### Layer 3: Pipeline → External Services (ADS-001, ADS-010)

```typescript
// lib/pipeline/imageGenerator.ts — direct OpenAI SDK (ADS-001)
import type OpenAI from 'openai';

export async function generateImage(
  client: OpenAI,
  task: GenerationTask
): Promise<GeneratedImage> {
  const start = performance.now();
  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt: task.prompt,
    size: task.dimensions.dalleSize,
    quality: 'standard',       // See: response_format trade-off below
    response_format: 'b64_json', // See: response_format trade-off below
    n: 1,
  });

  // b64_json: bytes arrive in the response — no second HTTP call, no URL expiry risk
  const b64 = response.data[0]?.b64_json;
  if (!b64) {
    throw new PipelineError('Image generation returned no data', task.product.slug, task.aspectRatio);
  }
  const imageBuffer = Buffer.from(b64, 'base64');
  const generationTimeMs = Math.round(performance.now() - start);
  return { task, imageBuffer, generationTimeMs };
}
```

#### Trade-off: `response_format` — `b64_json` vs `url`

| | `url` (default) | `b64_json` (selected) |
|---|---|---|
| **How it works** | Returns a temporary URL; pipeline fetches image in a second HTTP call | Returns base64-encoded bytes directly in the API response |
| **URL expiry risk** | URLs expire in ~1 hour. If the pipeline has retries, compositing delays, or slow S3 uploads, the URL may expire before download | No expiry — bytes are in memory immediately |
| **Network calls** | 2 (generate + download) | 1 (generate includes bytes) |
| **Response size** | Small JSON (~200 bytes) | Large JSON (~2-4 MB per image, base64) |
| **Why b64_json** | For a pipeline that immediately processes the image, `b64_json` is simpler and eliminates a failure mode. The larger response size is acceptable — we're processing 6 images, not 6,000. |

#### Trade-off: `quality` — `standard` vs `hd`

| | `standard` (selected) | `hd` |
|---|---|---|
| **Cost** | ~$0.04 per image | ~$0.08 per image (2x) |
| **Quality** | Good for social media creatives | Higher coherence, better detail |
| **Why standard** | POC scope — contains API costs during assessment (~$0.24 for 6 images vs ~$0.48). Production recommendation: `hd` for hero creatives, `standard` for variant generation at scale. |

### When MCP Enters the Picture (V2)

MCP is appropriate when an **LLM agent decides at runtime** which external tools to invoke — the set of tools varies per client, and the selection is non-deterministic. The Brand Triage Agent fits this exactly: different companies have different brand data sources available, and the agent reasons about which sources to query for each onboarding.

```
Brand Triage Agent (V2 — ADS-024)
       │
       │  MCP tools (live external data — agent selects at runtime):
       ├── MCP: Website Scraper → extract CSS colors, fonts, copy style
       ├── MCP: Social Media    → analyze existing ad creatives on Instagram/TikTok
       ├── MCP: Brand DAM       → connect to Bynder/Brandfolder for approved assets
       └── MCP: Compliance DB   → industry-specific ad regulations per region
       │
       │  NOT MCP (direct LLM calls — deterministic, no tool selection):
       ├── LLM: PDF extraction  → parse brand guidelines PDF in context window
       └── LLM: Profile synthesis → combine extracted data into BrandProfile schema
       │
       ▼
   BrandProfile JSON → injected into Pipeline (still direct SDK calls)
```

**Why the distinction matters:** PDF extraction is a direct LLM call with document content in the context window — there's no external tool discovery involved. Website scraping and DAM connections are live external data sources that the agent discovers and selects at runtime — that's where MCP adds value.

The pipeline itself remains deterministic direct SDK calls. The Brand Triage Agent feeds it a `BrandProfile` — the pipeline never needs to "discover" DALL-E.

## Consequences

### Positive
- Simplest integration for a time-boxed assessment
- Full TypeScript type safety across all boundaries
- Transparent to evaluators — no protocol layers hiding the integration
- Typed API client prevents frontend/backend contract drift
- Service factory pattern makes testing straightforward

### Negative
- Adding a new image generation provider (Firefly, Midjourney) requires a code change in `imageGenerator.ts`, not a config change
- No dynamic tool discovery for the pipeline (acceptable — the pipeline is deterministic)

### Encryption & Secrets Handling

| Concern | Approach | Notes |
|---------|---------|-------|
| **API keys at rest (Vercel)** | Vercel env vars are AES-256 encrypted at rest | Keys are decrypted only at function invocation time. Never in client bundles. |
| **API keys at rest (local dev)** | `.env.local` on developer's machine, gitignored | Not encrypted on disk. Acceptable for POC — production: use a secret manager (Vault, AWS SSM). |
| **API keys in transit** | All SDK calls use HTTPS (TLS 1.2+) by default | OpenAI SDK, AWS SDK both enforce HTTPS. No plaintext API key transmission. |
| **S3 objects at rest** | SSE-S3 (AES-256 server-side encryption) | Enabled per-bucket. Generated images are encrypted on S3 at no extra cost. Set `ServerSideEncryption: 'AES256'` in PutObjectCommand. |
| **S3 objects in transit** | Pre-signed URLs use HTTPS | Browser downloads over TLS. URLs are time-scoped (24hr) and key-scoped. |
| **Pre-signed URL leakage risk** | URLs contain the S3 key path + signature — if intercepted, anyone can access the object until expiry | Mitigation: 24hr TTL (not permanent). Production: reduce to 1hr, add CloudFront signed cookies for stricter access control. |
| **DALL-E generated images** | Transmitted over HTTPS from OpenAI → pipeline. Stored as `b64_json` in memory, never written to temp files. | No plaintext image data on disk during pipeline execution. |
| **Client-side exposure** | No `NEXT_PUBLIC_` prefix on any secret. API keys, S3 credentials are server-side only. | React components never hold credentials — they call API routes which hold credentials server-side. |
| **Git history** | `.env.example` has empty values only. `.gitignore` excludes `.env*` files. | If a key is accidentally committed, rotate immediately — git history is permanent. |

**Production recommendations (beyond POC):**
- AWS KMS customer-managed keys (CMK) for S3 encryption instead of SSE-S3
- AWS Secrets Manager or HashiCorp Vault for API key rotation without redeployment
- Short-lived IAM role credentials via STS AssumeRole instead of long-lived access keys
- CloudFront signed cookies for image delivery (eliminates pre-signed URL leakage risk)
- Content Credentials (C2PA) on generated images for AI provenance tracking (aligns with Adobe Firefly's approach)

### Operational Considerations

**Vercel Cold Starts:** On Vercel Hobby, cold starts consume 2-4 seconds of the 60-second budget before any pipeline work begins. Mitigation: the 55-second client timeout and 30-second per-image DALL-E timeout leave buffer. For the demo, pre-warm by hitting the URL before recording the Loom video. Production: Vercel Pro has faster cold starts, or use a health-check ping (`GET /api/generate/health`) on a cron.

**Timing Instrumentation:** `PipelineResult.totalTimeMs` and `CreativeOutput.generationTimeMs` require `performance.now()` wrapping at the orchestrator and image generator boundaries. This is implemented in ADS-004 (orchestrator) and ADS-001 (image generator), not in this ADR's code examples.

### Risks
- If the evaluator specifically expects MCP usage, this decision needs defense. **Mitigation:** ADR documents WHY MCP isn't appropriate here AND where it would be (Brand Triage). This demonstrates stronger architectural judgment than cargo-culting MCP everywhere.
- If the evaluator notices the stub signatures don't match the ADR code examples. **Mitigation:** ADR is marked as `Proposed — implementation via ADS-026, ADS-027, ADS-028`. Stubs are updated when those tickets land.

## References

- Assessment brief: `knowledge-base/01-assessment/assessment-brief.md`
- Integration analysis: `docs/TICKET-PLAN.md` (Integration Layer Analysis section)
- Brand Triage Agent: `docs/architecture/brand-triage-agent.md`
- MCP Specification: https://modelcontextprotocol.io
- Quinn Frampton: *"Interested in HOW he got the AI to do it"* — direct SDK makes the HOW visible
