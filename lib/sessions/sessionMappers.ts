import type {
  CampaignSessionDto,
  GenerationRunDto,
  ListSessionsResponse,
  CampaignBriefDto,
} from "@/lib/api/sessions/dtos";
import type { CampaignBrief, Season } from "@/lib/pipeline/types";
import type { Session, Run, SessionIndexEntry } from "./types";

export function toSessionDto(session: Session): CampaignSessionDto {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    summary: session.summary,
    brief: session.brief,
    activeRunId: session.activeRunId,
  };
}

export function toSessionListItem(
  entry: SessionIndexEntry
): ListSessionsResponse["sessions"][number] {
  return {
    id: entry.id,
    title: entry.title,
    updatedAtLabel: formatUpdatedAt(entry.updatedAt),
    status: entry.status,
    summary: entry.summary,
  };
}

export function toRunDto(run: Run): GenerationRunDto {
  return {
    id: run.id,
    sessionId: run.sessionId,
    createdAt: run.createdAt,
    status: run.status,
    totalImages: run.totalImages,
    totalTimeMs: run.totalTimeMs,
    outputs: run.outputs?.map((o) => ({
      creativePath: o.creativePath,
      creativeUrl: o.creativeUrl,
      thumbnailUrl: o.thumbnailUrl,
      productName: o.productName,
      aspectRatio: o.aspectRatio,
    })),
  };
}

const VALID_SEASONS = new Set(["summer", "winter", "spring", "fall"]);

export function briefDtoToPipelineBrief(dto: CampaignBriefDto): CampaignBrief {
  const season = VALID_SEASONS.has(dto.campaign.season ?? "")
    ? (dto.campaign.season as Season)
    : ("summer" as Season);

  return {
    campaign: {
      id: dto.campaign.id,
      name: dto.campaign.name,
      message: dto.campaign.message,
      targetRegion: dto.campaign.targetRegion,
      targetAudience: dto.campaign.targetAudience,
      tone: dto.campaign.tone ?? "professional",
      season,
    },
    products: dto.products.map((p) => ({
      name: p.name,
      slug: p.slug,
      description: p.description,
      category: p.category ?? "general",
      keyFeatures: p.keyFeatures ?? [],
      color: p.color ?? "",
      existingAsset: p.existingAsset ?? null,
    })),
    aspectRatios: [...dto.aspectRatios],
    outputFormats: { creative: "png", thumbnail: "webp" },
  };
}

export function formatUpdatedAt(isoString: string): string {
  const date = new Date(isoString);
  return `Updated ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
