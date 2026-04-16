import {
  CampaignBriefDto,
  CampaignSessionDto,
  CreateSessionRequest,
  CreateSessionResponse,
  GenerationRunDto,
  GetSessionResponse,
  ListSessionRunsResponse,
  ListSessionsResponse,
  UpdateSessionBriefRequest,
} from "./dtos";

async function ensureOk(response: Response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
}

export const sessionsClient = {
  async list(): Promise<ListSessionsResponse["sessions"]> {
    const response = await fetch("/api/sessions", { method: "GET" });
    await ensureOk(response);
    const body = (await response.json()) as ListSessionsResponse;
    return body.sessions;
  },

  async create(input: CreateSessionRequest): Promise<CampaignSessionDto> {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    await ensureOk(response);
    const body = (await response.json()) as CreateSessionResponse;
    return body.session;
  },

  async get(sessionId: string): Promise<CampaignSessionDto> {
    const response = await fetch(`/api/sessions/${sessionId}`, { method: "GET" });
    await ensureOk(response);
    const body = (await response.json()) as GetSessionResponse;
    return body.session;
  },

  async updateBrief(sessionId: string, brief: CampaignBriefDto): Promise<void> {
    const response = await fetch(`/api/sessions/${sessionId}/brief`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief } satisfies UpdateSessionBriefRequest),
    });
    await ensureOk(response);
  },

  async listRuns(sessionId: string): Promise<GenerationRunDto[]> {
    const response = await fetch(`/api/sessions/${sessionId}/runs`, { method: "GET" });
    await ensureOk(response);
    const body = (await response.json()) as ListSessionRunsResponse;
    return body.runs;
  },

  async generate(sessionId: string): Promise<Response> {
    const response = await fetch(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
    });
    await ensureOk(response);
    return response;
  },
};
