/**
 * POST /api/generate — Runs the creative generation pipeline.
 *
 * Accepts a campaign brief JSON, runs the full AdSpark pipeline
 * (parse → resolve → generate → composite → organize), and returns
 * the generated creatives with typed errors and request correlation.
 *
 * WHY thin route handler:
 * Per ADR-002 (integration architecture), API routes are boundaries —
 * parse request, delegate to the pipeline, map errors to HTTP. No business
 * logic lives here. The pipeline orchestrator does all the work.
 *
 * SECURITY:
 * - Request body size limited to 50KB via stream-level byte counting
 *   (Content-Length header alone is insecure — it can be omitted or lied
 *   about via chunked transfer encoding)
 * - Env vars validated at route entry BEFORE any work happens (fail fast)
 * - Raw error messages never leaked in response bodies (sanitized via
 *   sanitizeErrorMessage for catastrophic errors)
 * - No NEXT_PUBLIC_ env vars accessed (server-side only)
 * - requestId (UUID) returned in every response for log correlation
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 * See docs/adr/ADR-003-typed-error-cause-discriminants.md
 */

import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { parseBrief } from "@/lib/pipeline/briefParser";
import { runPipeline } from "@/lib/pipeline/pipeline";
import type { StorageProvider } from "@/lib/pipeline/types";
import {
  getOpenAIClient,
  getStorage,
  createRequestContext,
  validateRequiredEnv,
  MissingConfigurationError,
  LogEvents,
} from "@/lib/api/services";
import {
  buildApiError,
  mapPipelineErrorToApiError,
  sanitizeErrorMessage,
  MAX_REQUEST_BODY_BYTES,
} from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { toGenerateSuccessResponseBody } from "@/lib/api/mappers";
import { PIPELINE_BUDGET_MS } from "@/lib/api/timeouts";

/**
 * Maximum execution duration for this route handler.
 *
 * Vercel's default is 60 seconds (Hobby) or 300 seconds (Pro). The
 * constant below MUST be declared explicitly even on Pro — without it,
 * the route falls back to the 60s default. This export is read by
 * Next.js + Vercel during build to configure the function.
 *
 * 300 seconds matches Vercel Pro's hard ceiling. The actual server-side
 * pipeline budget is enforced by `PIPELINE_BUDGET_MS` in
 * `lib/api/timeouts.ts` (currently 120s) — see that file for the full
 * staggered cascade and the rationale for each layer.
 *
 * Hobby tier note: declaring `maxDuration = 300` on Hobby is harmless;
 * Vercel silently caps it at 60s for Hobby plans.
 *
 * Reference: https://vercel.com/docs/functions/runtimes#max-duration
 */
export const maxDuration = 300;

/**
 * Read a Request body with a hard byte limit enforced at the stream level.
 *
 * Unlike a Content-Length header check (which can be spoofed via chunked
 * transfer encoding or simply omitted), this reads bytes from the stream
 * and throws as soon as the cumulative count exceeds the limit. This is
 * the correct way to defend against payload-based DoS.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; reason: "too_large" | "read_error" }> {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Cancel the stream immediately — don't keep reading
        reader.cancel().catch(() => {
          // ignore cancel errors
        });
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_error" };
  }

  // Concatenate chunks and decode as UTF-8
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export async function POST(request: Request): Promise<Response> {
  // Create request context FIRST so every response — including errors
  // that happen before any pipeline work — gets a correlation UUID.
  const ctx = createRequestContext();
  ctx.log(LogEvents.RequestReceived, {
    route: "/api/generate",
    method: "POST",
  });

  // Finding #9 fix: Validate required env vars FIRST — fail fast BEFORE
  // touching the request body. No point parsing JSON if we can't even
  // call OpenAI. This also surfaces misconfiguration immediately on
  // cold start, not buried after Zod parsing.
  try {
    validateRequiredEnv();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      // Finding #6 fix: don't leak env var names to clients.
      // Internal details go to server logs, generic message goes to client.
      console.error(
        `[${ctx.requestId}] MissingConfigurationError:`,
        error.message
      );
      const errorBody = buildApiError(
        "MISSING_CONFIGURATION",
        "Server configuration error. Contact support with the requestId.",
        ctx.requestId
      ) satisfies ApiError;
      return NextResponse.json(errorBody, { status: 500 });
    }
    console.error(`[${ctx.requestId}] Unexpected env validation error:`, error);
    const errorBody = buildApiError(
      "INTERNAL_ERROR",
      sanitizeErrorMessage(error),
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 500 });
  }

  // Finding #1 + #2 fix: Read body with stream-level byte limit.
  // Content-Length header is NOT a reliable security boundary — it can
  // be omitted (chunked transfer) or non-numeric. The stream-level check
  // is the only correct defense against oversized payloads.
  const bodyResult = await readBodyWithLimit(request, MAX_REQUEST_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      const errorBody = buildApiError(
        "REQUEST_TOO_LARGE",
        `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`,
        ctx.requestId
      ) satisfies ApiError;
      return NextResponse.json(errorBody, { status: 413 });
    }
    const errorBody = buildApiError(
      "INTERNAL_ERROR",
      "Failed to read request body",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 500 });
  }

  // Parse the JSON body (guarded — malformed JSON = 400, not 500)
  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    const errorBody = buildApiError(
      "INVALID_JSON",
      "Request body must be valid JSON",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 400 });
  }

  // Validate the campaign brief schema via Zod
  const parseResult = parseBrief(body);
  if (!parseResult.success) {
    const errorBody = buildApiError(
      "INVALID_BRIEF",
      "Campaign brief validation failed",
      ctx.requestId,
      parseResult.errors
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 400 });
  }

  // Finding #4 fix: explicit type annotations instead of let inference
  let client: OpenAI;
  let storage: StorageProvider;
  try {
    client = getOpenAIClient();
    storage = getStorage();
  } catch (error) {
    console.error(`[${ctx.requestId}] Service initialization failed:`, error);
    const errorBody = buildApiError(
      "MISSING_CONFIGURATION",
      "Server configuration error. Contact support with the requestId.",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 500 });
  }

  // Pipeline budget enforcement via AbortController.
  //
  // WHY this is load-bearing in container mode:
  //
  // On Vercel, the 300s function ceiling was the real kill switch —
  // even if the pipeline's internal budget check (`elapsed > PIPELINE_BUDGET_MS`)
  // only fires AFTER generateImages resolves, the platform guaranteed
  // nothing ran forever. In a long-running container there is no such
  // backstop. A retry cascade behind a 12s exponential backoff × 3
  // attempts × 30s SDK timeout per attempt can legitimately burn
  // ~126s per image with nothing to stop it.
  //
  // The AbortController fires at exactly PIPELINE_BUDGET_MS (120s) and
  // propagates through:
  //   runPipeline(options.signal) →
  //     generateImages(signal) →
  //       generateImage(signal) →
  //         client.images.generate({...}, { signal })  (undici-level cancel)
  //         withRetry({ signal })                       (cancels pending sleep)
  //
  // The result is that a runaway request is cancelled everywhere it
  // could be sitting — in the HTTP call, in the retry sleep, and in
  // the next retry attempt — within a single event-loop tick of the
  // timer firing. Without this, the container has no upper bound on
  // request duration and the client's AbortSignal.timeout(135s) is
  // the only defense; with this, the 135s client timeout becomes the
  // safety net behind a 120s server-side preemption.
  //
  // The timer is cleared in the `finally` block so a successful
  // request does not leak a pending setTimeout (which would keep the
  // event loop alive for no reason and, in a container, inflate the
  // graceful-shutdown window).
  const controller = new AbortController();
  const pipelineBudgetTimer = setTimeout(() => {
    ctx.log(LogEvents.PipelineBudgetAbort, {
      budgetMs: PIPELINE_BUDGET_MS,
    });
    controller.abort();
  }, PIPELINE_BUDGET_MS);

  // Run the pipeline end-to-end
  try {
    const result = await runPipeline(parseResult.brief, storage, client, ctx, {
      signal: controller.signal,
    });

    // If the pipeline produced creatives, return 200 even with partial errors.
    // Partial failure is a successful response with error details — not an HTTP error.
    //
    // `toGenerateSuccessResponseBody` explicitly projects PipelineResult to
    // the public wire shape (lib/api/types.ts). Fields are enumerated in the
    // mapper, so future additions to PipelineResult do not auto-ship over
    // the wire — the mapper IS the review gate. See ADR-006.
    if (result.creatives.length > 0) {
      const successBody = toGenerateSuccessResponseBody(result, ctx.requestId);
      ctx.log(LogEvents.RequestComplete, {
        status: 200,
        creatives: result.creatives.length,
        errors: result.errors.length,
        totalMs: result.totalTimeMs,
      });
      return NextResponse.json(successBody, { status: 200 });
    }

    // Zero creatives — surface the highest-severity error as the HTTP response.
    // The full error list is still included in the body for debugging.
    const firstError = result.errors[0];
    if (firstError) {
      const { status, body: mappedError } = mapPipelineErrorToApiError(
        firstError,
        ctx.requestId
      );
      const errorBody = {
        ...mappedError,
        details: result.errors.map((e) => `[${e.stage}] ${e.message}`),
      } satisfies ApiError;
      ctx.log(LogEvents.RequestComplete, {
        status,
        creatives: 0,
        errors: result.errors.length,
        code: mappedError.code,
      });
      return NextResponse.json(errorBody, { status });
    }

    // No creatives AND no errors — shouldn't happen, but surface as 500
    const errorBody = buildApiError(
      "INTERNAL_ERROR",
      "Pipeline completed with no creatives and no errors",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 500 });
  } catch (error) {
    // Finding #7 fix: Sanitize catastrophic error messages.
    // OrganizationError and unhandled exceptions land here — the raw
    // error.message may contain stack traces, SDK internals, or secrets
    // echoed in URLs. Log the original server-side, send generic to client.
    console.error(`[${ctx.requestId}] Catastrophic pipeline error:`, error);
    ctx.log(LogEvents.RequestFailed, {
      errorType: error instanceof Error ? error.constructor.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });

    // Issue #59 follow-up — surface SAFE error metadata to the client so the
    // browser network tab can show enough to diagnose without leaking
    // secrets. The error class name (e.g. "TypeError", "OpenAI.APIError",
    // "S3ServiceException") tells you WHICH library or pattern failed; the
    // first stack frame tells you WHERE without exposing the message
    // content (which may contain values, URLs, or sanitized PII).
    const errorMeta: string[] = [];
    if (error instanceof Error) {
      errorMeta.push(`type: ${error.constructor.name}`);
      if (error.stack) {
        const firstFrame = error.stack
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("at "));
        if (firstFrame) {
          // Strip absolute file paths (which may contain usernames) — keep
          // only the file basename + line number for safe public surface.
          const safeFrame = firstFrame.replace(
            /\(?(?:[a-zA-Z]:)?[\\/].*[\\/]([^\\/]+:\d+:\d+)\)?$/,
            "($1)"
          );
          errorMeta.push(`origin: ${safeFrame}`);
        }
      }
    }

    const errorBody = buildApiError(
      "INTERNAL_ERROR",
      sanitizeErrorMessage(error),
      ctx.requestId,
      errorMeta.length > 0 ? errorMeta : undefined
    ) satisfies ApiError;
    return NextResponse.json(errorBody, { status: 500 });
  } finally {
    // Clear the pipeline-budget timer on every exit path so a successful
    // request does not leak a pending setTimeout into the event loop.
    // A lingering timer would keep the Node process alive long enough
    // to inflate the graceful-shutdown window in a container.
    clearTimeout(pipelineBudgetTimer);
  }
}
