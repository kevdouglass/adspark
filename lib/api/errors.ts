/**
 * API Error Envelope — Standardized error shape for all API routes.
 *
 * Every error response from every API route MUST match this shape.
 * This is a public contract — frontend consumers, error monitoring,
 * and retry logic all depend on the stable `code` field.
 *
 * See docs/adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md
 */

import type { PipelineError } from "@/lib/pipeline/types";

/**
 * Standard API error response envelope.
 * All API routes return this shape on 4xx/5xx responses.
 */
export interface ApiError {
  /** Stable machine-readable error code for client handling (e.g., "INVALID_BRIEF") */
  code: ApiErrorCode;
  /** Human-readable error message safe to display to end users */
  message: string;
  /** Optional field-level details (e.g., Zod validation errors) */
  details?: string[];
  /** Request correlation ID — include in bug reports and log searches */
  requestId: string;
}

/**
 * Stable error codes — public API contract.
 *
 * Adding a new code is a non-breaking change.
 * Removing or renaming a code is a breaking change and requires version bump.
 */
export type ApiErrorCode =
  // 400-class: client errors
  | "INVALID_JSON"
  | "INVALID_BRIEF"
  | "REQUEST_TOO_LARGE"
  | "CONTENT_POLICY_VIOLATION"
  // 500-class: server errors
  | "MISSING_CONFIGURATION"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_RATE_LIMITED"
  | "STORAGE_ERROR"
  | "PROCESSING_ERROR"
  | "INTERNAL_ERROR";

/**
 * Request body size limit (50KB).
 *
 * Campaign briefs are small JSON documents — a realistic brief is under 5KB
 * (2 products, campaign metadata, aspect ratios). 50KB gives 10x headroom
 * while still preventing DoS via oversized payloads.
 *
 * Enforced at route entry BEFORE calling request.json() so a malicious
 * 100MB payload never reaches our JSON parser.
 */
export const MAX_REQUEST_BODY_BYTES = 50 * 1024;

/**
 * Map a PipelineError (domain-layer) to an ApiError (API contract).
 *
 * This is the authoritative error mapping table. See issue #6 comment
 * for the full mapping rationale. This function is the single source of
 * truth — route handlers never construct ApiError manually from pipeline
 * errors.
 */
export function mapPipelineErrorToApiError(
  pipelineError: PipelineError,
  requestId: string
): { status: number; body: ApiError } {
  // Validation errors → 400
  if (pipelineError.stage === "validating") {
    return {
      status: 400,
      body: {
        code: "INVALID_BRIEF",
        message: pipelineError.message,
        requestId,
      },
    };
  }

  // Generation errors → classify by underlying cause
  if (pipelineError.stage === "generating") {
    const message = pipelineError.message.toLowerCase();
    if (message.includes("content policy")) {
      return {
        status: 422,
        body: {
          code: "CONTENT_POLICY_VIOLATION",
          message: pipelineError.message,
          requestId,
        },
      };
    }
    if (message.includes("rate limit") || message.includes("429")) {
      return {
        status: 503,
        body: {
          code: "UPSTREAM_RATE_LIMITED",
          message: pipelineError.message,
          requestId,
        },
      };
    }
    return {
      status: 502,
      body: {
        code: "UPSTREAM_ERROR",
        message: pipelineError.message,
        requestId,
      },
    };
  }

  // Compositing errors → processing failure
  if (pipelineError.stage === "compositing") {
    return {
      status: 500,
      body: {
        code: "PROCESSING_ERROR",
        message: pipelineError.message,
        requestId,
      },
    };
  }

  // Resolving and organizing errors → storage layer failure
  if (
    pipelineError.stage === "resolving" ||
    pipelineError.stage === "organizing"
  ) {
    return {
      status: 500,
      body: {
        code: "STORAGE_ERROR",
        message: pipelineError.message,
        requestId,
      },
    };
  }

  // Fallback — unknown stage
  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR",
      message: pipelineError.message,
      requestId,
    },
  };
}

/**
 * Build an ApiError response for a specific error code.
 * Used when the error doesn't originate from the pipeline (e.g., oversized
 * request body, malformed JSON, missing env var).
 */
export function buildApiError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: string[]
): ApiError {
  return details ? { code, message, requestId, details } : { code, message, requestId };
}
