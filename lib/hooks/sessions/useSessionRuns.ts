"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionsClient } from "@/lib/api/sessions/client";
import { GenerationRunDto } from "@/lib/api/sessions/dtos";

type UseSessionRunsResult = {
  runs: GenerationRunDto[];
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

export function useSessionRuns(sessionId: string | null): UseSessionRunsResult {
  const [runs, setRuns] = useState<GenerationRunDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setRuns([]);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    try {
      const result = await sessionsClient.listRuns(sessionId);
      setRuns(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session runs");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { runs, isLoading, error, refresh };
}
