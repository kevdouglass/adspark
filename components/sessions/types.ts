import type { SessionStatus, RunStatus } from "@/lib/api/sessions/dtos";
export type { SessionStatus, RunStatus };

export type SessionListItemViewModel = {
  id: string;
  title: string;
  updatedAtLabel: string;
  status: SessionStatus;
  summary?: string;
};

export type SessionRunListItemViewModel = {
  id: string;
  createdAtLabel: string;
  status: RunStatus;
  totalImages?: number;
  totalTimeMs?: number;
};

export type SessionHeaderViewModel = {
  id: string;
  title: string;
  updatedAtLabel: string;
  status: SessionStatus;
  summary?: string;
};
