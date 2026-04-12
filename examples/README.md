# Examples — Briefs, Prompts, and Demo Campaigns

Sample inputs for the AdSpark pipeline. This folder is the **single
discoverable place** for any agent or human looking for example inputs:
schema-valid `CampaignBrief` JSON, the literal prompts each one produces,
and per-campaign talking points for the in-person walkthrough.

## Folder layout

```
examples/
├── README.md                    ← you are here (the index)
│
├── campaign-brief.json          ← legacy fixture (referenced from main README)
├── minimal-brief.json           ← legacy fixture (smallest valid brief)
├── two-image-brief.json         ← legacy fixture (two aspect ratios only)
│
├── brand-profiles/              ← brand identity fixtures
│
└── campaigns/                   ← demo / walkthrough campaigns (main attraction)
    ├── fall-coffee-launch/
    │   ├── brief.json           ← schema-valid input to POST /api/generate
    │   ├── seed-prompt.md       ← natural-language prompt for the AI Brief Orchestrator
    │   ├── prompts.md           ← literal DALL-E prompts produced from brief.json
    │   └── README.md            ← what this campaign demonstrates + talking points
    ├── winter-streetwear-drop/
    │   ├── brief.json
    │   ├── seed-prompt.md
    │   ├── prompts.md
    │   └── README.md
    ├── spring-wellness-launch/
    │   ├── brief.json
    │   ├── seed-prompt.md
    │   ├── prompts.md
    │   └── README.md
    └── summer-festival-energy-drink/
        ├── brief.json
        ├── seed-prompt.md
        ├── prompts.md
        └── README.md
```

**Convention:** every campaign folder under `campaigns/` has the same four
files — `brief.json`, `seed-prompt.md`, `prompts.md`, `README.md`. This is
intentional: an agent retrieving context can find any input by globbing
`examples/campaigns/*/brief.json` (or `seed-prompt.md`), and any human can
discover the same files by browsing the folder. There is no implicit
knowledge required.

## Two ways to run a campaign

The pipeline supports two entry points, and the `campaigns/` folder has an
artifact for each:

| Entry point | Input file | What it is | When to use it in the demo |
|---|---|---|---|
| **Direct (structured brief)** | `brief.json` | Hand-authored / pre-validated `CampaignBrief` JSON | Fastest path. Use when you want to skip the LLM orchestration and go straight to DALL-E. |
| **AI Brief Orchestrator** | `seed-prompt.md` | Free-text natural-language description (max 1000 chars) | Marketer-realistic path. Paste the seed prompt into the dashboard's "AI Brief Orchestrator" textarea, click **Generate Creatives**, and the 4-phase multi-agent flow (Triage → Draft → Review → Synthesis) refines it into a brief before the pipeline runs. |

The orchestrator path is the more impressive demo because it shows the
multi-agent stakeholder review (Campaign Manager + Creative Director +
Regional Lead + Legal + CMO), but it's slower (~10–12s before the pipeline
even starts). Use the direct path when you want to pace the walkthrough.

## Quick reference — where to find what

| I want to find... | Look here |
|---|---|
| All schema-valid brief JSONs | `examples/campaigns/*/brief.json` (and the legacy flat files) |
| Natural-language seed prompts for the AI Brief Orchestrator | `examples/campaigns/*/seed-prompt.md` |
| The literal DALL-E prompts each brief produces | `examples/campaigns/*/prompts.md` |
| Talking points for one campaign | `examples/campaigns/<name>/README.md` |
| The schema definition | `lib/pipeline/briefParser.ts` |
| The prompt builder source | `lib/pipeline/promptBuilder.ts` |
| The AI Brief Orchestrator UI | `components/BriefGeneratorAI.tsx` |
| The orchestration agent prompts | `lib/ai/agents.ts` |
| How `prompts.md` files are regenerated | `__tests__/regen-example-prompts.test.ts` |

## Demo campaigns — recommended walkthrough order

For a 2–3 minute live walkthrough, run them in this order. Each one shows
the reviewer something new:

| # | Folder | Products × Ratios = Images | Why this one |
|---|--------|----------------------------|--------------|
| 1 | `minimal-brief.json` (legacy) | 1×1 = 1 | Smallest valid brief — fast first run, proves end-to-end |
| 2 | `campaigns/fall-coffee-launch/` | 1×3 = 3 | Tone fidelity — rich tone field produces visibly different output |
| 3 | `campaigns/winter-streetwear-drop/` | 2×3 = 6 | Parallel generation — orchestrator + timeout cascade story |
| 4 | `campaigns/spring-wellness-launch/` | 3×3 = 9 | Stress test — gallery layout under load + lifestyle category routing |
| 5 | `campaigns/summer-festival-energy-drink/` | 2×3 = 6 | Visual closer — bold neon proves the builder isn't biased toward beige |

Open each campaign's `README.md` for the specific talking points and the
prompt traceability story.

## How to run a brief

**Via the dashboard form:** open `http://localhost:3000`, click *Load example*
in the brief form (or copy-paste the JSON), then submit.

**Via curl:**

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/fall-coffee-launch/brief.json
```

**Via the test runner** (validates the schema only — no DALL-E call):

```bash
npx vitest run __tests__/briefParser.test.ts
```

## How `prompts.md` files are generated

Each `prompts.md` is produced by importing the **real** `buildPrompt` from
`lib/pipeline/promptBuilder.ts` — never hand-written. This guarantees the
example artifacts can never drift from the actual builder. To regenerate
after editing the prompt builder or any brief:

```bash
REGEN_EXAMPLE_PROMPTS=1 npx vitest run __tests__/regen-example-prompts.test.ts
```

The regenerator is a vitest test guarded by an env var so it does NOT run
in normal `npm run test` invocations. See the file header for rationale.

## Talking points for the in-person walkthrough

When the reviewer asks **"where does the prompt come from?"** — open the
relevant `prompts.md` side-by-side with `lib/pipeline/promptBuilder.ts`. The
mapping from brief fields → prompt template is the most-scrutinized part of
the assessment, so make sure you can trace any one of these JSON files
through the builder out loud.

Suggested narration:

1. *"This is the brief — marketer-grade copy, validated by Zod at the door."*
2. *"The orchestrator pulls the brief through the prompt builder, which composes
   a deterministic, auditable prompt — and here is the literal output, checked
   into the repo as `prompts.md`. No LLM in the prompt construction path."*
3. *"DALL-E 3 returns one image per (product × aspect ratio). Sharp resizes,
   `@napi-rs/canvas` overlays the campaign message, S3 stores it, pre-signed
   URLs ship to the gallery."*
4. *"All of this is staged behind a timeout cascade so a slow DALL-E call
   surfaces a typed error instead of an opaque Vercel timeout."*

## Schema reference

The authoritative schema lives in `lib/pipeline/briefParser.ts`. Quick reference:

| Field | Type | Constraint |
|-------|------|------------|
| `campaign.id` | string | lowercase alphanumeric + hyphens (used in file paths) |
| `campaign.message` | string | ≤140 chars (text overlay limit) |
| `campaign.season` | enum | `summer` \| `winter` \| `spring` \| `fall` |
| `products[].slug` | string | lowercase alphanumeric + hyphens |
| `products[].color` | string | hex `#RRGGBB` |
| `products[].keyFeatures` | string[] | at least one |
| `aspectRatios` | enum[] | one or more of `1:1`, `9:16`, `16:9` |
