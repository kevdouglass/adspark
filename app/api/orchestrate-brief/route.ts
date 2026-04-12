/**
 * POST /api/orchestrate-brief — Multi-agent campaign brief orchestration.
 *
 * Thin HTTP handler. Delegates to `lib/ai/agents.ts` which runs the
 * 4-phase stakeholder orchestration:
 *
 *   1. Triage       — orchestrator plans the review priorities
 *   2. Draft        — Campaign Manager drafts the initial brief
 *   3. Review       — 4 parallel specialist reviewers (Creative Dir,
 *                     Regional Lead, Legal/Compliance, CMO)
 *   4. Synthesis    — orchestrator merges reviewer edits into final brief
 *
 * The 5 stakeholders map to the "5 Users Who Care" in
 * `knowledge-base/01-assessment/business-context.md` — this is NOT
 * arbitrary persona-picking, it's grounded in the AdSpark target
 * workflow documented in the assessment context.
 *
 * The frontend (BriefForm.onSubmit) calls this endpoint FIRST, uses
 * the returned `brief` to atomically populate the form, and only then
 * calls /api/generate to run the actual DALL-E pipeline. Keeping the
 * two routes separate:
 *   - stays under the 60s Vercel function limit (orchestration is
 *     ~10-12s, pipeline is ~30-50s — combined could exceed 60s)
 *   - lets the frontend show distinct "refining brief" vs "generating"
 *     phases in the progress UI
 *   - makes each endpoint independently retryable on failure
 *
 * Same security defenses as /api/generate:
 *   - Env var validation at entry (fail fast)
 *   - Request body size limit at the stream level
 *   - Prompt length cap (1000 chars)
 *   - Error messages sanitized — raw OpenAI errors never leaked to client
 *   - requestId correlation in every response
 */

import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { campaignBriefSchema } from "@/lib/pipeline/briefParser";
import {
  getOpenAIClient,
  createRequestContext,
  validateRequiredEnv,
  MissingConfigurationError,
} from "@/lib/api/services";
import { buildApiError, sanitizeErrorMessage } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import type { GenerateRequestBody } from "@/lib/api/types";
import { orchestrateBrief } from "@/lib/ai/agents";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_PROMPT_CHARS = 1000;

async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "read_error" }
> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_error" };
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export async function POST(request: Request): Promise<Response> {
  const ctx = createRequestContext();

  // Fail fast on missing config
  try {
    validateRequiredEnv();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      console.error(
        `[${ctx.requestId}] MissingConfigurationError:`,
        error.message
      );
      return NextResponse.json(
        buildApiError(
          "MISSING_CONFIGURATION",
          "Server configuration error. Contact support with the requestId.",
          ctx.requestId
        ) satisfies ApiError,
        { status: 500 }
      );
    }
    console.error(
      `[${ctx.requestId}] Unexpected env validation error:`,
      error
    );
    return NextResponse.json(
      buildApiError(
        "INTERNAL_ERROR",
        sanitizeErrorMessage(error),
        ctx.requestId
      ) satisfies ApiError,
      { status: 500 }
    );
  }

  const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      return NextResponse.json(
        buildApiError(
          "REQUEST_TOO_LARGE",
          `Request body exceeds ${MAX_BODY_BYTES} bytes`,
          ctx.requestId
        ) satisfies ApiError,
        { status: 413 }
      );
    }
    return NextResponse.json(
      buildApiError(
        "INTERNAL_ERROR",
        "Failed to read request body",
        ctx.requestId
      ) satisfies ApiError,
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    return NextResponse.json(
      buildApiError(
        "INVALID_JSON",
        "Request body must be valid JSON",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("prompt" in body) ||
    typeof (body as { prompt: unknown }).prompt !== "string"
  ) {
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        "Request body must be an object with a 'prompt' string field",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  const userPrompt = (body as { prompt: string }).prompt.trim();
  if (userPrompt.length === 0) {
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        "prompt must be non-empty",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }
  if (userPrompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        `prompt must be ${MAX_PROMPT_CHARS} characters or fewer`,
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  // Optional existingBrief (partial form state). Tolerant validation —
  // if it fails schema, we log and proceed without it rather than 400ing.
  let existingBrief: GenerateRequestBody | null = null;
  if (
    "existingBrief" in body &&
    (body as { existingBrief: unknown }).existingBrief != null
  ) {
    const candidate = (body as { existingBrief: unknown }).existingBrief;
    const parsed = campaignBriefSchema.safeParse(candidate);
    if (parsed.success) {
      existingBrief = parsed.data;
    } else {
      console.warn(
        `[${ctx.requestId}] existingBrief failed schema validation, ignoring:`,
        parsed.error.issues
      );
    }
  }

  let client: OpenAI;
  try {
    client = getOpenAIClient();
  } catch (error) {
    console.error(
      `[${ctx.requestId}] Service initialization failed:`,
      error
    );
    return NextResponse.json(
      buildApiError(
        "MISSING_CONFIGURATION",
        "Server configuration error. Contact support with the requestId.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 500 }
    );
  }

  try {
    const orchestration = await orchestrateBrief(
      client,
      userPrompt,
      existingBrief
    );
    return NextResponse.json(
      {
        brief: orchestration.brief,
        notes: orchestration.notes,
        triageRationale: orchestration.triageRationale,
        phaseMs: orchestration.phaseMs,
        requestId: ctx.requestId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      `[${ctx.requestId}] Orchestration failed:`,
      error
    );
    return NextResponse.json(
      buildApiError(
        "UPSTREAM_ERROR",
        "Brief orchestration failed. Please try rephrasing your description or try again.",
        ctx.requestId,
        error instanceof Error ? [error.message] : undefined
      ) satisfies ApiError,
      { status: 502 }
    );
  }
}
