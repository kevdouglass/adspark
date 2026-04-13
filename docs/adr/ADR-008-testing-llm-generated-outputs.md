# ADR-008: Testing Strategy for LLM-Generated Outputs

**Status:** Proposed
**Date:** 2026-04-12
**Decision Makers:** Kevin Douglass
**Origin:** User observation during smoke-test of `/api/orchestrate-brief` — the multi-agent orchestrator produced `campaign.message = "Transform Your Meal Prep With Style"` from a long natural-language description. Question raised: *"Can we test that the LLM actually followed the input? I thought these were non-deterministic — how do we validate them?"*

---

## Decision

Adopt a **four-layer testing strategy** for LLM-generated outputs, with explicit expectations per layer and explicit non-goals. Ship Layer 1 today; spike the rest.

| Layer | Name                                    | Determinism level    | Cost to run | Speed        | Shipping now? |
|-------|-----------------------------------------|----------------------|-------------|--------------|---------------|
| **1** | Structural (Zod schema + invariants)    | Full determinism     | Free        | Milliseconds | ✅ Implemented  |
| **2** | Property / contract assertions          | Full determinism     | Free        | Milliseconds | 🟡 Spike        |
| **3** | Golden-fixture record/replay            | Full determinism     | One-time API call to record | Milliseconds on replay | 🟡 Spike |
| **4** | Semantic (LLM-as-judge)                 | Statistical          | API calls per test  | Seconds      | 🟡 Spike        |

**Layer 1 is authoritative.** If any layer-1 check fails, the LLM output is rejected *at runtime* (not just at test time) and the caller sees a typed `UPSTREAM_ERROR`. This is already enforced in `lib/ai/agents.ts` via `campaignBriefSchema.safeParse()` at every phase boundary — Zod is the runtime gate regardless of what the tests say.

**Layers 2-4 are test-only.** They never run in production. They exist to catch regressions in the *quality* of LLM output between model versions, prompt edits, and agent refactors.

Add a sibling module `lib/ai/agents.test.ts` for layers 1-2. Add a gated integration test suite `__tests__/integration/agents.*.test.ts` for layers 3-4 that only runs when `OPENAI_API_KEY` is set and `RUN_INTEGRATION_TESTS=1`. CI defaults to layers 1-2 only.

**Deterministic-mode knobs for test runs** (applied when `NODE_ENV === "test"` or an explicit `TEST_MODE` env var):
- `temperature: 0` (maximum sampling suppression, not a guarantee)
- `seed: <fixed integer>` — OpenAI's beta deterministic-sampling parameter
- `model: "gpt-4o-mini-2024-07-18"` (pinned exact snapshot, not the floating alias)

These knobs reduce but do not eliminate drift. They are necessary but not sufficient — layer 3 is the only truly repeatable approach.

---

## Context

### The problem

PR #54 shipped a four-phase multi-agent brief orchestrator (`lib/ai/agents.ts`) that runs ~6 OpenAI chat-completion calls per invocation:

1. **Triage** — one call, returns priority guidance
2. **Draft** — one call, Campaign Manager agent produces the initial brief
3. **Review** — four parallel calls (Creative Director, Regional Marketing Lead, Legal/Compliance, CMO)
4. **Synthesis** — one call, orchestrator merges reviewer edits into the final brief

The final brief is then fed directly to the DALL-E pipeline — there is no human review step in between. The LLM's output IS the production input. Every campaign message, product description, keyFeature, tone, target audience, brand color, and season decision comes from an LLM and drives downstream image generation and text overlay.

Two testing questions follow:

1. **Correctness:** does the orchestrator behave correctly? (Does it call the phases in the right order, handle partial reviewer failures, validate outputs, propagate errors?)
2. **Output quality:** do the briefs the LLM produces actually reflect the user's intent and match "world-class marketing" standards?

Question 1 is a software test. Question 2 is a non-deterministic system test.

### Why non-determinism matters here

LLMs are non-deterministic by design — the same input can produce different outputs across runs due to:

- **Temperature sampling** — our agents use `temperature: 0.3-0.8` depending on the role (low for synthesis, high for draft creativity)
- **Top-p / top-k** — OpenAI's internal sampling parameters
- **Model updates** — OpenAI routinely updates model weights. `gpt-4o-mini` is a floating alias; the underlying snapshot changes without notice
- **Distributed inference non-determinism** — even at `temperature: 0`, floating-point non-associativity on parallel GPUs can produce different logits across identical runs

The `seed` parameter (in beta as of this writing) is OpenAI's best-effort attempt to reduce this, but their own docs say it's **"not a guarantee"** — identical requests with identical seeds can still drift.

**So: byte-for-byte determinism is not achievable.** The question becomes "what kinds of determinism ARE achievable?"

### Levels of determinism

There is not one "determinism" — there are at least four:

1. **Byte-identical determinism** — same input → exact same bytes out. Not achievable with commercial LLMs.
2. **Structural determinism** — same input → output that matches the same shape (fields, types, enums). Achievable via schema validation. Layer 1.
3. **Property determinism** — same input → output that satisfies specific invariants and keyword containments. Achievable via assertion-based tests. Layer 2.
4. **Semantic determinism** — same input → output that conveys the same MEANING even if phrased differently. Only achievable via another LLM as judge, or human review. Layer 4.

For a feature that feeds production, all four levels have value but none alone is sufficient. A layered approach mirrors how other non-deterministic systems (distributed consensus, ML inference, scientific computing) are tested.

### The concrete example from smoke-testing

The user typed:

> *"Launch a premium line of reusable glass food containers for health-conscious urban professionals who meal-prep on Sundays. Minimalist scandinavian aesthetic, fall launch, plant-forward imagery."*

The orchestrator produced `campaign.message = "Transform Your Meal Prep With Style"`.

Is this a good output? That's an opinion. But we can test specific things about it:

- **Structural (layer 1):** message is a non-empty string ≤ 140 chars, no trailing period. ✅ Testable, cheap, deterministic.
- **Property (layer 2):** message contains at least ONE keyword from {"meal", "prep", "food", "container", "glass", "kitchen", "style", "minimalist"} — evidence the LLM engaged with the prompt. ✅ Testable, cheap, mostly deterministic.
- **Semantic (layer 4):** "Does this message reflect a minimalist scandinavian aesthetic and speak to health-conscious meal-preppers?" — requires an LLM-as-judge call returning a rubric score. Testable but expensive.

Layer 1 gives fast guard rails. Layer 2 catches prompt engineering regressions. Layer 4 catches the subtle "this is technically correct but vapid" failure mode.

---

## Options Considered

### Option A: Ship structural tests only (layer 1), skip the rest

Layer 1 already exists — `campaignBriefSchema.safeParse()` runs on every LLM output in `lib/ai/agents.ts`. Declare this the contract and move on.

**Pros:**
- Zero additional work
- Existing runtime gate already catches the most dangerous drift (missing fields, wrong types, invalid enums)
- No flaky tests

**Cons:**
- A structurally-valid brief can still be low-quality (vague product description, hallucinated features, off-brief tone)
- No CI regression alarm when a prompt edit degrades output quality
- No confidence when upgrading models — "we shipped gpt-4o-mini-2025-06-01, are the outputs still good?"
- Contractually aligns with what the assessment reviewer asked: *"We value engineers who evaluate their own solutions critically"* — shipping zero-quality tests on a gen-AI feature is the opposite

### Option B: LLM-as-judge everywhere (layer 4 as the primary test)

Write a rubric-based LLM judge prompt. Every test runs the real orchestrator, then scores the output via a separate `gpt-4o` call.

**Pros:**
- Semantic coverage — catches "technically valid but vapid" failures
- Matches how frontier labs evaluate LLM outputs
- Single approach instead of four layers

**Cons:**
- Expensive — every CI run becomes a multi-dollar API bill
- Slow — tests take minutes, not milliseconds
- Itself non-deterministic — the judge gives different scores for identical inputs
- Requires API keys in CI (secrets management, rate limits, flakes)
- Judge prompt is itself a moving target that needs its own regression tests

### Option C: Pure mock-based tests (fast but fake)

Mock the OpenAI client entirely. Every phase returns hard-coded fixture responses. Test only the orchestration logic (control flow, error handling, partial failure).

**Pros:**
- Fully deterministic, fast, free
- Covers orchestration correctness (phase ordering, Promise.allSettled fan-out, synthesis fallback)
- Works in CI with no secrets

**Cons:**
- Tests the code around the LLM, not the LLM's output
- A prompt edit that degrades real-world output quality passes all tests
- False confidence — green tests say nothing about what real users get

### Option D: Multi-layer strategy (selected)

Combine layer 1 (ship today), add layers 2-4 as a planned follow-up spike. Each layer has a focused purpose and explicit non-goals.

**Pros:**
- Each layer earns its cost: layer 2 catches prompt regressions cheaply, layer 3 catches model drift cheaply, layer 4 catches semantic degradation expensively
- Layer 3 golden fixtures solve the hardest problem — "is this prompt still producing the same quality output as six weeks ago" — without running expensive integration tests on every commit
- CI defaults to free/fast (layers 1-2), with integration gates for layers 3-4
- Mirrors how other non-deterministic systems are tested in industry

**Cons:**
- Four layers to maintain instead of one
- Risk of partial implementation — "we shipped layer 2 but never got to layer 3"
- Mitigation: ship the spike ticket (ADS-043) and drive each layer to completion or deliberate deferral

---

## Per-layer implementation detail

### Layer 1 — Structural validation (already shipped)

**Location:** `lib/ai/agents.ts` — `campaignBriefSchema.safeParse()` at the end of every phase that returns a brief. Hard-fails with `Error` that the route handler maps to `UPSTREAM_ERROR`.

**What it catches:**
- Missing required fields
- Type errors (non-string where string expected)
- Invalid enums (a season that isn't one of the four allowed values)
- Malformed hex colors
- Product count violations

**What it does NOT catch:**
- Low-quality content that happens to match the schema
- Hallucinated specifics (e.g., "80% off" when user never mentioned pricing)
- Semantic drift over model versions

### Layer 2 — Property / contract assertions (proposed)

**Location:** `__tests__/agents.property.test.ts` — vitest unit tests with mocked OpenAI client.

**Assertion categories:**

1. **Field invariants that must always hold** (deterministic from Zod but worth asserting):
   - `campaign.message.length <= 140 && campaign.message.length > 0`
   - `!campaign.message.endsWith(".")`
   - Every product has `keyFeatures.length >= 3 && <= 5`
   - `/^#[0-9A-Fa-f]{6}$/.test(product.color)`
   - `campaign.id` and `product.slug` match `/^[a-z0-9-]+$/`

2. **Prompt engagement assertions** (probabilistic but high signal when mock-backed):
   - For a fixture input containing "summer", output `campaign.season === "summer"`
   - For a fixture input containing "minimalist scandinavian", tone should contain at least ONE of {"minimalist", "clean", "restrained", "nordic", "scandi"}
   - For a fixture input with 2+ product names, output should have 2 products (not 1)

3. **Orchestration control-flow assertions:**
   - When the draft phase succeeds and all 4 reviewers fail, synthesis is SKIPPED and the draft is returned unchanged (fallback path)
   - When triage fails, all 4 reviewers still run with `undefined` priorities
   - When 2 reviewers fail, synthesis gets the 2 successful ones and the `notes` array contains placeholder entries for the failed 2
   - Total `phaseMs.total` is at least the sum of sequential phases

**Why mocked OpenAI works here:** these tests are about the *code around the LLM*, not the LLM's output quality. Control-flow assertions are stable regardless of which model is used.

### Layer 3 — Golden-fixture record/replay (proposed)

**Location:** `__tests__/integration/agents.golden.test.ts` — gated on `RUN_INTEGRATION_TESTS=1`.

**Pattern:**

1. For each curated test prompt in `__tests__/fixtures/agents/prompts/*.txt`, run the real orchestrator with `temperature: 0`, `seed: 42`, and the pinned model `gpt-4o-mini-2024-07-18`
2. Record the full response (brief + notes + phaseMs) to `__tests__/fixtures/agents/golden/*.json`
3. On subsequent test runs, read the prompt, run the orchestrator, compare against the golden fixture
4. Drift = test failure. Drift is either a real regression (model update, prompt edit) or an intentional quality improvement. The fixture is updated deliberately via a `UPDATE_GOLDEN=1` env flag.

**Why this works despite non-determinism:**

- Between OpenAI model version updates, the output is *practically* stable at `temperature: 0 + seed`
- When a model update DOES drift the output, we WANT the test to fail — it's an early warning that the quality of production output may have shifted
- When we *intentionally* edit a prompt (e.g., sharpen the Creative Director's system prompt), we regenerate the golden fixtures as part of the PR and diff the before/after briefs as part of review. This is the ONLY moment in the testing pipeline where a human sees a side-by-side diff of LLM quality.

**Cost:** one API call per fixture per golden update. Negligible.

**Failure modes:**
- Fixture drift due to model floating aliases — mitigated by pinning the exact snapshot
- Fixture drift due to OpenAI's infrastructure non-determinism — accept ~5% flake rate, retry on failure in CI, investigate persistent drift

### Layer 4 — LLM-as-judge semantic scoring (proposed, possibly deferred)

**Location:** `__tests__/integration/agents.semantic.test.ts` — gated on `RUN_INTEGRATION_TESTS=1`.

**Pattern:**

1. Run the real orchestrator
2. Pass `{ userPrompt, generatedBrief }` to a separate `gpt-4o` (not mini — the judge needs to be smarter than the actor) call with a rubric system prompt
3. Judge returns a JSON score: `{ brand_alignment: 1-5, specificity: 1-5, conversion_signal: 1-5, hallucination_risk: 1-5, overall: 1-5 }`
4. Test passes if `overall >= 4`
5. Test records the judge's detailed feedback to a structured log file so a human can sanity-check the judge's judgment over time

**Why this is last priority:**
- Expensive ($0.05-$0.10 per test run)
- Slow (10-20s per test)
- Itself non-deterministic (needs its own rubric tests — turtles all the way down)
- Useful for weekly regression sweeps, not per-commit CI

**Alternative:** defer to a manual checklist in the PR template — human reviewer spot-checks 2-3 orchestrator runs per PR. Zero infrastructure, same coverage for a POC-scale project.

---

## Consequences

### Positive

- **Clear answer to the user's question**: yes, LLM outputs are testable; no, they are not byte-deterministic; the strategy is layered, not monolithic
- **Production runtime safety stays strong** — Zod schema validation is the authoritative gate regardless of what tests say
- **Test pyramid has a sensible shape** — fast/free tests at the bottom (layers 1-2), slow/expensive at the top (layers 3-4), both serving different purposes
- **Model updates become detectable** — layer 3 golden fixtures catch drift the moment it happens
- **Prompt edits become reviewable** — side-by-side brief diffs in PR reviews surface the real quality impact of a system prompt edit
- **Aligns with assessment criterion #3 (self-awareness)** — "we know these outputs are non-deterministic, here's our plan"

### Negative

- **Four layers is more maintenance than one** — every new agent adds work at every layer
- **Layer 3 fixtures can become stale** — if no one updates them when prompts change, they become false alarms that get blindly regenerated
- **Layer 4 requires judgment calls** — "is this brief actually good?" is the unsolved problem. The judge is just a probabilistic approximation of a human reviewer
- **Cost escalates with agent count** — if we add more reviewers in the future, every test in layers 3-4 scales with the agent count

### Neutral but worth noting

- **CI will default to layers 1-2 only.** Layers 3-4 require opt-in. This means CI is fast but NOT a sufficient gate for "is the prompt engineering still good?" — that requires periodic integration runs, owned by a human
- **Property-based testing (fast-check) is explicitly NOT in scope.** The outputs are too structured and the interesting properties are too correlated to benefit from randomized input generation
- **Snapshot testing (`toMatchSnapshot`) is explicitly NOT in scope.** Golden fixtures serve the same purpose with more deliberate update flow

---

## Implementation plan

Follow-up ticket: **ADS-043: Spike — LLM output testing implementation**. See `docs/tickets/ADS-043-llm-output-testing.md` for the full spike definition.

The spike itself is in four sub-tasks that map 1:1 to the layers:

1. **Layer 1 audit + documentation** (1h) — document what exists, formalize the runtime invariants as a reference table
2. **Layer 2 prototype** (3h) — write `__tests__/agents.property.test.ts` with mocked OpenAI, 8-12 test cases covering field invariants, prompt engagement, and orchestration control flow
3. **Layer 3 prototype** (4h) — build the record/replay infrastructure, generate 3-5 golden fixtures for representative prompts, document the update workflow
4. **Layer 4 decision** (1h) — try one LLM-as-judge call, measure cost/latency/signal, decide ship vs. defer

**Total spike estimate: 9h.** Can be split across a sprint. Not blocking any current work — the runtime gate at layer 1 is already sufficient to avoid shipping broken briefs.

---

## References

- OpenAI reproducible outputs docs: https://platform.openai.com/docs/guides/text-generation/reproducible-outputs
- `lib/ai/agents.ts` — current orchestrator implementation, layer 1 in place
- `lib/pipeline/briefParser.ts` — `campaignBriefSchema`, the runtime gate
- ADR-005 — runtime Zod validation as the single source of truth for request shapes
- ADR-006 — parallel wire-format types with explicit mappers (inspires the golden-fixture approach: public contract is the review gate, not an aspirational alias)
- `knowledge-base/01-assessment/business-context.md` — the 5 stakeholder agents whose output we are testing
