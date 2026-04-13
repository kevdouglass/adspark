# Summer Festival Energy Drink — Voltcraft

| | |
|---|---|
| **Vertical** | Beverage / festival lifestyle |
| **Brief** | [`brief.json`](./brief.json) |
| **Generated prompts** | [`prompts.md`](./prompts.md) |
| **AI Orchestrator seed prompt** | [`seed-prompt.md`](./seed-prompt.md) |
| **Products** | 2 |
| **Aspect ratios** | 1:1, 9:16, 16:9 |
| **Total images per run** | 6 |
| **Tone** | high-energy, neon, electric, night-scene cinematic, vibrant gradients, motion-blur kinetic |
| **Season** | summer |

## What this brief is designed to demonstrate

**Most visually distinctive output — the demo closer.** This brief deliberately
uses high-saturation hex colors (`#00E0FF`, `#FF2EC4`) and an energetic tone
descriptor that pushes DALL-E away from the safer studio/lifestyle defaults
toward neon, motion, and night-scene compositions.

It's the example to end the live walkthrough on because:

1. The output is the *most visibly different* from the other briefs
2. It proves the prompt builder isn't biased toward beige product photography
3. It pairs well with a question like *"could this run a real campaign?"* —
   the answer is "yes, look how far the tone field can push the output"

## Run it

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/summer-festival-energy-drink/brief.json
```

## Talking points

1. **Tone as the creative lever.** *"high-energy, neon, electric, night-scene
   cinematic"* is doing most of the heavy lifting in the prompt — the
   `summer` seasonal mood (`warm golden-hour sunlight, vibrant outdoor
   setting`) is overridden in spirit by the campaign tone. Show in
   `prompts.md` how both end up in the final prompt and let DALL-E reconcile.
2. **Bold brand colors as brand-safety guardrails.** Hex colors aren't just
   decoration — they constrain the palette DALL-E samples from. A reviewer
   who cares about brand consistency will appreciate that this is auditable.
3. **Beverage category routing.** `category: "energy drink"` is NOT in the
   lifestyle allow-list, so the prompt enforces "no human faces" — even though
   real festival ads usually have crowds. Note this as a *deliberate POC
   choice* (face generation is risky for brand safety) and a candidate for
   the "future improvements" section of the README.
