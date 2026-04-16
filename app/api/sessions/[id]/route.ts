import { NextResponse } from "next/server";
import { createRequestContext, getStorage } from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { buildApiError } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { createSessionStore } from "@/lib/sessions/sessionStore";
import { createSessionService } from "@/lib/sessions/sessionService";
import { toSessionDto } from "@/lib/sessions/sessionMappers";
import { SessionError, mapSessionErrorToHttp } from "@/lib/sessions/sessionErrors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const ctx = createRequestContext();
  const { id } = await params;
  ctx.log(LogEvents.SessionGet, { route: `/api/sessions/${id}` });

  try {
    const storage = getStorage();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    const session = await service.getSession(id);
    return NextResponse.json({ session: toSessionDto(session) });
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Failed to get session",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}
