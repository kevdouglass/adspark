# Natural-language seed prompt

A seed prompt for the AI brief orchestrator (`/api/orchestrate-brief`) that
produces a structured brief closely matching `brief.json`. Use this as the
input to `BriefGeneratorAI` when demoing the natural-language entry path.

## Paste into the dashboard

```text
We're running a summer 2026 sun-protection launch for Coastal Wellness Co. Two products: the SPF 50 Mineral Sunscreen — reef-safe, zinc-oxide, water-resistant 80 minutes, broad spectrum — and the After-Sun Cooling Aloe Gel, which is organic aloe vera with vitamin E and cucumber extract. The campaign message is "Stay Protected All Summer". Target is North American health-conscious adults 25 to 45, outdoor and beach lifestyle. Tone should be warm, coastal, trustworthy, premium but approachable. I need all three aspect ratios — 1:1, 9:16, and 16:9.
```

## Notes on the reuse path

The natural-language orchestrator does NOT currently know about the seed
asset library — it will produce a brief with `existingAsset: null` on both
products. To exercise the reuse branch via the orchestrator path, manually
edit Product 1's `existingAsset` field to `"spf-50-sunscreen.webp"` after
the orchestrator finishes refining the brief, or submit `brief.json`
directly via the structured form.

Wiring the orchestrator to the asset library is a planned production
improvement — see the roadmap section in the main README.
