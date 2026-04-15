"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionsClient } from "@/lib/api/sessions/client";
import { CampaignBriefDto } from "@/lib/api/sessions/dtos";
import { SessionListItemViewModel } from "@/components/sessions/types";

type CreateSessionInput = {
  title?: string;
  brief?: CampaignBriefDto;
};

type UseSessionsResult = {
  sessions: SessionListItemViewModel[];
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  createSession: (input?: CreateSessionInput) => Promise<string>;
};

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItemViewModel[]>([]);
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
    const session = await sessionsClient.create(input ?? {});
    await refresh();
    return session.id;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, isLoading, error, refresh, createSession };
}
