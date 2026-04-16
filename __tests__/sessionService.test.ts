import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionService } from "@/lib/sessions/sessionService";
import { SessionError } from "@/lib/sessions/sessionErrors";
import type { SessionStore } from "@/lib/sessions/sessionStore";
import type { Session, Run, SessionIndex } from "@/lib/sessions/types";
import { EMPTY_BRIEF } from "@/lib/sessions/types";
import type { CampaignBriefDto } from "@/lib/api/sessions/dtos";

const sampleBrief: CampaignBriefDto = {
  campaign: {
    id: "camp_1",
    name: "Summer Launch",
    message: "Feel the sun",
    targetRegion: "US-West",
    targetAudience: "Millennials",
    tone: "energetic",
    season: "summer",
  },
  products: [
    {
      name: "Sunscreen",
      slug: "sunscreen",
      description: "Premium SPF 50",
      category: "sun protection",
      keyFeatures: ["SPF 50"],
      color: "#F4A261",
    },
  ],
  aspectRatios: ["1:1"],
};

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

function mockStore(): SessionStore {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  let index: SessionIndex = { sessions: [] };

  return {
    getIndex: vi.fn(async () => index),
    saveIndex: vi.fn(async (idx: SessionIndex) => {
      index = idx;
    }),
    getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    saveSession: vi.fn(async (session: Session) => {
      sessions.set(session.id, { ...session });
    }),
    getRun: vi.fn(async (_sid: string, rid: string) => runs.get(rid) ?? null),
    saveRun: vi.fn(async (run: Run) => {
      runs.set(run.id, { ...run });
    }),
    listRuns: vi.fn(async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (!session) return [];
      return session.runIds
        .map((id) => runs.get(id))
        .filter((r): r is Run => r !== undefined)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }),
  };
}

describe("SessionService", () => {
  let store: SessionStore;
  let service: SessionService;

  beforeEach(() => {
    store = mockStore();
    service = new SessionService(store);
  });

  describe("createSession", () => {
    it("creates a draft session when no brief is provided", async () => {
      const session = await service.createSession({});

      expect(session.id).toBeDefined();
      expect(session.status).toBe("draft");
      expect(session.title).toBeDefined();
      expect(session.brief).toEqual(EMPTY_BRIEF);
      expect(session.runIds).toEqual([]);
      expect(store.saveSession).toHaveBeenCalledTimes(1);
      expect(store.saveIndex).toHaveBeenCalledTimes(1);
    });

    it("creates a ready session when a valid brief is provided", async () => {
      const session = await service.createSession({ brief: sampleBrief });

      expect(session.status).toBe("ready");
      expect(session.brief).toEqual(sampleBrief);
    });

    it("uses the provided title when given", async () => {
      const session = await service.createSession({
        title: "My Campaign",
        brief: sampleBrief,
      });

      expect(session.title).toBe("My Campaign");
    });

    it("auto-generates a title when not provided", async () => {
      const session = await service.createSession({});

      expect(session.title).toMatch(/Campaign/);
    });
  });

  describe("getSession", () => {
    it("returns the session when it exists", async () => {
      const created = await service.createSession({ brief: sampleBrief });
      const fetched = await service.getSession(created.id);

      expect(fetched.id).toBe(created.id);
    });

    it("throws session_not_found when session does not exist", async () => {
      await expect(service.getSession("nonexistent")).rejects.toThrow(
        SessionError
      );
      await expect(service.getSession("nonexistent")).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("updateBrief", () => {
    it("transitions draft → ready when brief is updated", async () => {
      const session = await service.createSession({});
      expect(session.status).toBe("draft");

      await service.updateBrief(session.id, sampleBrief);

      const updated = await service.getSession(session.id);
      expect(updated.status).toBe("ready");
      expect(updated.brief).toEqual(sampleBrief);
    });

    it("keeps ready status on subsequent brief updates", async () => {
      const session = await service.createSession({ brief: sampleBrief });
      expect(session.status).toBe("ready");

      const newBrief = {
        ...sampleBrief,
        campaign: { ...sampleBrief.campaign, message: "Updated message" },
      };
      await service.updateBrief(session.id, newBrief);

      const updated = await service.getSession(session.id);
      expect(updated.status).toBe("ready");
      expect(updated.brief.campaign.message).toBe("Updated message");
    });

    it("rejects brief update while generating (409 conflict)", async () => {
      const created = await service.createSession({ brief: sampleBrief });
      // Manually set status to generating via store
      const session = await store.getSession(created.id);
      session!.status = "generating";
      await store.saveSession(session!);

      await expect(
        service.updateBrief(created.id, sampleBrief)
      ).rejects.toThrow("Cannot update brief while generation is in progress");
    });

    it("transitions completed → ready on brief update (re-iterate)", async () => {
      const created = await service.createSession({ brief: sampleBrief });
      const session = await store.getSession(created.id);
      session!.status = "completed";
      await store.saveSession(session!);

      await service.updateBrief(created.id, sampleBrief);

      const updated = await service.getSession(created.id);
      expect(updated.status).toBe("ready");
    });

    it("transitions failed → ready on brief update (re-iterate)", async () => {
      const created = await service.createSession({ brief: sampleBrief });
      const session = await store.getSession(created.id);
      session!.status = "failed";
      await store.saveSession(session!);

      await service.updateBrief(created.id, sampleBrief);

      const updated = await service.getSession(created.id);
      expect(updated.status).toBe("ready");
    });

    it("throws session_not_found for nonexistent session", async () => {
      await expect(
        service.updateBrief("nonexistent", sampleBrief)
      ).rejects.toThrow(SessionError);
    });
  });

  describe("listSessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const sessions = await service.listSessions();
      expect(sessions).toEqual([]);
    });

    it("returns sessions after creation", async () => {
      await service.createSession({ title: "Session A" });
      await service.createSession({ title: "Session B" });

      const sessions = await service.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe("listRuns", () => {
    it("returns empty array for session with no runs", async () => {
      const session = await service.createSession({ brief: sampleBrief });
      const runs = await service.listRuns(session.id);
      expect(runs).toEqual([]);
    });

    it("throws session_not_found for nonexistent session", async () => {
      await expect(service.listRuns("nonexistent")).rejects.toThrow(
        SessionError
      );
    });
  });

  describe("generate — guard checks", () => {
    it("rejects generate on draft session (no brief)", async () => {
      const session = await service.createSession({});

      await expect(
        service.generate(session.id, {} as any, {} as any, {} as any)
      ).rejects.toThrow("Cannot generate without a brief");
    });

    it("rejects generate while already generating (409)", async () => {
      const created = await service.createSession({ brief: sampleBrief });
      const session = await store.getSession(created.id);
      session!.status = "generating";
      await store.saveSession(session!);

      await expect(
        service.generate(created.id, {} as any, {} as any, {} as any)
      ).rejects.toThrow("Generation already in progress");
    });
  });

  describe("status machine transitions", () => {
    it("draft → ready via updateBrief", async () => {
      const s = await service.createSession({});
      await service.updateBrief(s.id, sampleBrief);
      const updated = await service.getSession(s.id);
      expect(updated.status).toBe("ready");
    });

    it("completed → ready via updateBrief", async () => {
      const s = await service.createSession({ brief: sampleBrief });
      const stored = await store.getSession(s.id);
      stored!.status = "completed";
      await store.saveSession(stored!);

      await service.updateBrief(s.id, sampleBrief);
      const updated = await service.getSession(s.id);
      expect(updated.status).toBe("ready");
    });

    it("failed → ready via updateBrief", async () => {
      const s = await service.createSession({ brief: sampleBrief });
      const stored = await store.getSession(s.id);
      stored!.status = "failed";
      await store.saveSession(stored!);

      await service.updateBrief(s.id, sampleBrief);
      const updated = await service.getSession(s.id);
      expect(updated.status).toBe("ready");
    });
  });
});
