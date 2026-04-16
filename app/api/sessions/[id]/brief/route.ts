import { NextResponse } from "next/server";
import { createRequestContext, getStorage } from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { buildApiError, MAX_REQUEST_BODY_BYTES } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { createSessionStore } from "@/lib/sessions/sessionStore";
import { createSessionService } from "@/lib/sessions/sessionService";
import { SessionError, mapSessionErrorToHttp } from "@/lib/sessions/sessionErrors";
import type { UpdateSessionBriefRequest } from "@/lib/api/sessions/dtos";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const ctx = createRequestContext();
  const { id } = await params;
  ctx.log(LogEvents.SessionBriefUpdate, { route: `/api/sessions/${id}/brief` });

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

    let parsed: UpdateSessionBriefRequest;
    try {
      parsed = JSON.parse(text) as UpdateSessionBriefRequest;
    } catch {
      const body = buildApiError(
        "INVALID_JSON",
        "Request body is not valid JSON",
        ctx.requestId
      ) satisfies ApiError;
      return NextResponse.json(body, { status: 400 });
    }

    if (!parsed.brief) {
      const body = buildApiError(
        "INVALID_BRIEF",
        "Request body must contain a 'brief' field",
        ctx.requestId,
        ["brief is required"]
      ) satisfies ApiError;
      return NextResponse.json(body, { status: 400 });
    }

    const storage = getStorage();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    await service.updateBrief(id, parsed.brief);
    return NextResponse.json({});
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Failed to update brief",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}
