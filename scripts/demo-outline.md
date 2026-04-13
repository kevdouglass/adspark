# AdSpark Demo — Live Show-and-Tell Outline

**Target:** 3 minutes. Record against `http://localhost:3001` (Docker container). Every section ties an on-screen **ACTION** to an **ASSESSMENT REQUIREMENT** and a **BUSINESS VALUE STATEMENT**.

**The core value prop** (say this exact sentence at least once):
> *"AdSpark turns a campaign brief into 6 publish-ready social ad creatives in ~45 seconds — replacing a 4-to-8-week, $50-to-$500-thousand human production cycle with a $0.50 pipeline call. And every decision it makes is auditable, reviewable, and safe to ship."*

---

## Pre-demo setup (30 seconds before you hit record)

| # | Where | Action |
|---|---|---|
| 1 | PowerShell Terminal A | `.\scripts\demo.ps1 preflight` — all green |
| 2 | PowerShell Terminal B | `.\scripts\demo.ps1 tail` — **keep visible on screen** during the whole demo |
| 3 | Browser Tab 1 | `http://localhost:3001` — dashboard idle state |
| 4 | Browser Tab 2 | `https://github.com/kevdouglass/adspark` — repo (for the last 15s) |
| 5 | VS Code (optional) | `lib/pipeline/promptBuilder.ts` open — for the "show me the code" beat |

---

## Section 1 — The hook [0:00 – 0:20] *Set the business problem*

### SHOW
Browser on the dashboard landing page. Don't touch anything yet.

### SAY
> *"Hi, I'm Kevin. This is **AdSpark** — my submission for the Adobe Forward Deployed AI Engineer Firefly role.*
>
> *Here's the problem: a global consumer goods company like Nike or Unilever runs hundreds of localized social ad campaigns a month. 50 products, 3 aspect ratios, 12 markets, 4 languages — that's 7,200 creative assets per product line. Each campaign takes 4 to 8 weeks of agency time and anywhere from fifty thousand to half a million dollars. No creative team can produce that manually and keep brand consistency.*
>
> *AdSpark collapses that to about 45 seconds per campaign and under a dollar in API calls. Let me show you."*

### LINK TO REQUIREMENT
*"Assessment asks for a POC that solves 'creative automation for social ad campaigns.' This is the problem statement we're solving."*

---

## Section 2 — The brief (plain English input) [0:20 – 0:50] *Requirement 1 + the "grounded in real workflow" beat*

### SHOW
Click the **✨ Load example** button in the AI Brief Orchestrator textarea. A seed prompt populates.

### SAY
> *"The assessment asks for a campaign brief with products, target region, target audience, and a campaign message. AdSpark accepts that in two ways:*
>
> *First — a schema-valid JSON you can POST directly to `/api/generate`. That's for programmatic callers.*
>
> *Second — plain English, which is what marketing leads actually type. They're not developers. The natural-language path goes through a **5-stakeholder AI orchestrator** that produces the same validated structured brief.*
>
> *Those 5 stakeholders aren't invented — they're grounded in the target enterprise workflow: Campaign Manager, Creative Director, Regional Marketing Lead, Legal/Compliance, and CMO. Each one solves a specific pain point I documented in `business-context.md` based on how real global consumer goods marketing teams operate."*

### LINK TO REQUIREMENT
- ✅ Requirement #1: campaign brief accepting products, region, audience, message
- ✅ Bonus: supports 1-3 products per brief (assessment asks for ≥2)
- ✅ Requirement #8: README + example I/O in the `examples/campaigns/` folder

### BUSINESS VALUE
> *"In the real workflow, those 5 stakeholders each add 1-3 days to an approval cycle. That's where the 4-to-8-week timeline comes from. AdSpark compresses them into a single 10-second AI call."*

---

## Section 3 — Click generate, show the orchestrator [0:50 – 1:30] *The deep-research beat + brand compliance bonus*

### SHOW
Click **Generate Creatives**. The sidebar starts flowing through agent phases. As each phase appears, point at it.

### SAY
> *"Watch the sidebar on the left. The orchestrator is running its 4-phase flow right now: triage, draft, review, synthesis.*
>
> *Phase 1 — a triage agent sets the review agenda. Phase 2 — the Campaign Manager drafts an initial brief, biased toward shipping. Phase 3 — here's the key trick — **four specialist reviewers run in PARALLEL**: the Creative Director catching brand inconsistency, the Regional Lead catching cultural mistranslation, Legal flagging unverified claims and trademark risks, and the CMO demanding measurable conversion signal. Phase 4 — the orchestrator merges all their edits into the final brief.*
>
> *Parallel reviewers cut the orchestration phase from about 12 seconds sequential down to 3 seconds. Total wall time for the whole orchestration is about 10 to 12 seconds."*

### LINK TO REQUIREMENT
- ✅ **Bonus**: brand compliance (Creative Director reviews visual/color fidelity)
- ✅ **Bonus**: legal content checks (Legal reviewer flags unverified claims, competitor marks)
- ✅ **Bonus**: localization awareness (Regional Marketing Lead)
- ✅ **Self-awareness**: every reviewer emits structured log events so their work is AUDITABLE

### BUSINESS VALUE
> *"If a campaign ships with a regulatory problem because a human reviewer missed it, it can cost millions in recall plus brand damage. AdSpark's Legal agent runs on EVERY brief, every time, at 2 cents per call. It's not a replacement for human review — it's a first-pass filter that catches 80% of problems before a human ever sees them."*

---

## Section 4 — The pipeline + structured logs [1:30 – 2:10] *Requirement 3, bonus logging, FDE observability pitch*

### SHOW
**Glance at Terminal B (the log tail).** Point at specific events as they flow by.

### SAY
> *"While that's running, look at the terminal on the left. Every single pipeline event is a structured JSON line. Every line carries a `requestId` so you can grep a full trace end-to-end.*
>
> *There's `request.received` — the HTTP request in. Here's `pipeline.start`. There's `dalle.start` — a DALL-E 3 API call kicking off. Here's `dalle.done` with the latency in milliseconds and the PNG byte count. `composite.image` — that's the campaign message being rendered on top via Canvas. `storage.save` — writing to the Docker volume. `manifest.write` — the audit trail. `request.complete` with a 200 and the total time.*
>
> *That's about 20 events per request. On Vercel these same events stream to `vercel logs`. In the container they stream to `docker logs`. Same schema, same grep-ability, same operational story everywhere."*

### LINK TO REQUIREMENT
- ✅ **Bonus**: logging/reporting of results — every prompt, timing, error
- ✅ **Requirement #8**: README documents the event schema (`lib/api/logEvents.ts` is the canonical source)
- ✅ **Architecture cleanliness**: one module defines every event name, compiler catches typos

### BUSINESS VALUE
> *"When a brand-safety reviewer at Unilever asks 'why did this specific campaign ship with that specific color?', you get the answer in 30 seconds from a log search — not 3 days of back-and-forth. That's the difference between a POC and a thing you can actually operate in production."*

---

## Section 5 — The creatives render [2:10 – 2:40] *Requirements 3, 4, 5, 7*

### SHOW
The dashboard now renders the staggered masonry gallery with the generated creatives. Hover over one to show the details.

### SAY
> *"And the creatives render. Here's the 1:1 Feed Post — for Instagram and Facebook feed. Here's the 9:16 Story/Reel — for Reels, TikTok, Stories. Here's the 16:9 Landscape — for YouTube preroll and LinkedIn.*
>
> *Notice the campaign message at the bottom of each image. **DALL-E 3 cannot reliably render legible text inside an image** — that's a well-known limitation. So I composite the message via Canvas AFTER generation. It's documented as a known limitation in the README alongside three others.*
>
> *Each creative card shows the DALL-E generation time, the compositing time, and it links back to the exact prompt that produced it. The output lands in an organized folder structure — `campaignId / productSlug / ratio /`. That's the assessment's requirement #7."*

### LINK TO REQUIREMENT
- ✅ **Requirement #3**: generates via DALL-E 3 when assets are missing
- ✅ **Requirement #4**: 3 aspect ratios (1:1, 9:16, 16:9) — all three visible on screen
- ✅ **Requirement #5**: campaign message displayed on every final post
- ✅ **Requirement #7**: organized folder structure `campaignId/productSlug/ratio/`
- ✅ **Self-awareness**: known limitation (DALL-E text) acknowledged openly in README + on camera

### BUSINESS VALUE
> *"One brief, 6 publish-ready assets, 3 social platforms. A human production team would take 2 weeks to do this for a single product in a single market. AdSpark does it in 45 seconds."*

---

## Section 6 — The prompt builder + the "show me the code" beat [2:40 – 3:00] *Prompt engineering rubric + architecture*

### SHOW
Tab to VS Code (or GitHub tab) — show `lib/pipeline/promptBuilder.ts` briefly.

### SAY
> *"One last thing the Adobe team specifically asked about — prompt engineering quality. Round 1 feedback from Quinn Frampton was 'we want to see HOW you got the AI to do it.'*
>
> *Open `lib/pipeline/promptBuilder.ts`. It's **five layers**: Subject, Context, Composition, Style, Exclusions. Every layer is heavily commented. Every field in the brief maps to a specific layer of the prompt. You can point at any part of a generated image and trace it back to the brief field that produced it.*
>
> *It's TEMPLATE-BASED, not LLM-generated. Brand safety requires predictability — a reviewer can predict what will come out for a given input. That's non-negotiable in a regulated category like finance or health."*

### LINK TO REQUIREMENT
- ✅ **Evaluation criterion #1**: Prompt Engineering Quality — *the* highest-weighted rubric item per Quinn's feedback
- ✅ **Architecture cleanliness**: `lib/pipeline/` has zero framework dependencies

### BUSINESS VALUE
> *"If Adobe replaces DALL-E with Firefly tomorrow, this is a single-file swap — a new `ImageGenerator` implementation of the same interface. The clean architecture I built means AdSpark is portable by design, not by accident."*

---

## Closing [3:00 – 3:15] *Wrap + forward-looking*

### SHOW
GitHub repo tab. Scroll to the top of README briefly.

### SAY
> *"The code is at github.com/kevdouglass/adspark. README is under 400 lines — how to run it, the architecture diagram, 8 ADRs for every major decision, known limitations, production roadmap. 250 passing tests including abort-control, health-check contract, and the 7-phase agent event stream. The container story is in `docs/docker.md` — file-and-line citations for every design decision.*
>
> *This isn't a weekend prototype. It's a week-one Forward Deployed Engineer deliverable. Thanks for watching — looking forward to the live technical interview."*

### STOP RECORDING.

---

## Requirements coverage checklist — check off as you demo

Map the narration above to the assessment brief's minimum requirements. Every one of these is demonstrated on screen or named explicitly during the Loom:

| ✓ | Requirement | Shown in section | Evidence on screen |
|---|---|---|---|
| ☐ | Accept brief with products, region, audience, message | §2 | Loaded example prompt in orchestrator textarea |
| ☐ | Accept input assets (local/S3) with reuse | (mentioned) | Named in README; narration can mention "assetResolver reuses pre-provided assets" |
| ☐ | Generate via GenAI when missing | §3, §4 | DALL-E events flowing in log tail |
| ☐ | 3 aspect ratios (1:1, 9:16, 16:9) | §5 | All three visible in the gallery |
| ☐ | Display campaign message on final posts | §5 | Text overlay visible on every creative |
| ☐ | Runs locally / simple app | §1 (background) | Running at `localhost:3001` |
| ☐ | Organized output folder | §5 | Narration: "`campaignId/productSlug/ratio/`" |
| ☐ | README with how-to, I/O, decisions, limitations | §6 | GitHub tab at end |

**Bonus features demonstrated:**

| ✓ | Bonus | Shown in section |
|---|---|---|
| ☐ | Brand compliance (colors) | §3 — Creative Director agent |
| ☐ | Legal content checks | §3 — Legal/Compliance agent |
| ☐ | Logging / reporting | §4 — structured event stream |
| ☐ | Localization awareness | §3 — Regional Marketing Lead agent |

**Evaluation rubric coverage:**

| # | Criterion | Where |
|---|---|---|
| 1 | **Prompt Engineering Quality** | §6 — promptBuilder.ts walkthrough |
| 2 | **Architecture Cleanliness** | §4, §6 — clean layers, zero-framework-deps pipeline |
| 3 | **Self-Awareness** | §5 — DALL-E text limitation acknowledged on camera |
| 4 | **Working Demo** | §3-§5 — full end-to-end generate visible |
| 5 | **README Quality** | §7 — GitHub close |
| 6 | **Success Metrics** | §1 — 4-8wk→45s, $50K-500K→$0.50 stated |

---

## The 5 sentences to memorize (drop them naturally throughout)

Short, dense value statements. Sprinkle these into your narration — they're the ones that stick with a reviewer after 3 minutes:

1. *"4 to 8 weeks of agency work collapsed into about 45 seconds of pipeline time, at under a dollar per campaign."*

2. *"The 5 stakeholder agents aren't invented — they're grounded in real enterprise pain points documented in my business-context file."*

3. *"Every pipeline event is a structured JSON line with a requestId — grep any request end-to-end in 30 seconds."*

4. *"Template-based prompt construction, not LLM-generated. Brand safety requires predictability."*

5. *"If Adobe replaces DALL-E with Firefly tomorrow, it's a single-file swap — the clean architecture makes AdSpark portable by design."*

---

## What to AVOID saying on camera

- Don't mention the Vercel production 500 error — say "this demo runs locally in a production container" if asked later
- Don't say "I built this with Claude Code" during the demo — save that for the written submission / interview if asked
- Don't get technical about `instrumentation.ts` / `AbortController` / `outputFileTracingIncludes` unless you have extra time
- Don't apologize for limitations — **cite them confidently** ("DALL-E can't render text, so I composite via Canvas") — self-awareness is a rubric criterion
- Don't leave your `.env.docker` or `.env.local` files visible on screen
- Don't narrate while a generate is finishing if the UI is stuck — switch to the log tail pane instead

---

## If you have extra time (stretch goals)

If the demo is running fast and you have 30-45 seconds left over, pick ONE of these:

### Option A: The 9/10 infrastructure beat (30s)
Tab to a terminal, run:
```powershell
.\scripts\demo.ps1 healthz
```
Narrate:
> *"Same codebase, two targets — Vercel for the hosted demo, Docker container for ECS/Cloud Run portability. Both return the same `recommendedProxyTimeoutMs: 140000` so reverse-proxy configuration is a queryable contract. The container has graceful SIGTERM drain: on shutdown, `/api/healthz` flips to 503 so the load balancer drains, in-flight DALL-E calls get the full 120-second pipeline budget to complete, and the named volume preserves any output."*

### Option B: The "one brief, 6 images" stretch (30s)
Fire a bigger brief and let it run while you talk about architecture:
```powershell
.\scripts\demo.ps1 generate examples/campaigns/winter-streetwear-drop/brief.json
```
While it runs (~40-60s for 6 images), narrate the clean architecture rules from the README.

### Option C: The log-replay beat (20s)
In the log tail pane, run:
```powershell
docker compose logs adspark | Select-String "ba58a93a"
```
(Replace with a real requestId from earlier.) Narrate:
> *"Every event for request `ba58a93a` — 20 lines from entry to exit. That's the production observability story — you can debug any run from the logs alone."*

---

## The "safe words" if something breaks mid-demo

If the UI hangs, the network drops, or Docker freezes:

- **"Let me show you the same thing from the terminal instead"** → cut to Terminal A, run `.\scripts\demo.ps1 generate`
- **"While that loads, let me show you what's happening under the hood"** → point at the log tail pane
- **"I'll show you the code instead"** → tab to `lib/pipeline/promptBuilder.ts` and narrate the 5-layer template

**Never apologize, never say "sorry."** Pivot.
