import { NextResponse } from "next/server";
import { createRequestContext, getStorage } from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { buildApiError } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { createSessionStore } from "@/lib/sessions/sessionStore";
import { createSessionService } from "@/lib/sessions/sessionService";
import { toRunDto } from "@/lib/sessions/sessionMappers";
import { SessionError, mapSessionErrorToHttp } from "@/lib/sessions/sessionErrors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const ctx = createRequestContext();
  const { id } = await params;
  ctx.log(LogEvents.SessionList, { route: `/api/sessions/${id}/runs` });

  try {
    const storage = getStorage();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    const runs = await service.listRuns(id);
    return NextResponse.json({ runs: runs.map(toRunDto) });
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Failed to list runs",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}
