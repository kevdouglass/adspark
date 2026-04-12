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
 * - Request body size limited to 50KB at the boundary (prevents memory DoS)
 * - All API keys validated at route entry, fail fast
 * - No NEXT_PUBLIC_ env vars accessed (server-side only)
 * - requestId (UUID) returned in every response for log correlation
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 */

import { NextResponse } from "next/server";
import { parseBrief } from "@/lib/pipeline/briefParser";
import { runPipeline } from "@/lib/pipeline/pipeline";
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
  MAX_REQUEST_BODY_BYTES,
  type ApiError,
} from "@/lib/api/errors";

export async function POST(request: Request): Promise<Response> {
  // Create request context first so we have a requestId for EVERY response,
  // even error responses that happen before the pipeline starts.
  const ctx = createRequestContext();

  // Gap A: Request body size limit (HTTP 413 Payload Too Large)
  // Enforced BEFORE request.json() so a malicious 100MB payload never
  // reaches our JSON parser.
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      buildApiError(
        "REQUEST_TOO_LARGE",
        `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`,
        ctx.requestId
      ),
      { status: 413 }
    );
  }

  // Parse the JSON body (guarded try/catch — malformed JSON = 400, not 500)
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      buildApiError(
        "INVALID_JSON",
        "Request body must be valid JSON",
        ctx.requestId
      ),
      { status: 400 }
    );
  }

  // Validate the campaign brief schema via Zod
  const parseResult = parseBrief(body);
  if (!parseResult.success) {
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        "Campaign brief validation failed",
        ctx.requestId,
        parseResult.errors
      ),
      { status: 400 }
    );
  }

  // Validate required env vars — fail fast BEFORE touching OpenAI or storage
  try {
    validateRequiredEnv();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      return NextResponse.json(
        buildApiError(
          "MISSING_CONFIGURATION",
          error.message,
          ctx.requestId
        ),
        { status: 500 }
      );
    }
    // Unknown error during validation — should never happen
    return NextResponse.json(
      buildApiError(
        "INTERNAL_ERROR",
        "Environment validation failed unexpectedly",
        ctx.requestId
      ),
      { status: 500 }
    );
  }

  // Instantiate per-request dependencies (NOT singletons — serverless safety)
  let client, storage;
  try {
    client = getOpenAIClient();
    storage = getStorage();
  } catch (error) {
    return NextResponse.json(
      buildApiError(
        "MISSING_CONFIGURATION",
        error instanceof Error ? error.message : "Service initialization failed",
        ctx.requestId
      ),
      { status: 500 }
    );
  }

  // Run the pipeline end-to-end
  try {
    const result = await runPipeline(parseResult.brief, storage, client, ctx);

    // If the pipeline produced creatives, return 200 even with partial errors.
    // Partial failure is a successful response with error details — not an HTTP error.
    if (result.creatives.length > 0) {
      return NextResponse.json(
        {
          ...result,
          requestId: ctx.requestId,
        },
        { status: 200 }
      );
    }

    // Zero creatives — surface the highest-severity error as the HTTP response.
    // The full error list is still included in the body for debugging.
    const firstError = result.errors[0];
    if (firstError) {
      const { status, body: errorBody } = mapPipelineErrorToApiError(
        firstError,
        ctx.requestId
      );
      return NextResponse.json(
        {
          ...errorBody,
          details: result.errors.map((e) => `[${e.stage}] ${e.message}`),
        },
        { status }
      );
    }

    // No creatives AND no errors — shouldn't happen, but surface as 500
    return NextResponse.json(
      buildApiError(
        "INTERNAL_ERROR",
        "Pipeline completed with no creatives and no errors",
        ctx.requestId
      ),
      { status: 500 }
    );
  } catch (error) {
    // Catastrophic failures (OrganizationError, unhandled exceptions) land here
    const apiError: ApiError = buildApiError(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Unknown pipeline error",
      ctx.requestId
    );
    return NextResponse.json(apiError, { status: 500 });
  }
}
