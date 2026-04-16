import { describe, it, expect, beforeEach, vi } from "vitest";
import { StorageSessionStore } from "@/lib/sessions/sessionStore";
import type { StorageProvider } from "@/lib/pipeline/types";
import type { Session, Run } from "@/lib/sessions/types";
import { EMPTY_BRIEF } from "@/lib/sessions/types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_1",
    title: "Test Session",
    createdAt: "2026-04-15T12:00:00.000Z",
    updatedAt: "2026-04-15T12:00:00.000Z",
    status: "draft",
    brief: EMPTY_BRIEF,
    runIds: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_1",
    sessionId: "sess_1",
    createdAt: "2026-04-15T12:05:00.000Z",
    status: "completed",
    totalImages: 6,
    totalTimeMs: 45_000,
    ...overrides,
  };
}

function mockStorage(): StorageProvider {
  const data = new Map<string, Buffer>();
  return {
    save: vi.fn(async (key: string, buf: Buffer) => {
      data.set(key, buf);
      return key;
    }),
    load: vi.fn(async (key: string) => data.get(key) ?? null),
    exists: vi.fn(async (key: string) => data.has(key)),
    getUrl: vi.fn(async (key: string) => `/files/${key}`),
  };
}

describe("StorageSessionStore", () => {
  let storage: StorageProvider;
  let store: StorageSessionStore;

  beforeEach(() => {
    storage = mockStorage();
    store = new StorageSessionStore(storage);
  });

  describe("getIndex / saveIndex", () => {
    it("returns empty index when no index file exists", async () => {
      const index = await store.getIndex();
      expect(index.sessions).toEqual([]);
    });

    it("roundtrips index through save and load", async () => {
      const index = {
        sessions: [
          {
            id: "sess_1",
            title: "Test",
            updatedAt: "2026-04-15T12:00:00.000Z",
            status: "draft" as const,
          },
        ],
      };

      await store.saveIndex(index);
      const loaded = await store.getIndex();

      expect(loaded.sessions).toHaveLength(1);
      expect(loaded.sessions[0].id).toBe("sess_1");
      expect(loaded.sessions[0].title).toBe("Test");
    });
  });

  describe("getSession / saveSession", () => {
    it("returns null for a non-existent session", async () => {
      const result = await store.getSession("nonexistent");
      expect(result).toBeNull();
    });

    it("roundtrips a session through save and load", async () => {
      const session = makeSession();
      await store.saveSession(session);

      const loaded = await store.getSession("sess_1");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("sess_1");
      expect(loaded!.title).toBe("Test Session");
      expect(loaded!.status).toBe("draft");
      expect(loaded!.brief).toEqual(EMPTY_BRIEF);
      expect(loaded!.runIds).toEqual([]);
    });

    it("overwrites an existing session on re-save", async () => {
      await store.saveSession(makeSession({ title: "V1" }));
      await store.saveSession(makeSession({ title: "V2" }));

      const loaded = await store.getSession("sess_1");
      expect(loaded!.title).toBe("V2");
    });
  });

  describe("getRun / saveRun", () => {
    it("returns null for a non-existent run", async () => {
      const result = await store.getRun("sess_1", "nonexistent");
      expect(result).toBeNull();
    });

    it("roundtrips a run through save and load", async () => {
      const run = makeRun();
      await store.saveRun(run);

      const loaded = await store.getRun("sess_1", "run_1");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("run_1");
      expect(loaded!.sessionId).toBe("sess_1");
      expect(loaded!.status).toBe("completed");
      expect(loaded!.totalImages).toBe(6);
    });
  });

  describe("listRuns", () => {
    it("returns empty array when session has no runs", async () => {
      await store.saveSession(makeSession({ runIds: [] }));
      const runs = await store.listRuns("sess_1");
      expect(runs).toEqual([]);
    });

    it("returns empty array when session does not exist", async () => {
      const runs = await store.listRuns("nonexistent");
      expect(runs).toEqual([]);
    });

    it("returns runs sorted by createdAt descending (newest first)", async () => {
      const session = makeSession({ runIds: ["run_old", "run_new"] });
      await store.saveSession(session);
      await store.saveRun(
        makeRun({
          id: "run_old",
          createdAt: "2026-04-15T10:00:00.000Z",
        })
      );
      await store.saveRun(
        makeRun({
          id: "run_new",
          createdAt: "2026-04-15T14:00:00.000Z",
        })
      );

      const runs = await store.listRuns("sess_1");

      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe("run_new");
      expect(runs[1].id).toBe("run_old");
    });

    it("skips runs that are missing from storage (orphaned runId)", async () => {
      const session = makeSession({ runIds: ["run_1", "run_gone"] });
      await store.saveSession(session);
      await store.saveRun(makeRun({ id: "run_1" }));

      const runs = await store.listRuns("sess_1");
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("run_1");
    });
  });

  describe("storage key structure", () => {
    it("saves sessions under _sessions/{id}/session.json", async () => {
      await store.saveSession(makeSession());

      expect(storage.save).toHaveBeenCalledWith(
        "_sessions/sess_1/session.json",
        expect.any(Buffer),
        "application/json"
      );
    });

    it("saves runs under _sessions/{sessionId}/runs/{runId}.json", async () => {
      await store.saveRun(makeRun());

      expect(storage.save).toHaveBeenCalledWith(
        "_sessions/sess_1/runs/run_1.json",
        expect.any(Buffer),
        "application/json"
      );
    });

    it("saves index under _sessions/index.json", async () => {
      await store.saveIndex({ sessions: [] });

      expect(storage.save).toHaveBeenCalledWith(
        "_sessions/index.json",
        expect.any(Buffer),
        "application/json"
      );
    });
  });
});
