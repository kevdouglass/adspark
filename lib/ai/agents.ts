/**
 * Multi-Agent Brief Orchestration — stakeholder-aware brief refinement.
 *
 * This module is the "deep research + multi-perspective review" feature
 * the user asked for. A natural-language campaign description (plus any
 * partial form state) is run through a team of specialist LLM agents,
 * each representing a real stakeholder from AdSpark's target enterprise
 * workflow as documented in `knowledge-base/01-assessment/business-context.md`.
 *
 * THE STAKEHOLDERS (from business-context.md → "The 5 Users Who Care"):
 *
 *   | Agent               | Pain they solve                             |
 *   |---------------------|---------------------------------------------|
 *   | Campaign Manager    | "I need 200 variants by Friday."            |
 *   | Creative Director   | "Bangalore team cropped the logo."          |
 *   | Regional Mkt Lead   | "US message doesn't resonate in Japan."     |
 *   | Legal / Compliance  | "Competitor trademark in Brazil campaign."  |
 *   | CMO                 | "$12M/yr spend — can't tell what converts." |
 *
 * THE PHASES:
 *
 *   1. TRIAGE — Orchestrator LLM receives the user prompt + current form
 *      state. Decides which reviewers should be invoked and returns a
 *      one-sentence rationale per agent. This models the real-world
 *      question "does THIS campaign actually need a legal review? does
 *      it need regional adaptation?" The triage output is explanatory
 *      context the synthesizer will see later, not a blocking gate —
 *      all 4 reviewers are always invoked for a full brief, but the
 *      triage tells each one what to PRIORITIZE.
 *
 *   2. DRAFT — Campaign Manager agent drafts the initial brief. This
 *      is the "speed" agent — the one with the bias toward shipping.
 *      Produces the first full GenerateRequestBody.
 *
 *   3. REVIEW (parallel) — Four reviewer agents run concurrently via
 *      Promise.all, each receiving the draft + the triage guidance. Each
 *      returns structured feedback: a refined brief (their suggested
 *      edits applied), a short review note (one paragraph), and a
 *      severity indicator. Running these in parallel cuts wall time
 *      roughly 4x vs. a sequential chain.
 *
 *   4. SYNTHESIS — Orchestrator receives the draft + all four review
 *      outputs and produces the final brief, merging suggestions from
 *      each reviewer intelligently. This is where disagreements get
 *      resolved. The orchestrator also summarizes WHY each reviewer's
 *      change was accepted or deprioritized, which becomes the
 *      "Stakeholder Review Notes" panel in the UI.
 *
 * WHY phases 2-4 use separate LLM calls (not one mega-prompt):
 *
 *   - Each agent gets a FOCUSED system prompt in its own persona. A
 *     single mega-prompt with 5 personas stacked tends to average them
 *     out — the legal voice gets diluted by the creative voice. Giving
 *     each agent its own call forces each to commit to its perspective.
 *   - Parallel execution of reviewers cuts wall time meaningfully
 *     (~12s sequential → ~3s parallel for the review phase).
 *   - Separate calls make it easy to add/remove agents later without
 *     touching a giant prompt.
 *
 * COST: ~$0.01-0.03 per orchestration at current gpt-4o-mini pricing.
 * Cheap enough to run on every Generate Creatives click.
 *
 * WALL TIME: ~8-12s typical (2s triage + 3s draft + 3s parallel reviews + 3s synthesis).
 * Orchestration runs BEFORE the pipeline, so the user waits orchestration + pipeline
 * (total ~40-60s). The PipelineProgress UI shows the agent phases during the
 * orchestration window and then hands off to the normal pipeline stages.
 *
 * RESILIENCE:
 *
 *   - Every phase re-validates the model's JSON output against
 *     `campaignBriefSchema`. Drift is caught and surfaced as a typed
 *     error — the caller decides whether to retry or fall back.
 *   - If a single reviewer fails, the rest of the orchestration still
 *     proceeds; the failed reviewer is logged and excluded from the
 *     synthesis input. Partial review > no review.
 *   - The synthesis step is the authoritative source of the final brief.
 *     If synthesis fails, we fall back to the draft (which is already a
 *     valid brief).
 */

import type OpenAI from "openai";
import { campaignBriefSchema } from "@/lib/pipeline/briefParser";
import type { GenerateRequestBody } from "@/lib/api/types";
import { SAMPLE_BRIEFS } from "@/lib/briefs/sampleBriefs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Canonical list of reviewer agents. Order here determines the order
 * they appear in triage output and in the final review-notes panel.
 *
 * Campaign Manager is the DRAFT agent (phase 2), not a reviewer —
 * it's intentionally excluded from this list.
 */
export const REVIEWER_AGENT_IDS = [
  "creative-director",
  "regional-marketing-lead",
  "legal-compliance",
  "cmo",
] as const;

export type ReviewerAgentId = (typeof REVIEWER_AGENT_IDS)[number];

/**
 * Structured review note from a single agent. Exposed to the frontend
 * via the orchestration response so the UI can render a per-stakeholder
 * breakdown of the final brief.
 */
export interface AgentReviewNote {
  agentId: ReviewerAgentId | "campaign-manager" | "triage" | "synthesis";
  agentLabel: string;
  summary: string;
  severity: "info" | "caution" | "critical";
  /**
   * Optional short list of specific edits the agent suggested. The
   * synthesizer may or may not have applied each one.
   */
  suggestions?: string[];
}

export interface OrchestrationResult {
  brief: GenerateRequestBody;
  notes: AgentReviewNote[];
  /**
   * The triage decision explaining which reviewers were invoked and why.
   * Rendered as the top entry in the stakeholder review panel.
   */
  triageRationale: string;
  /**
   * Timing breakdown for observability. Useful for debugging slow runs
   * and for the Loom demo narration ("notice how the reviewers run in
   * parallel — this single phase is ~3s instead of ~12s").
   */
  phaseMs: {
    triage: number;
    draft: number;
    review: number;
    synthesis: number;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const MODEL = "gpt-4o-mini";
const DRAFT_TEMPERATURE = 0.8;
const REVIEW_TEMPERATURE = 0.6;
const SYNTHESIS_TEMPERATURE = 0.3;

/**
 * The exact output schema every agent must produce when returning a
 * brief. Embedded inline in each agent's system prompt so the model
 * sees it in the same context as the task description.
 */
const BRIEF_SCHEMA_BLOCK = `{
  "campaign": {
    "id": "kebab-case-slug",
    "name": "Campaign Name",
    "message": "Tagline (max 140 chars, punchy, no period)",
    "targetRegion": "Geographic region",
    "targetAudience": "Specific audience description",
    "tone": "3-4 comma-separated adjectives",
    "season": "<one of: spring|summer|fall|winter>"
  },
  "products": [
    {
      "name": "Product Name",
      "slug": "kebab-case-slug",
      "description": "Visual description — what it looks like and what makes it different",
      "category": "lowercase single phrase",
      "keyFeatures": ["concrete feature", "concrete feature", "concrete feature"],
      "color": "#RRGGBB",
      "existingAsset": null
    }
  ],
  "aspectRatios": ["1:1", "9:16", "16:9"],
  "outputFormats": { "creative": "png", "thumbnail": "webp" }
}`;

/**
 * Compact corpus — all sample briefs stringified — used as few-shot
 * examples in the Campaign Manager draft prompt. This is the "lite RAG"
 * grounding so the draft agent sees real schema-valid briefs as a
 * quality bar for detail and tone commitment.
 */
const FEW_SHOT_BLOCK = SAMPLE_BRIEFS.map(
  (s) => `### ${s.label}\n${JSON.stringify(s.brief, null, 2)}`
).join("\n\n");

// ---------------------------------------------------------------------------
// Phase 1: Triage
// ---------------------------------------------------------------------------

interface TriageResult {
  rationale: string;
  priorities: Partial<Record<ReviewerAgentId, string>>;
}

const TRIAGE_SYSTEM_PROMPT = `You are the orchestration lead for a marketing agency. You coordinate specialist reviewers (Creative Director, Regional Marketing Lead, Legal/Compliance, CMO) who will each review a draft campaign brief from their stakeholder perspective.

Your job RIGHT NOW is to look at the user's campaign description and any existing form state and decide what each reviewer should PRIORITIZE when they look at the draft. You are NOT drafting the brief yet. You are setting the review agenda.

Return a JSON object with this exact shape:

{
  "rationale": "One sentence explaining the overall review approach for this campaign.",
  "priorities": {
    "creative-director": "One sentence telling this reviewer what to emphasize.",
    "regional-marketing-lead": "One sentence telling this reviewer what to emphasize.",
    "legal-compliance": "One sentence telling this reviewer what to emphasize.",
    "cmo": "One sentence telling this reviewer what to emphasize."
  }
}

Keep each priority directive short, specific, and grounded in the user's description. Return ONLY the JSON object — no markdown fences, no prose.`;

async function runTriage(
  client: OpenAI,
  userPrompt: string,
  existingBrief: GenerateRequestBody | null
): Promise<TriageResult> {
  const userMessage = [
    `USER CAMPAIGN DESCRIPTION:\n${userPrompt}`,
    existingBrief
      ? `\n\nEXISTING FORM STATE (treat as user's partial intent):\n${JSON.stringify(existingBrief, null, 2)}`
      : "",
  ].join("");

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_tokens: 600,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Triage agent returned empty content");
  }
  const parsed = JSON.parse(content) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("rationale" in parsed) ||
    typeof (parsed as { rationale: unknown }).rationale !== "string"
  ) {
    throw new Error("Triage agent returned malformed output");
  }
  const { rationale, priorities } = parsed as {
    rationale: string;
    priorities?: Partial<Record<ReviewerAgentId, string>>;
  };
  return { rationale, priorities: priorities ?? {} };
}

// ---------------------------------------------------------------------------
// Phase 2: Draft (Campaign Manager)
// ---------------------------------------------------------------------------

const DRAFT_SYSTEM_PROMPT = `You are the Campaign Manager at a global consumer goods company. You ship hundreds of localized social ad campaigns per month. Your bias is SPEED — you need to get a defensible, schema-valid brief on the wire so the creative process can start. You don't polish forever; you draft with confidence and trust the specialist reviewers to refine.

You will receive a user's natural-language campaign description and optionally a partial form state the user has already entered. Produce the INITIAL DRAFT of a structured campaign brief.

The brief will be consumed programmatically by an image-generation pipeline that builds DALL-E 3 prompts from every field. So every field you set is a lever on the final creative. Write each field like it matters.

Schema (return EXACTLY this shape):

${BRIEF_SCHEMA_BLOCK}

## DEEP RESEARCH — MARKETING IMAGE BRIEF BEST PRACTICES

The downstream prompt builder injects \`description\` + \`keyFeatures\` + \`tone\` + \`color\` + \`targetAudience\` + \`category\` + \`season\` into the DALL-E prompt. Quality here directly drives ad quality.

1. **Product description is a VISUAL brief.** Describe what the product LOOKS like — material, finish, silhouette, surface detail. "A sleek brushed-aluminum water bottle with a wooden cap" beats "a sustainable bottle". DALL-E renders surfaces, not abstractions.
2. **keyFeatures must be CONCRETE and DIFFERENTIATING.** Avoid "premium", "high-quality", "innovative". Prefer specific tangible attributes that a viewer can SEE: "matte charcoal finish", "hand-stitched leather grip", "double-wall vacuum insulation".
3. **Category routes the shot type** downstream. Lifestyle categories (sportswear, skincare, beauty) get humans in frame; product categories (software, beverage, electronics) get clean product-only shots. Pick the category that matches your intent.
4. **Tone drives lighting + mood.** Use 3-4 adjectives mixing emotional voice AND visual energy: "empowering, minimalist, golden-hour warm" is 10x more useful than "upbeat".
5. **Audience drives the people in the ad.** Be specific: "Urban millennials 25-35 who hike on weekends" beats "adults".
6. **Brand color is a composition hint.** Pick something bold and renderable — earth tones and jewel tones render better than muddy grays. Valid 6-digit hex.
7. **Campaign message is overlay text.** Under 140 chars, punchy, tagline not headline.
8. **Season injects atmospheric mood.** Match the user's described vibe, not just the calendar month.
9. **Ground EVERYTHING in the user's description.** Do not invent brands, celebrities, numbers, or details the user didn't give you.
10. **Commit to a creative direction.** Don't hedge. A bold-but-wrong draft is more useful to the reviewers than a wishy-washy vague one.

## REFERENCE BRIEFS (match this quality bar — do NOT copy)

${FEW_SHOT_BLOCK}

## STRICT RULES

- Generate 1-2 products. Prefer 2 if the user mentions a product line; 1 for a single hero launch.
- Each product MUST have 3-5 \`keyFeatures\`.
- \`color\` must be valid 6-digit hex starting with "#".
- \`season\` must be lowercase: one of spring, summer, fall, winter.
- \`aspectRatios\` must be exactly ["1:1", "9:16", "16:9"].
- \`outputFormats\` must be exactly {"creative": "png", "thumbnail": "webp"}.
- \`existingAsset\` is always null.
- \`id\` and \`slug\` fields must be kebab-case.
- Return ONLY the JSON object. No markdown fences. No prose.`;

async function runDraft(
  client: OpenAI,
  userPrompt: string,
  existingBrief: GenerateRequestBody | null
): Promise<GenerateRequestBody> {
  const userMessage = [
    `USER CAMPAIGN DESCRIPTION:\n${userPrompt}`,
    existingBrief
      ? `\n\nEXISTING FORM STATE (preserve fields the user intentionally set):\n${JSON.stringify(existingBrief, null, 2)}`
      : "",
  ].join("");

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: DRAFT_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: DRAFT_TEMPERATURE,
    max_tokens: 2000,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Draft agent returned empty content");
  }
  const raw = JSON.parse(content) as unknown;
  const parsed = campaignBriefSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Draft agent output failed schema validation: ${issues}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Phase 3: Review (4 parallel reviewers)
// ---------------------------------------------------------------------------

interface ReviewerDefinition {
  id: ReviewerAgentId;
  label: string;
  systemPrompt: string;
}

const REVIEWERS: readonly ReviewerDefinition[] = [
  {
    id: "creative-director",
    label: "Creative Director",
    systemPrompt: `You are a veteran Creative Director at a global consumer goods company. Your pain point is brand inconsistency — "the Bangalore team cropped the logo off the 9:16 version". You enforce brand visual consistency, composition discipline, and craft quality.

You will receive a DRAFT campaign brief and optional priority guidance from the orchestrator. Your job is to critique the brief from a visual / creative-direction perspective and return a REVISED brief plus a review note.

Focus on:
- Is the product description VISUAL enough to drive a DALL-E prompt? Can a model render it?
- Do the keyFeatures give the generator something to compose? Are they concrete, not vague?
- Does the brand color read as a COMPOSITION choice, or a generic palette pick?
- Does the tone convey a specific visual energy, or is it generic marketing-speak?
- Is the campaign message too long for a legible overlay? Too long = over 140 chars or too many clauses.

Return JSON with this EXACT shape:

{
  "brief": { ...the revised brief matching the schema below... },
  "review": {
    "summary": "One paragraph explaining your edits and why from a creative director perspective.",
    "severity": "info" | "caution" | "critical",
    "suggestions": ["short specific suggestion", "short specific suggestion"]
  }
}

Where the brief field matches:
${BRIEF_SCHEMA_BLOCK}

Rules for the revised brief:
- It MUST be schema-valid. All fields present, correct types, kebab-case slugs, valid hex.
- Preserve the overall campaign intent from the draft. Don't fork it into a different product.
- If the draft is already strong, the revised brief can be identical — say so in the review note.
- Return ONLY the JSON object. No markdown fences. No prose.`,
  },
  {
    id: "regional-marketing-lead",
    label: "Regional Marketing Lead",
    systemPrompt: `You are a Regional Marketing Lead at a global consumer goods company. Your pain point is cultural mistranslation — "the US message doesn't resonate in Japan". You ensure campaigns are culturally adapted to their target region, not just literally translated.

You will receive a DRAFT campaign brief and optional priority guidance. Critique from a regional/cultural perspective and return a REVISED brief plus a review note.

Focus on:
- Does the campaign message and tone feel NATIVE to the declared \`targetRegion\`, or is it a US-centric default?
- Is the target audience description specific enough for the region, or does it use Western defaults (e.g., "millennials" may mean different things in different markets)?
- Does the season make sense for the region's hemisphere and climate?
- If the region is "Global" — is that actually a cop-out, or genuinely the right call? Challenge if appropriate.
- Are the tone adjectives broadly translatable, or loaded with culture-specific idioms?

Return JSON with this EXACT shape:

{
  "brief": { ...the revised brief matching the schema below... },
  "review": {
    "summary": "One paragraph explaining your edits and why from a regional marketing perspective.",
    "severity": "info" | "caution" | "critical",
    "suggestions": ["short specific suggestion", "short specific suggestion"]
  }
}

Where the brief field matches:
${BRIEF_SCHEMA_BLOCK}

Rules for the revised brief:
- Schema-valid, preserves campaign intent.
- If the draft already nails regional fit, the brief can be identical — say so in the note.
- Return ONLY the JSON object.`,
  },
  {
    id: "legal-compliance",
    label: "Legal / Compliance",
    systemPrompt: `You are a Legal and Compliance reviewer for a global consumer goods company. Your pain point is exposure — "someone used a competitor's trademark in the Brazil campaign". You catch unverified claims, trademark conflicts, regulatory issues, and IP risks BEFORE they reach production.

You will receive a DRAFT campaign brief and optional priority guidance. Critique from a legal/compliance perspective and return a REVISED brief plus a review note.

Focus on:
- Unverified claims in the product description ("world's best", "#1", "scientifically proven", specific health outcomes without disclaimers)
- Competitor references (explicit brand names, "better than X", parody trademarks)
- Regulated category cues (SPF claims for sunscreen, nutritional claims for food, efficacy claims for supplements, earnings claims for finance)
- Specific metrics or numbers the user didn't provide (hallucinated stats are a compliance risk)
- Targeting language that could imply discrimination (age/gender/ability exclusions)
- Hex color collisions with known brand trade dress (reasonable best-effort, not a court)

Return JSON with this EXACT shape:

{
  "brief": { ...the revised brief matching the schema below... },
  "review": {
    "summary": "One paragraph explaining your edits and why from a legal/compliance perspective. If you found nothing to flag, SAY SO — don't invent concerns.",
    "severity": "info" | "caution" | "critical",
    "suggestions": ["short specific suggestion", "short specific suggestion"]
  }
}

Where the brief field matches:
${BRIEF_SCHEMA_BLOCK}

Rules for the revised brief:
- Schema-valid, preserves campaign intent.
- Your edits should be SURGICAL — only touch fields where you found a specific issue. Don't rewrite the whole thing for style reasons.
- If you truly find nothing to fix, return the draft unchanged and set severity to "info".
- Return ONLY the JSON object.`,
  },
  {
    id: "cmo",
    label: "CMO",
    systemPrompt: `You are the CMO of a global consumer goods company that spends $12M/year on creative production. Your pain point is measurement — "I can't tell which variants drive conversions". You evaluate campaigns for ROI signal: does this brief have the hooks that will actually convert viewers into buyers?

You will receive a DRAFT campaign brief and optional priority guidance. Critique from a CMO / ROI perspective and return a REVISED brief plus a review note.

Focus on:
- Does the campaign message have a specific, measurable CALL TO ACTION implied? (Shop now? Learn more? Book a trial? Swipe up?)
- Does the product description translate to a "reason to buy" a viewer would care about, or is it self-referential?
- Is the target audience specific enough that you can estimate CAC/CPA? "Adults" can't be measured; "Urban millennial women 28-38 with HHI >$75k" can.
- Does the tone match the audience's expectations? A luxury skincare product in a "dynamic, bold, athletic" tone is a mismatch.
- Are the keyFeatures OUTCOMES (what the buyer gets) or specs (what it is)? Outcomes convert better.

Return JSON with this EXACT shape:

{
  "brief": { ...the revised brief matching the schema below... },
  "review": {
    "summary": "One paragraph explaining your edits and why from a CMO/ROI perspective.",
    "severity": "info" | "caution" | "critical",
    "suggestions": ["short specific suggestion", "short specific suggestion"]
  }
}

Where the brief field matches:
${BRIEF_SCHEMA_BLOCK}

Rules for the revised brief:
- Schema-valid, preserves campaign intent.
- Your edits should sharpen conversion signal, not change the product.
- Return ONLY the JSON object.`,
  },
];

interface ReviewerOutput {
  agentId: ReviewerAgentId;
  agentLabel: string;
  brief: GenerateRequestBody;
  note: AgentReviewNote;
}

async function runReviewer(
  client: OpenAI,
  reviewer: ReviewerDefinition,
  draftBrief: GenerateRequestBody,
  triagePriority: string | undefined
): Promise<ReviewerOutput> {
  const userMessage = [
    triagePriority ? `TRIAGE PRIORITY FOR YOU: ${triagePriority}\n` : "",
    `DRAFT BRIEF TO REVIEW:\n${JSON.stringify(draftBrief, null, 2)}`,
  ].join("");

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: reviewer.systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: REVIEW_TEMPERATURE,
    max_tokens: 2500,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`${reviewer.label} returned empty content`);
  }
  const raw = JSON.parse(content) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("brief" in raw) ||
    !("review" in raw)
  ) {
    throw new Error(`${reviewer.label} returned malformed output`);
  }

  const typed = raw as {
    brief: unknown;
    review: {
      summary?: unknown;
      severity?: unknown;
      suggestions?: unknown;
    };
  };

  const briefValidation = campaignBriefSchema.safeParse(typed.brief);
  if (!briefValidation.success) {
    const issues = briefValidation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `${reviewer.label} produced schema-invalid brief: ${issues}`
    );
  }

  const summary =
    typeof typed.review?.summary === "string"
      ? typed.review.summary
      : "(no summary)";
  const rawSeverity = typed.review?.severity;
  const severity: AgentReviewNote["severity"] =
    rawSeverity === "critical" || rawSeverity === "caution"
      ? rawSeverity
      : "info";
  const suggestions = Array.isArray(typed.review?.suggestions)
    ? typed.review.suggestions.filter((s): s is string => typeof s === "string")
    : undefined;

  return {
    agentId: reviewer.id,
    agentLabel: reviewer.label,
    brief: briefValidation.data,
    note: {
      agentId: reviewer.id,
      agentLabel: reviewer.label,
      summary,
      severity,
      suggestions,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 4: Synthesis
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM_PROMPT = `You are the orchestration lead for a marketing agency. Four specialist reviewers (Creative Director, Regional Marketing Lead, Legal/Compliance, CMO) have each reviewed a draft campaign brief and proposed their own revised version plus a review note.

Your job is to SYNTHESIZE the final brief by merging the reviewers' edits intelligently. You are the tie-breaker when reviewers disagree. You preserve the original campaign intent while incorporating each reviewer's best insights.

Return JSON with this EXACT shape:

{
  "brief": { ...the final synthesized brief matching the schema below... },
  "rationale": "One paragraph explaining which reviewer influenced which field and why."
}

Where the brief field matches:
${BRIEF_SCHEMA_BLOCK}

Synthesis rules:
- The final brief MUST be schema-valid.
- Weight critical-severity legal flags heavily — if Legal said cut a claim, cut it.
- Weight the Creative Director for visual field edits (description, keyFeatures, color, tone).
- Weight the Regional Lead for targetRegion, targetAudience, tone regional fit, and season.
- Weight the CMO for the campaign message wording (conversion signal) and audience specificity.
- If two reviewers edited the same field in compatible ways, take the stronger version.
- If two reviewers conflict, pick the one whose lane it was (Legal wins on claims, Creative wins on visual description, etc.).
- Do NOT invent new facts or details not present in any reviewer's brief.
- Return ONLY the JSON object. No markdown fences. No prose.`;

async function runSynthesis(
  client: OpenAI,
  draft: GenerateRequestBody,
  reviewerOutputs: ReviewerOutput[]
): Promise<{ brief: GenerateRequestBody; rationale: string }> {
  const reviewerBlock = reviewerOutputs
    .map(
      (r) =>
        `### ${r.agentLabel} (severity: ${r.note.severity})\n\nReview: ${r.note.summary}\n\nRevised brief:\n${JSON.stringify(r.brief, null, 2)}`
    )
    .join("\n\n");

  const userMessage = `ORIGINAL DRAFT:\n${JSON.stringify(draft, null, 2)}\n\n---\n\nREVIEWER OUTPUTS:\n\n${reviewerBlock}`;

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: SYNTHESIS_TEMPERATURE,
    max_tokens: 2500,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Synthesis agent returned empty content");
  }
  const raw = JSON.parse(content) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("brief" in raw) ||
    !("rationale" in raw)
  ) {
    throw new Error("Synthesis agent returned malformed output");
  }
  const typed = raw as { brief: unknown; rationale: unknown };
  const briefValidation = campaignBriefSchema.safeParse(typed.brief);
  if (!briefValidation.success) {
    const issues = briefValidation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Synthesis output failed schema validation: ${issues}`);
  }
  const rationale =
    typeof typed.rationale === "string"
      ? typed.rationale
      : "(no rationale)";
  return { brief: briefValidation.data, rationale };
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full multi-agent orchestration and return the final brief
 * plus per-stakeholder review notes.
 *
 * @param client - OpenAI client (obtained from `getOpenAIClient()`)
 * @param userPrompt - Natural-language campaign description from the user
 * @param existingBrief - Optional partial form state to preserve intentional edits
 *
 * Throws on catastrophic failure (triage, draft, or synthesis failed
 * AND we have no usable fallback brief). Partial reviewer failures are
 * non-fatal — the synthesis proceeds with whatever reviewers succeeded.
 */
export async function orchestrateBrief(
  client: OpenAI,
  userPrompt: string,
  existingBrief: GenerateRequestBody | null
): Promise<OrchestrationResult> {
  const totalStart = performance.now();
  const notes: AgentReviewNote[] = [];

  // Phase 1: Triage
  const triageStart = performance.now();
  let triage: TriageResult;
  try {
    triage = await runTriage(client, userPrompt, existingBrief);
  } catch (error) {
    // Triage is non-critical — if it fails, we skip it and proceed
    // with no priority guidance. The reviewers still work, just with
    // generic instructions.
    console.warn("[agents] triage failed, continuing without priorities:", error);
    triage = {
      rationale:
        "Orchestrator triage unavailable — reviewers worked from default priorities.",
      priorities: {},
    };
  }
  const triageMs = Math.round(performance.now() - triageStart);

  notes.push({
    agentId: "triage",
    agentLabel: "Orchestrator (Triage)",
    summary: triage.rationale,
    severity: "info",
  });

  // Phase 2: Draft
  const draftStart = performance.now();
  const draftBrief = await runDraft(client, userPrompt, existingBrief);
  const draftMs = Math.round(performance.now() - draftStart);
  notes.push({
    agentId: "campaign-manager",
    agentLabel: "Campaign Manager",
    summary:
      "Drafted the initial brief from your description, focusing on speed and shipping a defensible baseline for the specialist reviewers.",
    severity: "info",
  });

  // Phase 3: Review — run all reviewers in parallel, tolerate
  // individual failures
  const reviewStart = performance.now();
  const reviewSettled = await Promise.allSettled(
    REVIEWERS.map((reviewer) =>
      runReviewer(client, reviewer, draftBrief, triage.priorities[reviewer.id])
    )
  );
  const reviewMs = Math.round(performance.now() - reviewStart);

  const successfulReviews: ReviewerOutput[] = [];
  reviewSettled.forEach((result, idx) => {
    const reviewer = REVIEWERS[idx];
    if (result.status === "fulfilled") {
      successfulReviews.push(result.value);
      notes.push(result.value.note);
    } else {
      console.warn(
        `[agents] ${reviewer.label} review failed, skipping:`,
        result.reason
      );
      notes.push({
        agentId: reviewer.id,
        agentLabel: reviewer.label,
        summary: `${reviewer.label} review was unavailable for this run. Falling back to the draft.`,
        severity: "info",
      });
    }
  });

  // Phase 4: Synthesis (or fallback to draft if no reviewers succeeded)
  const synthesisStart = performance.now();
  let finalBrief: GenerateRequestBody = draftBrief;
  let synthesisRationale =
    "No reviewer feedback was available for this run — the draft is returned as-is.";
  if (successfulReviews.length > 0) {
    try {
      const synth = await runSynthesis(client, draftBrief, successfulReviews);
      finalBrief = synth.brief;
      synthesisRationale = synth.rationale;
    } catch (error) {
      console.warn(
        "[agents] synthesis failed, returning draft as final brief:",
        error
      );
      synthesisRationale = `Synthesis step failed — returning the draft as final. Raw error logged with the requestId.`;
    }
  }
  const synthesisMs = Math.round(performance.now() - synthesisStart);

  notes.push({
    agentId: "synthesis",
    agentLabel: "Orchestrator (Synthesis)",
    summary: synthesisRationale,
    severity: "info",
  });

  const totalMs = Math.round(performance.now() - totalStart);

  return {
    brief: finalBrief,
    notes,
    triageRationale: triage.rationale,
    phaseMs: {
      triage: triageMs,
      draft: draftMs,
      review: reviewMs,
      synthesis: synthesisMs,
      total: totalMs,
    },
  };
}
