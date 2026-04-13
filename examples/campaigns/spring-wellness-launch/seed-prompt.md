# Seed prompt — Lumen (spring wellness launch)

Paste this text into the **AI Brief Orchestrator** input field on the dashboard,
then click **Generate Creatives**. The 4-phase orchestration will refine it into
a structured brief similar to [`brief.json`](./brief.json).

```
Launch Lumen's Spring Reset Collection — three skincare products for ingredient-conscious millennials and Gen X in North America and Europe who like clinical-but-natural brands. The lineup is a 15% L-ascorbic acid Vitamin C Brightening Serum with ferulic acid and vitamin E, a triple-weight Hyaluronic Hydration Mist with rose water and aloe in a recyclable aluminum bottle, and a 10% Niacinamide Pore Refining Cream with zinc PCA and green tea extract. Vegan, dermatologist-tested, fragrance-free where it matters. Tone is fresh, dewy, soft-light studio — science meets botanical. Spring launch. Tagline: "Wake up your skin. Spring starts here."
```

## Demo talking points

- **Three-product extraction.** This is the largest seed prompt and exercises
  the orchestrator's ability to enumerate distinct products from one
  paragraph. After Synthesis, you'll see three `Product` entries in the
  populated form — open the network tab to inspect the
  `/api/orchestrate-brief` response if a reviewer asks "what does the
  orchestrator actually return?"
- **Lifestyle category routing.** All three products land in
  `category: "skincare ..."`, which IS in the `isLifestyleCategory`
  allow-list inside `lib/pipeline/promptBuilder.ts`. The resulting prompts
  will append *"People may appear naturally in the scene but should not be
  the primary focus"* — different exclusion language than the coffee or
  streetwear demos. Compare side by side.
- **Stress test under load.** 3 products × 3 aspect ratios = 9 DALL-E calls
  after orchestration. Good moment to point at the `p-limit` concurrency cap
  and the staggered timeout budget.
- **Compliance angle for the Legal reviewer.** The seed mentions "vegan,
  dermatologist-tested, fragrance-free" — these are claims a real Legal
  reviewer would scrutinize. Explain that the Legal agent in the
  orchestration is grounded in this exact use case (see
  `lib/ai/agents.ts`).
