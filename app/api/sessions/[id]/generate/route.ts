import { NextResponse } from "next/server";
import {
  createRequestContext,
  getStorage,
  getOpenAIClient,
  validateRequiredEnv,
  MissingConfigurationError,
} from "@/lib/api/services";
import { LogEvents } from "@/lib/api/logEvents";
import { buildApiError, sanitizeErrorMessage } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { createSessionStore } from "@/lib/sessions/sessionStore";
import { createSessionService } from "@/lib/sessions/sessionService";
import { toRunDto } from "@/lib/sessions/sessionMappers";
import { toGenerateSuccessResponseBody } from "@/lib/api/mappers";
import { SessionError, mapSessionErrorToHttp } from "@/lib/sessions/sessionErrors";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const ctx = createRequestContext();
  const { id } = await params;
  ctx.log(LogEvents.SessionGenerate, {
    route: `/api/sessions/${id}/generate`,
  });

  try {
    validateRequiredEnv();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      const body = buildApiError(
        "MISSING_CONFIGURATION",
        "Server configuration error. Contact support with the requestId.",
        ctx.requestId
      ) satisfies ApiError;
      return NextResponse.json(body, { status: 500 });
    }
    const body = buildApiError(
      "INTERNAL_ERROR",
      sanitizeErrorMessage(error),
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }

  try {
    const storage = getStorage();
    const client = getOpenAIClient();
    const store = createSessionStore(storage);
    const service = createSessionService(store);

    const { run, pipelineResult } = await service.generate(
      id,
      storage,
      client,
      ctx
    );

    const responseBody = {
      ...toGenerateSuccessResponseBody(pipelineResult, ctx.requestId),
      runId: run.id,
      run: toRunDto(run),
    };

    return NextResponse.json(responseBody);
  } catch (err) {
    if (err instanceof SessionError) {
      const { status, body } = mapSessionErrorToHttp(err, ctx.requestId);
      return NextResponse.json(body, { status });
    }
    ctx.log(LogEvents.RequestFailed, {
      error: err instanceof Error ? err.message : "unknown",
    });
    const body = buildApiError(
      "INTERNAL_ERROR",
      "Generation failed. Check requestId for details.",
      ctx.requestId
    ) satisfies ApiError;
    return NextResponse.json(body, { status: 500 });
  }
}
