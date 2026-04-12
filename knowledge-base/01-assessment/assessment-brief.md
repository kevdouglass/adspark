# Adobe FDE Take-Home Assessment — Full Brief
**Assessment:** Creative Automation for Social Ad Campaigns
**Role:** Forward Deployed AI Engineer, Adobe (via Conexess Group)
**Time budget:** 1-3 hours (per recruiter) / 2-3 hours (Kevin's build plan estimate)
**Hard deadline:** Sunday April 12, 2026, 3:44 PM PST (48 hrs from receipt)
**Target submission:** Saturday April 11, 2026 afternoon
**Deliverables:** Public GitHub repo + 2-3 min demo video (Loom recommended)
**Submit to:** Reply-all to Jim Wilson's email chain (jwilson@conexess.com) + Natalie Weston (CC'd)
**Defense:** You will defend this code in a 30-min live technical interview (Round 3)

---

## Scenario

**Client:** Global consumer goods company launching hundreds of localized social ad campaigns monthly.

**Business Goals:**
- Accelerate campaign velocity
- Ensure brand consistency
- Maximize relevance/personalization
- Optimize marketing ROI
- Gain actionable insights

**Pain Points:**
- Manual content creation overload
- Inconsistent quality
- Slow approval cycles
- Difficulty analyzing performance at scale
- Resource drain

---

## Requirements (Minimum)

- [ ] Accept **campaign brief** (JSON/YAML) with: product(s) (at least 2), target region/market, target audience, campaign message
- [ ] Accept **input assets** (local folder or mock storage), reuse when available
- [ ] When assets missing, **generate via GenAI image model**
- [ ] Produce creatives for **3 aspect ratios** (1:1, 9:16, 16:9)
- [ ] **Display campaign message** on final posts (English minimum, localized = bonus)
- [ ] Runs **locally** (CLI or simple app, any language/framework)
- [ ] Save outputs to folder, organized by **product and aspect ratio**
- [ ] **README**: how to run, example I/O, key design decisions, assumptions/limitations

## Nice-to-Have (Bonus)

- [ ] Brand compliance checks (logo presence, brand colors)
- [ ] Legal content checks (flag prohibited words)
- [ ] Logging or reporting of results

## Deliverables

- [ ] **Public GitHub repo** with code + comprehensive README
- [ ] **2-3 min demo video** of the app working (screen recording via Loom or equivalent)

---

## Recommended Architecture

```
campaign-brief.json -> Brief Parser -> Asset Resolver -> Prompt Builder -> Image Generator -> Text Overlay -> Output Organizer
```

| Component | Purpose | Why This Matters |
|---|---|---|
| Brief Parser | Reads JSON, validates schema | Clean separation — input format is swappable |
| Asset Resolver | Check local folder, decide generate vs reuse | Tests both paths (existing asset + GenAI generation) |
| **Prompt Builder** | Constructs image generation prompts from brief variables | **THE CODE THEY WANT TO SEE** — template-based, auditable, consistent. Comment heavily. |
| Image Generator | Calls GenAI API (DALL-E 3), handles 3 aspect ratios | Simplest high-quality API for POC |
| Text Overlay | Composites campaign message onto images (Pillow/PIL) | No external dependencies, full control |
| Output Organizer | Saves to output/{product}/{ratio}/ | Clean structure, easy to review |

## Planned Tech Stack

| Component | Tool | Defense |
|---|---|---|
| Language | Python | Strongest backend language. Django + LangGraph experience. |
| GenAI Image API | OpenAI DALL-E 3 | Best quality, simplest API. "In production, I'd evaluate Firefly." |
| Image Processing | Pillow (PIL) | Industry standard. Resize, crop, text overlay. |
| Brief Format | JSON | Simple, no dependencies. |
| Storage | Local filesystem | POC scope. Structured so cloud swap is config change. |

---

## Build Timeline

| Step | Time | What |
|---|---|---|
| 1. Setup + brief | 15 min | Project, campaign brief JSON, folder structure |
| 2. Brief parser + asset resolver | 30 min | Read brief, check assets, route generate vs reuse |
| 3. **Prompt builder** | 45 min | Template system, variable injection, aspect ratio handling. COMMENT HEAVILY. |
| 4. Image generation | 30 min | DALL-E API, 3 ratios x 2 products = 6 images |
| 5. Text overlay | 20 min | Campaign message on each image |
| 6. Output organizer | 10 min | Save to organized folder structure |
| 7. README + docs | 20 min | Architecture diagram, design decisions, how to run |
| 8. Demo video | 15 min | Screen record: run pipeline, show inputs -> outputs |

---

## Risks/Tradeoffs to Prepare for Defense

| Decision | Tradeoff | Defense |
|---|---|---|
| DALL-E 3 vs Stable Diffusion | DALL-E = simpler, better quality. SD = open source, cheaper. | "POC: quality + simplicity. Production: evaluate Firefly for Adobe ecosystem." |
| Template prompts vs LLM-generated | Templates = consistent but rigid. LLM = creative but unpredictable. | "Brand safety requires predictability. Every prompt is auditable." |
| Pillow vs HTML/CSS rendering | Pillow = simple, pure Python. HTML = richer typography. | "Zero external dependencies. Production: headless browser for richer layouts." |
| Local storage vs cloud | Local = POC. Cloud = production. | "Structured so S3/Azure swap is config change, not rewrite." |
| English only vs localization | English = minimum. Localized = bonus. | "Architecture supports it — translation API between parsing and overlay." |

---

## FAQ Answers Summary (from Jim's email)

- Use ANY third-party tools/APIs (no Adobe requirement)
- Use ANY API keys available to you
- No Adobe ecosystem integration required
- Aspect ratios: standard social media (1:1, 9:16, 16:9)
- No required folder structure — use your judgment
- No sample assets provided — create your own
- Multi-language: optional
- No security/compliance requirements
- Success metrics: time saved, campaigns generated, efficiency
