# Fall Coffee Launch — Ember Roast

| | |
|---|---|
| **Vertical** | Specialty coffee / DTC craft brand |
| **Brief** | [`brief.json`](./brief.json) |
| **Generated prompts** | [`prompts.md`](./prompts.md) |
| **AI Orchestrator seed prompt** | [`seed-prompt.md`](./seed-prompt.md) |
| **Products** | 1 |
| **Aspect ratios** | 1:1, 9:16, 16:9 |
| **Total images per run** | 3 |
| **Tone** | warm, artisanal, intimate, slow-living, golden-hour cinematic |
| **Season** | fall |

## What this brief is designed to demonstrate

**Tone fidelity in the prompt builder.** This brief uses an unusually rich tone
descriptor — *"warm, artisanal, intimate, slow-living, golden-hour cinematic"* —
combined with the `fall` seasonal mood (`rich warm earth tones, amber and golden
light, rustic textured backgrounds`). The same product schema with a clinical or
neon tone would produce a totally different image.

This is the example to show when the reviewer asks **"how much does the tone
field actually matter?"** Open `prompts.md` next to `lib/pipeline/promptBuilder.ts`
and trace `campaign.tone` → Layer 2 (Context) of the assembled prompt.

## Run it

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/fall-coffee-launch/brief.json
```

## Talking points

1. **Single-product, single-vertical.** Smallest demo footprint — fast feedback
   loop in a live walkthrough. ~3 images means a single DALL-E batch.
2. **Lifestyle category routing.** `category: "specialty coffee"` is NOT in the
   `isLifestyleCategory` allow-list, so the prompt builder appends *"No human
   faces. Clean product-focused composition only."* — point this out as
   evidence of category-aware composition guidance.
3. **Brand color injection.** `#6B3410` flows through to *"The product's brand
   color palette is #6B3410"* — auditable, traceable to the brief.
