import type { CampaignBriefDto, DtoAspectRatio, SessionStatus, RunStatus } from "@/lib/api/sessions/dtos";

export type { SessionStatus, RunStatus };

export const SESSION_TRANSITIONS: Record<SessionStatus, ReadonlySet<SessionStatus>> = {
  draft: new Set(["ready"]),
  ready: new Set(["ready", "generating"]),
  generating: new Set(["completed", "failed"]),
  completed: new Set(["ready"]),
  failed: new Set(["ready"]),
};

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  summary?: string;
  brief: CampaignBriefDto;
  activeRunId?: string;
  runIds: string[];
}

export interface Run {
  id: string;
  sessionId: string;
  createdAt: string;
  status: RunStatus;
  completedAt?: string;
  campaignId?: string;
  totalImages?: number;
  totalTimeMs?: number;
  outputs?: RunOutput[];
  errors?: RunError[];
}

export interface RunOutput {
  creativePath: string;
  creativeUrl?: string;
  thumbnailUrl?: string;
  productName: string;
  aspectRatio: DtoAspectRatio;
}

export interface RunError {
  stage: string;
  cause: string;
  message: string;
}

export interface SessionIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  status: SessionStatus;
  summary?: string;
}

export interface SessionIndex {
  sessions: SessionIndexEntry[];
}

export const EMPTY_BRIEF: CampaignBriefDto = {
  campaign: {
    id: "",
    name: "",
    message: "",
    targetRegion: "",
    targetAudience: "",
  },
  products: [],
  aspectRatios: ["1:1", "9:16", "16:9"],
};
