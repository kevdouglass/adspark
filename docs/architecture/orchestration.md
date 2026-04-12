# Pipeline Orchestration

> Architecture doc for AdSpark's creative generation pipeline.
> Covers workflow states, job lifecycle, retry policy, frontend updates, and production path.

---

## Pipeline State Machine

Every generation request transitions through these states:

```
SUBMITTED → VALIDATING → GENERATING → COMPOSITING → ORGANIZING → COMPLETE
                │              │             │              │
                └──────────────┴─────────────┴──────────────┘
                                     │
                                  FAILED
```

| State | What Happens | Can Fail? |
|-------|-------------|:-:|
| **SUBMITTED** | Request received, brief JSON parsed | No |
| **VALIDATING** | Schema validation, required fields check, asset existence check | Yes — malformed brief, missing required fields |
| **GENERATING** | DALL-E 3 API calls for missing assets (parallel, all ratios) | Yes — API errors, rate limits, content policy rejection |
| **COMPOSITING** | Text overlay on generated/resolved images via @napi-rs/canvas | Yes — font loading failure, image decode error |
| **ORGANIZING** | Save to S3 (cloud) or filesystem (local), generate URLs | Yes — S3 permission error, disk full |
| **COMPLETE** | All creatives generated, URLs returned to frontend | — |
| **FAILED** | Error captured, partial results preserved where possible | — |

### State Transitions in Code

The pipeline orchestrator (`lib/pipeline.ts`) manages state as a discriminated union:

```typescript
type PipelineState =
  | { status: 'submitted'; brief: CampaignBrief }
  | { status: 'validating'; brief: CampaignBrief }
  | { status: 'generating'; brief: ValidatedBrief; progress: GenerationProgress }
  | { status: 'compositing'; brief: ValidatedBrief; images: GeneratedImage[] }
  | { status: 'organizing'; creatives: Creative[] }
  | { status: 'complete'; result: PipelineResult }
  | { status: 'failed'; error: PipelineError; partialResult?: Partial<PipelineResult> }
```

---

## Job Lifecycle

### POC: In-Request Processing

For the assessment, the entire pipeline runs within a single Next.js API Route Handler:

```
POST /api/generate
  ├── Parse + validate brief          (~10ms)
  ├── Resolve assets (check S3/local) (~50ms)
  ├── Generate images via DALL-E 3    (~15-20s, parallelized)
  ├── Composite text overlays         (~500ms per image)
  ├── Organize + upload to S3         (~1-2s)
  └── Return result JSON              (~10ms)
```

**Total wall time:** ~20-25 seconds (within Vercel's 60s Hobby limit because image generation runs in parallel).

### Why Promise.all() Works for the POC

2 products × 3 aspect ratios = 6 images. DALL-E 3 takes 10-20s per image sequentially. But OpenAI allows concurrent requests (rate limit: 5 images/min on Tier 1, 7/min on Tier 2).

```typescript
// 6 images in parallel ≈ 15-20s wall time instead of 60-120s sequential
const images = await Promise.all(
  generationTasks.map(task => generateImage(task))
);
```

**Risk:** If the OpenAI account is on Tier 1 (5 img/min), 6 concurrent requests may hit the rate limit. Mitigation: `p-limit` to cap concurrency at 5, letting the 6th image queue behind the first to finish.

### Production: Queue-Based Processing

At production scale (hundreds of campaigns), in-request processing breaks down:

```
Frontend → POST /api/jobs → Job Queue (BullMQ + Redis) → Worker Pool → S3 → Webhook/SSE
```

| Component | POC | Production |
|-----------|-----|------------|
| Orchestrator | In-process, single request | BullMQ job queue + Redis |
| Workers | Same process (Promise.all) | Dedicated worker pool (separate service) |
| Status updates | Response on completion | SSE stream or webhook |
| Scaling | Single Vercel function | Horizontal worker scaling |
| Failure recovery | Return error, retry manually | Automatic retry with dead-letter queue |

---

## Retry Policy

### DALL-E 3 API Errors

| Error | Retry? | Strategy |
|-------|:-:|---------|
| 429 Rate Limit | Yes | Exponential backoff: 1s → 2s → 4s, max 3 attempts |
| 500 Server Error | Yes | Fixed delay: 2s, max 2 attempts |
| 400 Content Policy | No | Mark image as FAILED, surface to user, continue pipeline |
| 400 Invalid Request | No | Fail fast — this is a bug in our prompt builder |
| Network timeout | Yes | Retry once after 5s |

### Implementation

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelay = 1000, retryOn }: RetryConfig
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !retryOn(error)) throw error;
      await sleep(baseDelay * Math.pow(2, attempt - 1));
    }
  }
  throw new Error('Unreachable');
}
```

### Partial Failure Handling

The pipeline does NOT fail entirely if one image fails. If 5/6 images succeed and 1 hits a content policy rejection:

1. The 5 successful creatives are saved and returned
2. The failed image is flagged in the response with the error reason
3. The frontend shows the partial result with a "1 image failed — retry?" prompt
4. This is a better UX than "your entire campaign failed because one prompt was rejected"

---

## Frontend Update Policy

### POC: Optimistic UI with useReducer

The frontend dispatches state transitions as the API responds:

```
User clicks "Generate"
  → UI: "Validating brief..."        (immediate, optimistic)
  → UI: "Generating 6 images..."     (after validation response)
  → UI: "Compositing text overlays..." (after generation complete)
  → UI: "Done! View your creatives"  (final response)
```

For the POC, the API route returns the full result on completion. The frontend uses `useReducer` to manage loading states locally. No polling, no SSE — single request/response.

### Production: Server-Sent Events (SSE)

For longer jobs (50+ images, multi-campaign batch):

```typescript
// API route streams progress events
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    for await (const event of pipeline.run(brief)) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    }
    controller.close();
  }
});
return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
```

Frontend consumes via `EventSource` or `fetch` with streaming reader. Each event updates the D3 progress visualization in real time.

---

## Queue Model (Production Path)

Not implemented in the POC, but documented for interview defense and V2 planning:

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌─────────┐
│ Next.js   │────▶│ Redis     │────▶│ Worker Pool   │────▶│ S3      │
│ API Route │     │ (BullMQ)  │     │ (N instances)  │     │ Output  │
└──────────┘     └──────────┘     └──────────────┘     └─────────┘
      │                │                   │
      │           Job events          Completion
      │                │              webhook
      └────────────────┴──────────────────┘
                  SSE to frontend
```

| Queue Concern | Design |
|---------------|--------|
| Priority | FIFO default. Premium accounts get priority queue. |
| Concurrency | 3 workers per instance, limited by OpenAI rate tier |
| Dead letter | Failed jobs after 3 retries → DLQ for manual review |
| TTL | Jobs expire after 1 hour if unclaimed |
| Idempotency | Job ID = hash(brief + timestamp). Prevents duplicate generation. |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Promise.all() over sequential | 6 images fit within Vercel's 60s timeout when parallelized |
| No job queue in POC | Added complexity with no user-facing benefit at demo scale |
| Partial failure tolerance | Better UX; matches how production ad platforms handle batch generation |
| SSE for production (not WebSocket) | Unidirectional updates, no connection state, works with Vercel Edge |
| BullMQ + Redis for production queue | Industry standard, TypeScript-native, mature |
