export type SessionStatus = "draft" | "ready" | "generating" | "completed" | "failed";

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
  status: "queued" | "running" | "completed" | "failed";
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
