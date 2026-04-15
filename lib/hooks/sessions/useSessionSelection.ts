"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "adspark.selectedSessionId";

type UseSessionSelectionResult = {
  selectedSessionId: string | null;
  selectSession: (id: string) => void;
  clearSelection: () => void;
};

export function useSessionSelection(): UseSessionSelectionResult {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setSelectedSessionId(saved);
    }
  }, []);

  const selectSession = useCallback((id: string) => {
    setSelectedSessionId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedSessionId(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { selectedSessionId, selectSession, clearSelection };
}
