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
} from "@/lib/api/services";
import {
  buildApiError,
  mapPipelineErrorToApiError,
  sanitizeErrorMessage,
  MAX_REQUEST_BODY_BYTES,
} from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { toGenerateSuccessResponseBody } from "@/lib/api/mappers";

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

  // Run the pipeline end-to-end
  try {
    const result = await runPipeline(parseResult.brief, storage, client, ctx);

    // If the pipeline produced creatives, return 200 even with partial errors.
    // Partial failure is a successful response with error details — not an HTTP error.
    //
    // `toGenerateSuccessResponseBody` explicitly projects PipelineResult to
    // the public wire shape (lib/api/types.ts). Fields are enumerated in the
    // mapper, so future additions to PipelineResult do not auto-ship over
    // the wire — the mapper IS the review gate. See ADR-006.
    if (result.creatives.length > 0) {
      const successBody = toGenerateSuccessResponseBody(result, ctx.requestId);
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
  }
}
