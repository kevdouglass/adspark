import type { StorageProvider } from "@/lib/pipeline/types";
import type { Session, Run, SessionIndex } from "./types";

const SESSIONS_DIR = "_sessions";
const INDEX_KEY = `${SESSIONS_DIR}/index.json`;

function sessionKey(id: string): string {
  return `${SESSIONS_DIR}/${id}/session.json`;
}

function runKey(sessionId: string, runId: string): string {
  return `${SESSIONS_DIR}/${sessionId}/runs/${runId}.json`;
}

export interface SessionStore {
  getIndex(): Promise<SessionIndex>;
  saveIndex(index: SessionIndex): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  getRun(sessionId: string, runId: string): Promise<Run | null>;
  saveRun(run: Run): Promise<void>;
  listRuns(sessionId: string): Promise<Run[]>;
}

export class StorageSessionStore implements SessionStore {
  constructor(private readonly storage: StorageProvider) {}

  async getIndex(): Promise<SessionIndex> {
    const buf = await this.storage.load(INDEX_KEY);
    if (!buf) return { sessions: [] };
    return JSON.parse(buf.toString("utf-8")) as SessionIndex;
  }

  async saveIndex(index: SessionIndex): Promise<void> {
    const data = Buffer.from(JSON.stringify(index, null, 2), "utf-8");
    await this.storage.save(INDEX_KEY, data, "application/json");
  }

  async getSession(id: string): Promise<Session | null> {
    const buf = await this.storage.load(sessionKey(id));
    if (!buf) return null;
    return JSON.parse(buf.toString("utf-8")) as Session;
  }

  async saveSession(session: Session): Promise<void> {
    const data = Buffer.from(JSON.stringify(session, null, 2), "utf-8");
    await this.storage.save(sessionKey(session.id), data, "application/json");
  }

  async getRun(sessionId: string, runId: string): Promise<Run | null> {
    const buf = await this.storage.load(runKey(sessionId, runId));
    if (!buf) return null;
    return JSON.parse(buf.toString("utf-8")) as Run;
  }

  async saveRun(run: Run): Promise<void> {
    const data = Buffer.from(JSON.stringify(run, null, 2), "utf-8");
    await this.storage.save(
      runKey(run.sessionId, run.id),
      data,
      "application/json"
    );
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    const session = await this.getSession(sessionId);
    if (!session) return [];
    const runs: Run[] = [];
    for (const runId of session.runIds) {
      const run = await this.getRun(sessionId, runId);
      if (run) runs.push(run);
    }
    return runs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export function createSessionStore(storage: StorageProvider): SessionStore {
  return new StorageSessionStore(storage);
}
