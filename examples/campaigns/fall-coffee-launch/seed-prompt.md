# Seed prompt — Ember Roast (fall coffee launch)

Paste this text into the **AI Brief Orchestrator** input field on the dashboard,
then click **Generate Creatives**. The 4-phase orchestration will refine it into
a structured brief similar to [`brief.json`](./brief.json) (the LLM is
non-deterministic so the output will vary slightly run-to-run — that's expected
and a good talking point).

```
Launch Ember Roast, our small-batch single-origin Ethiopia Yirgacheffe coffee, for specialty coffee enthusiasts in their 30s and 40s in the Pacific Northwest who appreciate origin storytelling and slow craft. Tasting notes are bright citrus, jasmine florals, and a honey finish — roasted weekly in Portland, sold in compostable bags. Tone is warm, artisanal, and intimate, leaning into golden-hour cinematic and the slow-living aesthetic. This is a fall launch. Tagline idea: "Roasted slow. Drink it slower."
```

## Demo talking points

- **Demonstrates natural-language → structured-brief refinement** without
  the user having to know the schema. Compare the seed prompt above with the
  resulting brief.json — note how the orchestrator extracted `season: fall`,
  `targetRegion: Pacific Northwest`, `tone`, and a 140-char-safe campaign
  message.
- **Shows the 4-phase orchestration UI** — Triage → Draft → Review (4 parallel
  reviewers) → Synthesis. Each phase label appears in the input area while it
  runs. The Creative Director, Regional Lead, Legal, and CMO reviewers run in
  parallel during the Review phase.
- **Compare against the static brief.** Pre-filled `brief.json` is faster but
  inflexible; orchestrator path is slower (~10–12s) but lets a marketer use
  their own words. Both code paths converge on the same DALL-E pipeline.
