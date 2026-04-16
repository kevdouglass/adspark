import { NextResponse } from "next/server";
import { createRequestContext, getStorage } from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { buildApiError, MAX_REQUEST_BODY_BYTES } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { createSessionStore } from "@/lib/sessions/sessionStore";
import { createSessionService } from "@/lib/sessions/sessionService";
import { toSessionListItem, toSessionDto } from "@/lib/sessions/sessionMappers";
import { SessionError, mapSessionErrorToHttp } from "@/lib/sessions/sessionErrors";
import type { CreateSessionRequest } from "@/lib/api/sessions/dtos";

export async function GET(): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.SessionList, { route: "/api/sessions" });

  try {
    const storage = getStorage();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    const entries = await service.listSessions();
    return NextResponse.json({ sessions: entries.map(toSessionListItem) });
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Failed to list sessions",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.SessionCreate, { route: "/api/sessions" });

  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BODY_BYTES) {
      const body = buildApiError(
        "REQUEST_TOO_LARGE",
        "Request body exceeds size limit",
        ctx.requestId
      ) satisfies ApiError;
      return NextResponse.json(body, { status: 413 });
    }

    let input: CreateSessionRequest = {};
    if (text.trim().length > 0) {
      try {
        input = JSON.parse(text) as CreateSessionRequest;
      } catch {
        const body = buildApiError(
          "INVALID_JSON",
          "Request body is not valid JSON",
          ctx.requestId
        ) satisfies ApiError;
        return NextResponse.json(body, { status: 400 });
      }
    }

    const storage = getStorage();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    const session = await service.createSession({
      title: input.title,
      brief: input.brief,
    });

    return NextResponse.json({ session: toSessionDto(session) }, { status: 201 });
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Failed to create session",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}
