"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionsClient } from "@/lib/api/sessions/client";
import type { CampaignBriefDto, ListSessionsResponse } from "@/lib/api/sessions/dtos";

type SessionListItem = ListSessionsResponse["sessions"][number];

type CreateSessionInput = {
  title?: string;
  brief?: CampaignBriefDto;
};

type UseSessionsResult = {
  sessions: SessionListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  createSession: (input?: CreateSessionInput) => Promise<string>;
};

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
    setIsLoading(true);
    try {
      const data = await sessionsClient.list();
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSession = useCallback(async (input?: CreateSessionInput) => {
    setError(undefined);
    try {
      const session = await sessionsClient.create(input ?? {});
      await refresh();
      return session.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      throw err;
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, isLoading, error, refresh, createSession };
}
