# Spring Wellness Launch — Lumen

| | |
|---|---|
| **Vertical** | Skincare / clean beauty |
| **Brief** | [`brief.json`](./brief.json) |
| **Generated prompts** | [`prompts.md`](./prompts.md) |
| **AI Orchestrator seed prompt** | [`seed-prompt.md`](./seed-prompt.md) |
| **Products** | 3 |
| **Aspect ratios** | 1:1, 9:16, 16:9 |
| **Total images per run** | 9 |
| **Tone** | fresh, clean, dewy, soft-light studio, science-meets-botanical |
| **Season** | spring |

## What this brief is designed to demonstrate

**Stress test for the orchestrator and the gallery layout.** Three products ×
three ratios = nine DALL-E calls. This is the largest brief in the example
set and the one most likely to expose:

- A weak `p-limit` concurrency cap (you'd see one image trickle in at a time)
- A timeout budget that's tuned too tight (the slowest image fails first)
- Gallery layout regressions (the masonry view gets denser with 9 cards)

**Lifestyle-category routing in action.** All three products use
`category: "skincare ..."` which IS in the `isLifestyleCategory` allow-list,
so the prompt builder appends *"People may appear naturally in the scene but
should not be the primary focus — the product remains the hero."* — different
behavior than the coffee or streetwear briefs. Compare side by side in
`prompts.md`.

## Run it

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/spring-wellness-launch/brief.json
```

## Talking points

1. **The orchestrator under load.** This is the brief to use when the reviewer
   asks *"what happens when one of the nine generations fails?"* — point at
   the retry helper (`lib/pipeline/retry.ts`) and the typed error contract
   (`lib/api/errors.ts`, see ADR-003).
2. **Category-driven exclusion language.** The prompt builder switches its
   "no faces" exclusion to "people may appear naturally" based on category.
   This is one of the few branches in the otherwise template-deterministic
   builder — a good moment to defend it as *category-aware brand safety,
   not LLM creativity*.
3. **Three brand colors, three accent palettes.** `#F6C453` (gold), `#E8C4D0`
   (rose), `#A8D5BA` (mint). Each product gets a different palette while
   sharing the same campaign tone — showing how product-level and
   campaign-level fields compose.
