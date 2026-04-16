"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "adspark.selectedSessionId";

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

type UseSessionSelectionResult = {
  selectedSessionId: string | null;
  selectSession: (id: string) => void;
  clearSelection: () => void;
};

export function useSessionSelection(): UseSessionSelectionResult {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    readStoredSessionId
  );

  const selectSession = useCallback((id: string) => {
    setSelectedSessionId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedSessionId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return { selectedSessionId, selectSession, clearSelection };
}
