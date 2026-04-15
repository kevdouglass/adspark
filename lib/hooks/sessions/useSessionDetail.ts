"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionsClient } from "@/lib/api/sessions/client";
import { CampaignBriefDto, CampaignSessionDto } from "@/lib/api/sessions/dtos";

type UseSessionDetailResult = {
  session: CampaignSessionDto | null;
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  updateBrief: (brief: CampaignBriefDto) => Promise<void>;
};

export function useSessionDetail(sessionId: string | null): UseSessionDetailResult {
  const [session, setSession] = useState<CampaignSessionDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    try {
      const result = await sessionsClient.get(sessionId);
      setSession(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const updateBrief = useCallback(async (brief: CampaignBriefDto) => {
    if (!sessionId) return;
    await sessionsClient.updateBrief(sessionId, brief);
    await refresh();
  }, [refresh, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, isLoading, error, refresh, updateBrief };
}
