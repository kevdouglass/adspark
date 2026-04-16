import type { ApiError, ApiErrorCode } from "@/lib/api/errors";

export type SessionErrorCause =
  | "session_not_found"
  | "session_conflict"
  | "session_not_ready"
  | "invalid_transition"
  | "storage_error"
  | "invalid_brief";

export class SessionError extends Error {
  readonly cause: SessionErrorCause;

  constructor(message: string, cause: SessionErrorCause) {
    super(message);
    this.name = "SessionError";
    this.cause = cause;
    Object.setPrototypeOf(this, SessionError.prototype);
  }
}

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled session error cause: ${x}`);
}

function buildApiError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: string[]
): ApiError {
  return { code, message, requestId, ...(details ? { details } : {}) };
}

export function mapSessionErrorToHttp(
  error: SessionError,
  requestId: string
): { status: number; body: ApiError } {
  const cause = error.cause;
  switch (cause) {
    case "session_not_found":
      return {
        status: 404,
        body: buildApiError("NOT_FOUND", error.message, requestId),
      };
    case "session_conflict":
      return {
        status: 409,
        body: buildApiError("SESSION_CONFLICT", error.message, requestId),
      };
    case "session_not_ready":
      return {
        status: 400,
        body: buildApiError("INVALID_BRIEF", error.message, requestId),
      };
    case "invalid_transition":
      return {
        status: 400,
        body: buildApiError("INVALID_BRIEF", error.message, requestId),
      };
    case "storage_error":
      return {
        status: 500,
        body: buildApiError("STORAGE_ERROR", error.message, requestId),
      };
    case "invalid_brief":
      return {
        status: 400,
        body: buildApiError("INVALID_BRIEF", error.message, requestId, [
          error.message,
        ]),
      };
    default:
      return assertUnreachable(cause);
  }
}
