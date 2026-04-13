/**
 * Multi-agent orchestrator — structured event emission contract tests.
 *
 * Before these tests were written, the entire 4-phase orchestration
 * (triage → draft → 4 reviewers → synthesis) was INVISIBLE to the
 * structured log stream. A reviewer who asked "which agent blew up?"
 * could only get an answer by reading source. These tests lock in:
 *
 *   1. Every phase emits `agent.phase.start` + `agent.phase.done` on
 *      success (or `agent.phase.failed` on failure).
 *   2. Every event carries a `phase` field so greps can isolate a
 *      single phase across the 5 distinct events.
 *   3. Review phase events additionally carry a `stakeholder` field
 *      identifying which of the 4 reviewers.
 *   4. Every event carries a `promptHash` so A/B prompt testing can
 *      correlate log entries with prompt-builder changes.
 *   5. `.done` events carry `tokensIn` / `tokensOut` pulled from the
 *      OpenAI `completion.usage` field — zero-cost billing visibility.
 *   6. A failed reviewer does NOT break the orchestration (`Promise.
 *      allSettled` semantics) — events are still emitted for the
 *      survivors and for the failed one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type OpenAI from "openai";
import { orchestrateBrief } from "@/lib/ai/agents";
import {
  createRequestContext,
  setLogSink,
  type LogRecord,
  type LogSink,
} from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import type { GenerateRequestBody } from "@/lib/api/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createCollectingSink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = (record) => {
    records.push(record);
  };
  return { sink, records };
}

const VALID_BRIEF: GenerateRequestBody = {
  campaign: {
    id: "test-campaign",
    name: "Test Campaign",
    message: "Test Message",
    targetRegion: "North America",
    targetAudience: "Testers",
    tone: "minimal, clean, direct",
    season: "summer",
  },
  products: [
    {
      name: "Test Product",
      slug: "test-product",
      description: "A test product for orchestration",
      category: "test",
      keyFeatures: ["feature-a", "feature-b", "feature-c"],
      color: "#FF0000",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1", "9:16", "16:9"],
  outputFormats: { creative: "png", thumbnail: "webp" },
};

/**
 * Build a mocked OpenAI client whose chat.completions.create always
 * returns a JSON-string response matching the shape each phase expects.
 * The mock varies its response based on the system prompt so a single
 * call pattern handles triage/draft/review/synthesis.
 */
function mockOpenAIClient(
  options: {
    failReviewerIndex?: number;
    failPhase?: "triage" | "draft" | "synthesis";
  } = {}
) {
  let reviewerCallCount = 0;

  const create = vi.fn(
    async (params: {
      messages: Array<{ role: string; content: string }>;
    }) => {
      const systemPrompt = params.messages[0]?.content ?? "";

      // TRIAGE phase
      if (systemPrompt.includes("orchestration lead for a marketing agency") &&
          systemPrompt.includes("review agenda")) {
        if (options.failPhase === "triage") {
          throw new Error("triage boom");
        }
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rationale: "Test triage rationale",
                  priorities: {
                    "creative-director": "focus on visual",
                    "regional-marketing-lead": "focus on region",
                    "legal-compliance": "focus on claims",
                    cmo: "focus on conversion",
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        };
      }

      // DRAFT phase — Campaign Manager system prompt
      if (systemPrompt.includes("Campaign Manager") && systemPrompt.includes("SPEED")) {
        if (options.failPhase === "draft") {
          throw new Error("draft boom");
        }
        return {
          choices: [
            {
              message: { content: JSON.stringify(VALID_BRIEF) },
            },
          ],
          usage: { prompt_tokens: 300, completion_tokens: 400 },
        };
      }

      // SYNTHESIS phase — orchestration lead + synthesize
      if (systemPrompt.includes("orchestration lead") &&
          systemPrompt.includes("SYNTHESIZE")) {
        if (options.failPhase === "synthesis") {
          throw new Error("synthesis boom");
        }
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  brief: VALID_BRIEF,
                  rationale: "Test synthesis rationale",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 800, completion_tokens: 500 },
        };
      }

      // REVIEWER phases — any of the 4 reviewers
      const thisReviewerIndex = reviewerCallCount++;
      if (options.failReviewerIndex === thisReviewerIndex) {
        throw new Error(`reviewer-${thisReviewerIndex} boom`);
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                brief: VALID_BRIEF,
                review: {
                  summary: "Test reviewer summary",
                  severity: "info",
                  suggestions: ["suggestion a", "suggestion b"],
                },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 600, completion_tokens: 350 },
      };
    }
  );

  return {
    chat: { completions: { create } },
  } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orchestrateBrief event emission", () => {
  let restore: LogSink;
  let records: LogRecord[];

  beforeEach(() => {
    const pair = createCollectingSink();
    records = pair.records;
    restore = setLogSink(pair.sink);
  });

  afterEach(() => {
    setLogSink(restore);
  });

  it("emits agent.phase.start + agent.phase.done for all 6 phases (triage + draft + 4 reviewers + synthesis)", async () => {
    const client = mockOpenAIClient();
    const ctx = createRequestContext();

    await orchestrateBrief(client, "Test campaign description", null, ctx);

    const starts = records.filter((r) => r.event === LogEvents.AgentStart);
    const dones = records.filter((r) => r.event === LogEvents.AgentDone);
    const failures = records.filter((r) => r.event === LogEvents.AgentFailed);

    // 1 triage + 1 draft + 4 reviewers + 1 synthesis = 7 starts, 7 dones
    expect(starts).toHaveLength(7);
    expect(dones).toHaveLength(7);
    expect(failures).toHaveLength(0);
  });

  it("every .done event carries promptHash, tokensIn, tokensOut, ms", async () => {
    const client = mockOpenAIClient();
    const ctx = createRequestContext();

    await orchestrateBrief(client, "Test campaign description", null, ctx);

    const dones = records.filter((r) => r.event === LogEvents.AgentDone);
    for (const done of dones) {
      expect(typeof done.promptHash).toBe("string");
      expect((done.promptHash as string).length).toBe(12);
      expect(typeof done.ms).toBe("number");
      expect(done.ms as number).toBeGreaterThanOrEqual(0);
      expect(typeof done.tokensIn).toBe("number");
      expect(typeof done.tokensOut).toBe("number");
      expect(typeof done.model).toBe("string");
    }
  });

  it("review phase events carry a stakeholder field naming the reviewer", async () => {
    const client = mockOpenAIClient();
    const ctx = createRequestContext();

    await orchestrateBrief(client, "Test campaign description", null, ctx);

    const reviewStarts = records.filter(
      (r) => r.event === LogEvents.AgentStart && r.phase === "review"
    );
    expect(reviewStarts).toHaveLength(4);

    const stakeholders = reviewStarts.map((r) => r.stakeholder as string);
    expect(stakeholders).toContain("creative-director");
    expect(stakeholders).toContain("regional-marketing-lead");
    expect(stakeholders).toContain("legal-compliance");
    expect(stakeholders).toContain("cmo");
  });

  it("emits phase=triage/draft/review/synthesis on the appropriate events", async () => {
    const client = mockOpenAIClient();
    const ctx = createRequestContext();

    await orchestrateBrief(client, "Test campaign description", null, ctx);

    const phases = records
      .filter(
        (r) =>
          r.event === LogEvents.AgentStart ||
          r.event === LogEvents.AgentDone ||
          r.event === LogEvents.AgentFailed
      )
      .map((r) => r.phase as string);

    const phaseSet = new Set(phases);
    expect(phaseSet.has("triage")).toBe(true);
    expect(phaseSet.has("draft")).toBe(true);
    expect(phaseSet.has("review")).toBe(true);
    expect(phaseSet.has("synthesis")).toBe(true);
  });

  it("tolerates a single reviewer failure — still emits done events for the others", async () => {
    const client = mockOpenAIClient({ failReviewerIndex: 1 });
    const ctx = createRequestContext();

    // orchestrateBrief uses Promise.allSettled for reviewers; a single
    // failure should NOT abort the orchestration.
    const result = await orchestrateBrief(
      client,
      "Test campaign description",
      null,
      ctx
    );
    expect(result.brief).toBeDefined();

    const reviewDones = records.filter(
      (r) => r.event === LogEvents.AgentDone && r.phase === "review"
    );
    const reviewFails = records.filter(
      (r) => r.event === LogEvents.AgentFailed && r.phase === "review"
    );

    // 3 succeeded, 1 failed — but .done events are emitted BEFORE the
    // reviewer's parse is checked. We count .done as "the one we got a
    // successful response from" which is 3 reviewers.
    // Actually the .done is emitted after schema validation passes,
    // so failed reviewers emit .failed not .done.
    expect(reviewDones.length + reviewFails.length).toBe(4);
    expect(reviewFails.length).toBeGreaterThanOrEqual(1);
  });

  it("every emitted record is JSON-serializable", async () => {
    const client = mockOpenAIClient();
    const ctx = createRequestContext();

    await orchestrateBrief(client, "Test campaign description", null, ctx);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const roundTrip = JSON.parse(JSON.stringify(record));
      expect(roundTrip.event).toBe(record.event);
    }
  });
});
