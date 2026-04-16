import { describe, it, expect } from "vitest";
import {
  SessionError,
  mapSessionErrorToHttp,
} from "@/lib/sessions/sessionErrors";
import type { SessionErrorCause } from "@/lib/sessions/sessionErrors";

describe("SessionError", () => {
  it("stores the cause discriminant", () => {
    const err = new SessionError("not found", "session_not_found");
    expect(err.cause).toBe("session_not_found");
    expect(err.message).toBe("not found");
    expect(err.name).toBe("SessionError");
  });

  it("is an instance of Error", () => {
    const err = new SessionError("test", "storage_error");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SessionError);
  });
});

describe("mapSessionErrorToHttp", () => {
  const requestId = "test-req-123";

  const cases: Array<{
    cause: SessionErrorCause;
    expectedStatus: number;
    expectedCode: string;
  }> = [
    { cause: "session_not_found", expectedStatus: 404, expectedCode: "NOT_FOUND" },
    { cause: "session_conflict", expectedStatus: 409, expectedCode: "SESSION_CONFLICT" },
    { cause: "session_not_ready", expectedStatus: 400, expectedCode: "INVALID_BRIEF" },
    { cause: "invalid_transition", expectedStatus: 400, expectedCode: "INVALID_BRIEF" },
    { cause: "storage_error", expectedStatus: 500, expectedCode: "STORAGE_ERROR" },
    { cause: "invalid_brief", expectedStatus: 400, expectedCode: "INVALID_BRIEF" },
  ];

  it.each(cases)(
    "maps $cause → HTTP $expectedStatus $expectedCode",
    ({ cause, expectedStatus, expectedCode }) => {
      const err = new SessionError(`test: ${cause}`, cause);
      const { status, body } = mapSessionErrorToHttp(err, requestId);

      expect(status).toBe(expectedStatus);
      expect(body.code).toBe(expectedCode);
      expect(body.requestId).toBe(requestId);
      expect(body.message).toBe(`test: ${cause}`);
    }
  );

  it("includes details array for invalid_brief", () => {
    const err = new SessionError("message too long", "invalid_brief");
    const { body } = mapSessionErrorToHttp(err, requestId);
    expect(body.details).toEqual(["message too long"]);
  });

  it("omits details for non-brief errors", () => {
    const err = new SessionError("not found", "session_not_found");
    const { body } = mapSessionErrorToHttp(err, requestId);
    expect(body.details).toBeUndefined();
  });
});
