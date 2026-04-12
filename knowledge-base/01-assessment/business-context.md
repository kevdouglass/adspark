# Creative Automation Pipeline — Business Context

> **Adobe FDE Assessment** | Kevin Douglass | April 11, 2026
> Living document — appended as new insights are discovered during development.

---

## Why Creative Automation Matters

### The Problem You're Solving

A global consumer goods company (think P&G, Unilever, Nike, L'Oreal) runs **hundreds of localized social ad campaigns per month** across **100+ countries**. Each campaign requires creative assets in multiple sizes, languages, and market-specific variants.

Today, this process is manual, expensive, and slow:
- A single campaign takes **4-8 weeks** from brief to launch
- Costs **$50K-500K+** in creative production alone
- At scale: **50 products x 3 ratios x 12 markets x 4 languages = 7,200 assets**
- No creative team can produce that manually and maintain brand consistency

### The Current Workflow

```
Campaign Brief (1 day)
  → Creative Agency designs hero assets (1-2 weeks, $50K-500K)
  → Production Team creates 50-100 variants (1-2 weeks)
  → Legal/Compliance reviews each variant (3-5 days)
  → Regional Teams approve for their market (3-5 days)
  → Media Team uploads to ad platforms (1-2 days)

Total: 4-8 weeks per campaign
Cost:  $50K-500K+ per campaign
```

### With AdSpark

```
Campaign Brief (JSON)
  → Brief Parser (~1s)
  → Asset Resolver (~1s)
  → Prompt Builder (~1s)    ← THE CODE THEY WANT TO SEE
  → GenAI Image (~15s)
  → Resize + Overlay (~2s)
  → Output (6 assets)

Total: ~45 seconds
Cost:  ~$0.50 in API calls
```

> **Brief in, 6 campaign-ready assets out, ~45 seconds.** What used to take 4-8 weeks of agency work now takes less than a minute.

---

## The 5 Users Who Care

| User | Their Pain | Impact |
|------|-----------|--------|
| **Campaign Manager** | "I need 200 localized variants by Friday and my agency quoted 3 weeks." | Launch time: weeks → hours |
| **Creative Director** | "The Bangalore team cropped the logo off the 9:16 version." | Brand consistency enforced by pipeline |
| **Regional Marketing Lead** | "The US message doesn't resonate in Japan." | Culturally adapted, not just translated |
| **Legal / Compliance** | "Someone used a competitor's trademark in the Brazil campaign." | Automated checks before anything ships |
| **CMO** | "We spend $12M/year on creative production. I can't tell which variants drive conversions." | 10x variants at 1/10th cost = better ROI |

---

## Impact Numbers

| Metric | Before | After |
|--------|--------|-------|
| Time to Market | 4-8 weeks | 45 seconds |
| Cost Per Campaign | $50K-500K | ~$0.50 API calls |
| Asset Scale | 6 (manual) | 7,200 (config change) |
| A/B Testing Capacity | Limited by production cost | 10x more variants |

---

## Why Adobe Cares

Adobe's business is **creative tools** (Creative Cloud) and **enterprise marketing** (Experience Cloud). GenAI creative automation threatens traditional tools — if a pipeline generates campaign assets, why pay for Photoshop seats?

Adobe's answer: **own the automation layer.** That's Firefly. Forward Deployed Engineers go to enterprise clients and prove Firefly-powered automation works inside their workflow.

> **Your assessment simulates exactly this job:** Walk into a client, understand their creative production bottleneck, and build a GenAI pipeline that solves it.

---

## What Provides the Most Impact

### 1. Speed (Campaign Velocity) — #1 VALUE DRIVER
Brief in, 6 campaign-ready assets out, 45 seconds. Your demo should make this visceral — show the clock.

### 2. Scale Without Proportional Cost
Going from 6 to 7,200 assets is a config change in the brief, not a rewrite of the pipeline.

### 3. Brand Safety by Default
The "nice-to-have" bonus items (brand compliance, legal checks) are the features enterprise clients pay premium for. A CMO doesn't care about cool AI — they care that nothing embarrassing goes live.

### 4. Actionable Insights
If the pipeline tracks what was generated, timing, and reuse rates, the client can optimize. This justifies the ROI story.

---

## How to Frame Your Build

| Instead of saying... | Frame it as... |
|---------------------|----------------|
| "I used DALL-E because it was easy" | "I chose DALL-E for POC speed — in production, I'd evaluate Firefly to stay within Adobe's ecosystem and the client's Creative Cloud licensing" |
| "Here's my code" | "Here's the pipeline I'd walk a client through in week 1 of an engagement" |
| "It generates 6 images" | "It generates 6 images in 45 seconds — at the client's scale of 200 campaigns/month, this replaces 3 weeks of agency work per campaign" |
| "Known limitation: English only" | "Production roadmap: localization API between the brief parser and prompt builder enables multi-market support without changing the pipeline architecture" |
| "I used Next.js" | "I chose the JD-preferred stack. Research confirmed parity — OpenAI SDK, LangGraph JS, @napi-rs/canvas all match their Python equivalents" |

---

## Evaluation Criteria

From the assessment PDF: *"Please ensure that your solution reflects thoughtful design choices and demonstrates a clear understanding of the code."*

| # | Criteria | What They're Looking For |
|:-:|---------|-------------------------|
| 1 | **Prompt Engineering Quality** | How are prompts constructed? Auditable? Template-based? |
| 2 | **Architecture Cleanliness** | Can someone understand the pipeline reading the code for the first time? |
| 3 | **Self-Awareness** | Does Kevin know what's good AND what's weak? |
| 4 | **Working Demo** | Does the pipeline actually run and produce output? |
| 5 | **README Quality** | How to run, design decisions, limitations, architecture |
| 6 | **Success Metrics** | Time saved, campaigns generated, overall efficiency |

---

## Interview Defense Lines

> Living collection — appended as new defense points emerge during development.
> Each line is a pre-built response to a likely interview question.
> Organized by topic. The `[Source]` tag tracks where each insight originated.

### Architecture & Tech Stack

**D-01** | *"Why Next.js instead of Python?"*
"I chose Next.js because it's in the JD's preferred stack — React/Next.js. The assessment doesn't constrain technology, but when both stacks can do the job, you pick the one the hiring manager listed. Research confirmed full parity: OpenAI Node SDK has identical API surface, LangGraph JS is at v1.2.8 with feature parity, and @napi-rs/canvas closes the Pillow gap for text compositing."
`[Source: ADR-001, tech stack research — 5 parallel agents]`

**D-02** | *"Why not use LangChain/LangGraph?"*
"The pipeline is deterministic — parse, build prompt, generate, overlay, organize. LangGraph is designed for non-deterministic LLM reasoning loops with branching, memory, and tool use. Using it here would be over-engineering. I've built LangGraph orchestration in PocketDev where it's genuinely needed — for non-deterministic workflows. Knowing when NOT to use a framework is as important as knowing how."
`[Source: GenAI best practices research — "these are NOT agentic systems"]`

**D-03** | *"How would you migrate this to a different stack?"*
"Architecture decisions outlast language choices. Every module in `lib/pipeline/` has zero framework dependencies — pure TypeScript functions that take data and return data. The StorageProvider interface means the domain layer never knows which backend it's using. Swapping S3 for Azure Blob or DALL-E for Firefly is a new interface implementation, not a rewrite."
`[Source: ADR-001 production mapping table]`

**D-04** | *"Why not a microservices architecture?"*
"Every credible engineering source recommends starting with a monolith and extracting services when you have proven need. For a POC: single process, single entry point, sequential pipeline. The component boundaries are clean enough that extraction is straightforward when scale demands it — but premature decomposition adds latency, deployment complexity, and debugging overhead for zero benefit."
`[Source: GenAI best practices research — "monolith, unambiguously"]`

**D-05** | *"How does this handle storage at scale?"*
"I structured the pipeline so S3/local swap is a config change, not a rewrite. `StorageProvider` interface with two implementations — `LocalStorage` for dev (zero config, just an OpenAI key) and `S3Storage` for production (pre-signed URLs, IAM-scoped permissions). The factory reads one env var. Three commands to a running app locally; one `vercel deploy` for production."
`[Source: docs/architecture/deployment.md, storage abstraction design]`

---

### Prompt Engineering (P0 — The Star Component)

**D-06** | *"Show me where the prompt is generated."*
"The prompt builder constructs prompts in five auditable layers: Subject (product identity), Context (audience + region + mood), Composition (aspect-ratio-specific layout guidance), Style (photography direction), and Exclusions (no text, no logos). Each layer maps to specific campaign brief fields — you can trace exactly which input influenced which part of the prompt."
`[Source: lib/pipeline/promptBuilder.ts, Quinn Frampton Round 1 feedback]`

**D-07** | *"Why template-based instead of LLM-generated prompts?"*
"Brand safety requires predictability. Every prompt is auditable — you can inspect exactly what was sent to DALL-E for any given input. LLM-generated prompts introduce non-determinism that makes brand compliance impossible to guarantee. A CMO needs to know that no embarrassing creative will go live. Templates give you that guarantee."
`[Source: promptBuilder.ts design decision #1, business-context.html brand safety driver]`

**D-08** | *"Why different composition guidance per aspect ratio?"*
"A 1:1 square Instagram post needs centered, symmetrical composition. A 9:16 vertical Story needs the product in the upper two-thirds with clean space at the bottom for text overlay. A 16:9 horizontal banner needs the product off-center with cinematic breathing room. DALL-E doesn't know how the image will be used — the composition layer tells it."
`[Source: COMPOSITION_GUIDANCE constant, docs/architecture/image-processing.md]`

**D-09** | *"How do you handle the 'no faces' problem for lifestyle products?"*
"I made the exclusion policy category-aware. Product-only shots work for packaged goods, but lifestyle categories like sun protection benefit from people in the scene. The product category drives this decision — `sun protection`, `skincare`, `sportswear` get 'people may appear naturally but the product remains the hero.' Everything else gets strict product-only composition."
`[Source: Pipeline review W-1, isLifestyleCategory logic in promptBuilder.ts]`

**D-10** | *"What about product color accuracy?"*
"Product color is injected as a brand palette hint in the prompt's subject layer. DALL-E 3 has weak hex color adherence — it interprets '#F4A261' inconsistently. In production, I'd convert hex to human-readable color names via a color-naming library so the prompt reads 'warm coral orange' instead of a hex code. This is a documented known limitation."
`[Source: Pipeline review C-1, color injection fix]`

---

### FDE / Client Engagement Framing

**D-11** | *"How would you present this to a client?"*
"This isn't homework — it's the pipeline I'd walk a client through in week 1 of an engagement. Brief in, 6 campaign-ready assets out, 45 seconds. At their scale of 200 campaigns/month, this replaces 3 weeks of agency work per campaign. That's the $12M/year creative production problem solved."
`[Source: business-context.html framing table]`

**D-12** | *"What's the ROI story?"*
"The pipeline generates 6 creatives in ~30 seconds for ~$0.50 in API costs. A creative agency charges $50K-500K per campaign and takes 4-8 weeks. At 200 campaigns/year, even a 50% reduction in agency dependency saves $5M-50M annually. And because generation is near-instant, you can A/B test 10x more variants — which means faster learning about what converts."
`[Source: business-context.html impact numbers]`

**D-13** | *"What would you do differently with more time?"*
"Three things: First, Adobe Firefly instead of DALL-E — stays within the client's Creative Cloud ecosystem and handles Content Credentials (C2PA) for AI provenance tracking. Second, the Brand Triage Agent — a multi-tenant brand context layer that makes every generated creative hyper-specific to the company's visual identity, voice, and compliance rules. Third, A/B test prompt variants per product category with conversion tracking to learn which prompt patterns drive the best results."
`[Source: ADR-001 risks section, brand-triage-agent.md]`

**D-14** | *"How do you handle localization?"*
"Architecture supports it without changing the pipeline — a translation API between the brief parser and prompt builder enables multi-market support. The campaign message gets translated per locale, the prompt builder's region-aware context layer adjusts the visual environment (North American beach vs Japanese garden), and the text overlay renders the localized message. It's a new pipeline step, not a rewrite."
`[Source: assessment-brief.md risks/tradeoffs table]`

---

### Production & Infrastructure Thinking

**D-15** | *"Why Vercel? What about scale?"*
"Vercel for the POC because it's one-click deploy and gives evaluators a URL to click instead of a clone-install-configure cycle. Reviewer friction matters. The 60-second Hobby timeout works because DALL-E calls run in parallel via Promise.all — 6 images in ~20 seconds wall time, not 120 sequential. For production scale with batch processing, I'd add a BullMQ + Redis job queue behind the API."
`[Source: docs/architecture/deployment.md, orchestration.md queue model]`

**D-16** | *"What happens when DALL-E fails?"*
"Partial failure tolerance. If 5 of 6 images succeed and 1 hits a content policy rejection, the pipeline returns the 5 successful creatives plus a typed error for the failed one. The frontend shows partial results with a 'retry failed image' prompt. Promise.allSettled instead of Promise.all — because throwing away 5 good results for 1 failure is bad UX."
`[Source: Pipeline review W-2 fix, orchestration.md partial failure handling]`

**D-17** | *"How do you handle rate limits?"*
"p-limit caps concurrency at 5 parallel DALL-E requests (matching OpenAI Tier 1). The withRetry utility does exponential backoff on 429s (1s → 2s → 4s, max 3 attempts). Content policy 400s are NOT retried — they're surfaced as PipelineError with the violation reason. And each individual DALL-E call has a 30-second AbortSignal timeout so a hanging socket can't eat the entire Vercel budget."
`[Source: ADS-001 AC, orchestration.md retry policy, Pipeline gap analysis]`

**D-18** | *"What about security?"*
"Path traversal protection on filesystem storage — any user-derived string used in path.join() gets validated against the base directory. API keys are server-side only (no NEXT_PUBLIC_ prefix). S3 access uses pre-signed URLs scoped to specific keys with 24-hour TTL — the frontend never holds AWS credentials. Campaign IDs are Zod-validated as lowercase alphanumeric to prevent path injection."
`[Source: Code Quality review C-1, deployment.md secrets handling]`

---

### Brand Triage Agent (Differentiator)

**D-19** | *"How would you make this work for different clients?"*
"The Brand Triage Agent. When an FDE walks into a new client engagement, the first question is 'What does your brand look like?' The agent captures that answer as a structured brand profile — colors, photography style, voice, compliance rules — and injects it into every pipeline stage. Same architecture, radically different output. Onboard a new client by adding a brand profile JSON, not rewriting code."
`[Source: docs/architecture/brand-triage-agent.md]`

**D-20** | *"Can you give me a concrete example?"*
"Same sunscreen campaign brief, two different brand profiles. Coastal Wellness gets calm ocean-blue tones, golden-hour lifestyle photography, DM Sans font, gradient overlay, 'warm, like a trusted friend who's also a dermatologist.' BLAZE Athletics gets explosive red/black, harsh stadium lighting, Oswald uppercase, knockout overlay, 'no-nonsense coach who pushes you harder.' Same pipeline code, same prompt builder, completely different DALL-E output — because the brand profile parameterizes every style decision."
`[Source: examples/brand-profiles/coastal-wellness.json, blaze-athletics.json]`

**D-21** | *"Where does the brand data come from?"*
"Three tiers. POC: manual JSON upload during onboarding. V2: LLM-powered extraction from brand guidelines PDFs — most enterprises have 50-100 page brand books. V3: MCP-powered website and social media scraping — extract colors from CSS, fonts from @font-face, voice from copy, photography style from existing creatives. Each tier feeds the same BrandProfile schema."
`[Source: brand-triage-agent.md Source sections]`

---

### Review Process & Engineering Quality

**D-22** | *"How do you ensure code quality?"*
"I run a multi-agent code review pipeline with 7 specialized agents — Architecture, Code Quality, Pipeline & AI, Frontend, Orchestration, Image Processing, and Testing. Each agent has its own prompt file and auto-activates based on which files changed. The first review found 29 issues including a path traversal vulnerability. After fixes, the approval run found 3 LOW notes — a 90% reduction. The review history is versioned in `reviews/` so you can see the progression."
`[Source: review-config.yml, reviews/ADS-000-scaffold/]`

**D-23** | *"How do you prioritize what to fix?"*
"Cross-agent consensus is the strongest signal. When 2+ agents independently flag the same issue, that's where you fix first. In run-001, three consensus findings — product.color missing from prompts, Promise.all without partial failure, and Season type too loose — all got fixed immediately. The pipeline agent and code quality agent don't share context, so independent agreement means the signal is real."
`[Source: reviews/ADS-000-scaffold/run-001 orchestrator-synthesis.md]`

**D-24** | *"Tell me about a bug you caught."*
"The code quality agent found a path traversal vulnerability in the local storage provider. Any user-derived string passed to `path.join()` could escape the output directory — `../../etc/passwd` as a campaign ID would read arbitrary files. We added `safePath()` which resolves the full path and verifies it starts with the base directory prefix. The Zod schema also now enforces campaign IDs as `^[a-z0-9-]+$` — no path separators allowed at the validation boundary."
`[Source: Code Quality C-1, localStorage.ts safePath() implementation]`

---

### Self-Critique (What Adobe Values)

**D-25** | *"What are the known limitations?"*
"Four that I'd address with more time. First: DALL-E 3 color adherence is weak — hex codes in prompts don't reliably produce matching colors. Production fix: color-naming library. Second: the dalleSize field in domain types is an infrastructure leak — pragmatic for a POC but should be derived in the image generator layer. Third: no image quality scoring — we generate but don't evaluate whether the output is good. Fourth: single-region, English-only — the architecture supports localization but it's not implemented."
`[Source: Pipeline review findings, ADR-001 consequences, promptBuilder.ts FUTURE IMPROVEMENTS]`

**D-26** | *"What would production look like?"*
"Week 1: ship this POC to validate pipeline logic with the client. Week 2: Firefly API instead of DALL-E, Adobe IMS auth. Week 3: Brand Triage Agent for multi-tenant brand context. Week 4: React dashboard — brief builder, generation progress, creative gallery. Week 5: S3 + CDN delivery, brand compliance checks, Content Credentials. Week 6: A/B testing framework, performance analytics, deployment hardening."
`[Source: ADR-001 migration path, brand-triage-agent.md production scope]`

**D-27** | *"What design decision are you most proud of?"*
"The five-layer prompt builder. Not because it's complex — it's simple. But every layer is traceable back to the brief, every exclusion is documented with WHY, the composition guidance is aspect-ratio-aware, and the face policy is category-aware. An evaluator can read the code and understand exactly how a campaign brief becomes a DALL-E prompt. That's what Quinn asked for."
`[Source: Quinn Frampton feedback, promptBuilder.ts architecture]`

---

## Appendix: Key Contacts

| Name | Role | Contact | Notes |
|------|------|---------|-------|
| Natalie Weston | Sr Technical Recruiter, Conexess | Text: 248-804-6731 | Kevin's advocate. Available Sat Apr 11. |
| Jim Wilson | National Account Manager, Conexess | jwilson@conexess.com | Submit assessment to his email chain. |
| Quinn Frampton | Global RM, FDE, Adobe | Via Natalie | Conducted Round 1. Evaluates the assessment. |
| Emily Crawford | Resource Manager, Adobe | con33875@adobe.com | Organized logistics. |

---

## Appendix: Assessment Requirements Checklist

### Minimum (Must Ship)
- [ ] Campaign brief (JSON) with 2+ products, region, audience, message
- [ ] Input assets — local folder, reuse when available
- [ ] GenAI image generation for missing assets
- [ ] 3 aspect ratios (1:1, 9:16, 16:9)
- [ ] Campaign message displayed on final posts
- [ ] Runs locally (or hosted)
- [ ] Organized output by product and aspect ratio
- [ ] README: how to run, design decisions, limitations

### Bonus (Nice-to-Have)
- [ ] Brand compliance checks
- [ ] Legal content checks (prohibited words)
- [ ] Logging / reporting of results

### Deliverables
- [ ] Public GitHub repo + comprehensive README
- [ ] 2-3 min demo video (Loom)
- [ ] Reply to Jim Wilson with links + availability Tue-Thu Apr 14-16
