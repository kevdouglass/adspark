import type OpenAI from "openai";
import type { StorageProvider, PipelineResult } from "@/lib/pipeline/types";
import type { RequestContext } from "@/lib/api/services";
import type { CampaignBriefDto } from "@/lib/api/sessions/dtos";
import type {
  Session,
  Run,
  SessionStatus,
  SessionIndexEntry,
  RunOutput,
} from "./types";
import { SESSION_TRANSITIONS, EMPTY_BRIEF } from "./types";
import type { SessionStore } from "./sessionStore";
import { SessionError } from "./sessionErrors";
import { briefDtoToPipelineBrief } from "./sessionMappers";
import { runPipeline } from "@/lib/pipeline/pipeline";
import { LogEvents } from "@/lib/api/logEvents";
import { PIPELINE_BUDGET_MS } from "@/lib/api/timeouts";

function now(): string {
  return new Date().toISOString();
}

function generateTitle(): string {
  const d = new Date();
  return `Campaign ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} #${Math.random().toString(36).slice(2, 6)}`;
}

function buildSummary(session: Session, latestRun?: Run): string | undefined {
  if (!latestRun) return undefined;
  if (latestRun.status === "completed" && latestRun.totalImages) {
    return `${latestRun.totalImages} creatives generated in ${((latestRun.totalTimeMs ?? 0) / 1000).toFixed(1)}s`;
  }
  if (latestRun.status === "failed") {
    return "Last generation failed";
  }
  return undefined;
}

export interface CreateSessionInput {
  title?: string;
  brief?: CampaignBriefDto;
}

export interface GenerateResult {
  run: Run;
  pipelineResult: PipelineResult;
}

export class SessionService {
  constructor(private readonly store: SessionStore) {}

  async listSessions(): Promise<SessionIndexEntry[]> {
    const index = await this.store.getIndex();
    return index.sessions;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const id = crypto.randomUUID();
    const timestamp = now();
    const hasBrief =
      input.brief !== undefined &&
      input.brief.products.length > 0 &&
      input.brief.campaign.message.length > 0;

    const session: Session = {
      id,
      title: input.title || generateTitle(),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: hasBrief ? "ready" : "draft",
      brief: input.brief ?? EMPTY_BRIEF,
      runIds: [],
    };

    await this.store.saveSession(session);
    await this.upsertIndex(session);
    return session;
  }

  async getSession(id: string): Promise<Session> {
    const session = await this.store.getSession(id);
    if (!session) {
      throw new SessionError(
        `Session "${id}" not found`,
        "session_not_found"
      );
    }
    return session;
  }

  async updateBrief(id: string, brief: CampaignBriefDto): Promise<void> {
    const session = await this.getSession(id);

    if (session.status === "generating") {
      throw new SessionError(
        "Cannot update brief while generation is in progress",
        "session_conflict"
      );
    }

    const nextStatus = "ready";
    this.guardTransition(session.status, nextStatus);

    session.brief = brief;
    session.status = nextStatus;
    session.updatedAt = now();

    await this.store.saveSession(session);
    await this.upsertIndex(session);
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    await this.getSession(sessionId);
    return this.store.listRuns(sessionId);
  }

  async generate(
    sessionId: string,
    storage: StorageProvider,
    client: OpenAI,
    ctx: RequestContext
  ): Promise<GenerateResult> {
    const session = await this.getSession(sessionId);

    if (session.status === "generating") {
      throw new SessionError(
        "Generation already in progress for this session",
        "session_conflict"
      );
    }

    if (session.status === "draft") {
      throw new SessionError(
        "Cannot generate without a brief. Update the brief first.",
        "session_not_ready"
      );
    }

    this.guardTransition(session.status, "generating");

    const runId = crypto.randomUUID();
    const campaignId = `session-${sessionId}-${runId}`;
    const timestamp = now();

    const run: Run = {
      id: runId,
      sessionId,
      createdAt: timestamp,
      status: "running",
      campaignId,
    };

    session.status = "generating";
    session.activeRunId = runId;
    session.runIds.push(runId);
    session.updatedAt = timestamp;

    await this.store.saveRun(run);
    await this.store.saveSession(session);
    await this.upsertIndex(session);

    ctx.log(LogEvents.SessionGenerate, { sessionId, runId, campaignId });

    const pipelineBrief = briefDtoToPipelineBrief(session.brief);
    pipelineBrief.campaign.id = campaignId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PIPELINE_BUDGET_MS);

    let pipelineResult: PipelineResult;
    try {
      pipelineResult = await runPipeline(
        pipelineBrief,
        storage,
        client,
        ctx,
        { signal: controller.signal }
      );
    } catch (err) {
      clearTimeout(timer);
      run.status = "failed";
      run.completedAt = now();
      run.errors = [
        {
          stage: "pipeline",
          cause: "unknown",
          message:
            err instanceof Error ? err.message : "Pipeline threw unexpectedly",
        },
      ];

      session.status = "failed";
      session.activeRunId = undefined;
      session.updatedAt = now();
      session.summary = "Last generation failed";

      await this.store.saveRun(run);
      await this.store.saveSession(session);
      await this.upsertIndex(session);

      ctx.log(LogEvents.SessionGenerateFailed, { sessionId, runId });
      throw err;
    }

    clearTimeout(timer);

    const hasCreatives = pipelineResult.creatives.length > 0;
    run.status = hasCreatives ? "completed" : "failed";
    run.completedAt = now();
    run.totalImages = pipelineResult.totalImages;
    run.totalTimeMs = pipelineResult.totalTimeMs;
    run.outputs = pipelineResult.creatives.map(
      (c): RunOutput => ({
        creativePath: c.creativePath,
        creativeUrl: c.creativeUrl,
        thumbnailUrl: c.thumbnailUrl,
        productName: c.productName,
        aspectRatio: c.aspectRatio,
      })
    );
    run.errors = pipelineResult.errors.map((e) => ({
      stage: e.stage,
      cause: e.cause,
      message: e.message,
    }));

    session.status = hasCreatives ? "completed" : "failed";
    session.activeRunId = undefined;
    session.updatedAt = now();
    session.summary = buildSummary(session, run);

    await this.store.saveRun(run);
    await this.store.saveSession(session);
    await this.upsertIndex(session);

    const logEvent = hasCreatives
      ? LogEvents.SessionGenerateComplete
      : LogEvents.SessionGenerateFailed;
    ctx.log(logEvent, {
      sessionId,
      runId,
      creatives: pipelineResult.totalImages,
      totalMs: pipelineResult.totalTimeMs,
    });

    return { run, pipelineResult };
  }

  private guardTransition(from: SessionStatus, to: SessionStatus): void {
    const allowed = SESSION_TRANSITIONS[from];
    if (!allowed.has(to)) {
      throw new SessionError(
        `Invalid status transition: ${from} → ${to}`,
        "invalid_transition"
      );
    }
  }

  private async upsertIndex(session: Session): Promise<void> {
    const index = await this.store.getIndex();
    const entry: SessionIndexEntry = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      status: session.status,
      summary: session.summary,
    };

    const existing = index.sessions.findIndex((s) => s.id === session.id);
    if (existing >= 0) {
      index.sessions[existing] = entry;
    } else {
      index.sessions.unshift(entry);
    }

    index.sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    await this.store.saveIndex(index);
  }
}

export function createSessionService(store: SessionStore): SessionService {
  return new SessionService(store);
}
