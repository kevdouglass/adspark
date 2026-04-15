export type CampaignBriefDto = {
  campaign: {
    id: string;
    name: string;
    message: string;
    targetRegion: string;
    targetAudience: string;
    tone?: string;
    season?: string;
  };
  products: Array<{
    name: string;
    slug: string;
    description: string;
    category?: string;
    keyFeatures?: string[];
    color?: string;
    existingAsset?: string | null;
  }>;
  aspectRatios: string[];
};

export type SessionStatus = "draft" | "ready" | "generating" | "completed" | "failed";

export type CampaignSessionDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  summary?: string;
  brief: CampaignBriefDto;
  activeRunId?: string;
};

export type GenerationRunDto = {
  id: string;
  sessionId: string;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  totalImages?: number;
  totalTimeMs?: number;
  outputs?: Array<{
    creativePath: string;
    creativeUrl?: string;
    thumbnailUrl?: string;
    productName: string;
    aspectRatio: string;
  }>;
};

export type ListSessionsResponse = {
  sessions: Array<{
    id: string;
    title: string;
    updatedAtLabel: string;
    status: SessionStatus;
    summary?: string;
  }>;
};

export type CreateSessionRequest = {
  title?: string;
  brief?: CampaignBriefDto;
};

export type CreateSessionResponse = {
  session: CampaignSessionDto;
};

export type GetSessionResponse = {
  session: CampaignSessionDto;
};

export type UpdateSessionBriefRequest = {
  brief: CampaignBriefDto;
};

export type ListSessionRunsResponse = {
  runs: GenerationRunDto[];
};
