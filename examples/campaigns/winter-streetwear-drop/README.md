# Winter Streetwear Drop — Northgrid

| | |
|---|---|
| **Vertical** | Technical streetwear / outerwear |
| **Brief** | [`brief.json`](./brief.json) |
| **Generated prompts** | [`prompts.md`](./prompts.md) |
| **AI Orchestrator seed prompt** | [`seed-prompt.md`](./seed-prompt.md) |
| **Products** | 2 |
| **Aspect ratios** | 1:1, 9:16, 16:9 |
| **Total images per run** | 6 |
| **Tone** | moody, editorial, high-contrast, premium streetwear, cold blue-grey palette |
| **Season** | winter |

## What this brief is designed to demonstrate

**Parallel generation across products × aspect ratios.** Two products × three
ratios = six DALL-E calls. The orchestrator (`lib/pipeline/pipeline.ts`)
fans these out through `p-limit` so they run concurrently while staying inside
the staggered timeout budget (`lib/api/timeouts.ts`).

This is the example to show when the reviewer asks **"how does the pipeline
handle batches?"** Open `prompts.md` and note that all six prompts are produced
deterministically — same builder, same brief fields, no LLM-in-the-loop for
prompt generation. The randomness is downstream in DALL-E.

## Run it

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/winter-streetwear-drop/brief.json
```

## Talking points

1. **Concurrency budget.** Point at `pipeline.ts` and walk the timeout cascade:
   per-image DALL-E call → orchestrator (~50s) → API client (~55s) → Vercel
   60s hard cap. Each layer fails *before* the layer above it surfaces an
   opaque platform timeout.
2. **Editorial tone vs. clinical tone.** Compare this brief's tone field to
   `fall-coffee-launch` — same builder, totally different mood injection.
   Tone field is the lever.
3. **Color palette as accent guidance.** `#1B2838` and `#3B3F45` (cold steel
   tones) flow into the prompt and harmonize with the `winter` seasonal mood
   (`cool blue tones, cozy indoor or snowy outdoor setting`).
