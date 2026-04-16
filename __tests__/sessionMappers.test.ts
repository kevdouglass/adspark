import { describe, it, expect } from "vitest";
import {
  toSessionDto,
  toSessionListItem,
  toRunDto,
  briefDtoToPipelineBrief,
  formatUpdatedAt,
} from "@/lib/sessions/sessionMappers";
import type { Session, Run, SessionIndexEntry } from "@/lib/sessions/types";
import type { CampaignBriefDto } from "@/lib/api/sessions/dtos";

const sampleBrief: CampaignBriefDto = {
  campaign: {
    id: "camp_1",
    name: "Summer Launch",
    message: "Feel the sun",
    targetRegion: "US-West",
    targetAudience: "Millennials",
    tone: "energetic",
    season: "summer",
  },
  products: [
    {
      name: "Sunscreen SPF 50",
      slug: "sunscreen-spf-50",
      description: "Premium protection",
      category: "sun protection",
      keyFeatures: ["SPF 50", "water resistant"],
      color: "#F4A261",
      existingAsset: null,
    },
  ],
  aspectRatios: ["1:1", "9:16"],
};

const sampleSession: Session = {
  id: "sess_1",
  title: "Summer 2026 Launch",
  createdAt: "2026-04-15T12:00:00.000Z",
  updatedAt: "2026-04-15T14:30:00.000Z",
  status: "completed",
  summary: "6 creatives generated in 45.2s",
  brief: sampleBrief,
  activeRunId: undefined,
  runIds: ["run_1"],
};

const sampleRun: Run = {
  id: "run_1",
  sessionId: "sess_1",
  createdAt: "2026-04-15T12:05:00.000Z",
  status: "completed",
  completedAt: "2026-04-15T12:05:45.000Z",
  campaignId: "session-sess_1-run_1",
  totalImages: 6,
  totalTimeMs: 45_200,
  outputs: [
    {
      creativePath: "session-sess_1-run_1/sunscreen-spf-50/1x1/creative.png",
      creativeUrl: "https://example.com/creative.png",
      thumbnailUrl: "https://example.com/thumb.webp",
      productName: "Sunscreen SPF 50",
      aspectRatio: "1:1",
    },
  ],
  errors: [],
};

describe("toSessionDto", () => {
  it("maps every Session field to CampaignSessionDto", () => {
    const dto = toSessionDto(sampleSession);

    expect(dto.id).toBe("sess_1");
    expect(dto.title).toBe("Summer 2026 Launch");
    expect(dto.createdAt).toBe("2026-04-15T12:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-04-15T14:30:00.000Z");
    expect(dto.status).toBe("completed");
    expect(dto.summary).toBe("6 creatives generated in 45.2s");
    expect(dto.brief).toBe(sampleBrief);
    expect(dto.activeRunId).toBeUndefined();
  });

  it("does not include runIds (internal field)", () => {
    const dto = toSessionDto(sampleSession);
    expect("runIds" in dto).toBe(false);
  });
});

describe("toSessionListItem", () => {
  const entry: SessionIndexEntry = {
    id: "sess_1",
    title: "Summer 2026 Launch",
    updatedAt: "2026-04-15T14:30:00.000Z",
    status: "completed",
    summary: "6 creatives",
  };

  it("maps index entry to list item with formatted updatedAtLabel", () => {
    const item = toSessionListItem(entry);

    expect(item.id).toBe("sess_1");
    expect(item.title).toBe("Summer 2026 Launch");
    expect(item.updatedAtLabel).toMatch(/Updated Apr 15, 2026/);
    expect(item.status).toBe("completed");
    expect(item.summary).toBe("6 creatives");
  });

  it("omits summary when undefined", () => {
    const item = toSessionListItem({ ...entry, summary: undefined });
    expect(item.summary).toBeUndefined();
  });
});

describe("toRunDto", () => {
  it("maps every Run field to GenerationRunDto", () => {
    const dto = toRunDto(sampleRun);

    expect(dto.id).toBe("run_1");
    expect(dto.sessionId).toBe("sess_1");
    expect(dto.createdAt).toBe("2026-04-15T12:05:00.000Z");
    expect(dto.status).toBe("completed");
    expect(dto.totalImages).toBe(6);
    expect(dto.totalTimeMs).toBe(45_200);
    expect(dto.outputs).toHaveLength(1);
    expect(dto.outputs![0].productName).toBe("Sunscreen SPF 50");
    expect(dto.outputs![0].aspectRatio).toBe("1:1");
  });

  it("does not include internal fields (completedAt, campaignId, errors)", () => {
    const dto = toRunDto(sampleRun);
    expect("completedAt" in dto).toBe(false);
    expect("campaignId" in dto).toBe(false);
    expect("errors" in dto).toBe(false);
  });

  it("handles run with no outputs", () => {
    const dto = toRunDto({ ...sampleRun, outputs: undefined });
    expect(dto.outputs).toBeUndefined();
  });
});

describe("briefDtoToPipelineBrief", () => {
  it("maps a fully-populated DTO to a CampaignBrief", () => {
    const brief = briefDtoToPipelineBrief(sampleBrief);

    expect(brief.campaign.id).toBe("camp_1");
    expect(brief.campaign.name).toBe("Summer Launch");
    expect(brief.campaign.message).toBe("Feel the sun");
    expect(brief.campaign.targetRegion).toBe("US-West");
    expect(brief.campaign.targetAudience).toBe("Millennials");
    expect(brief.campaign.tone).toBe("energetic");
    expect(brief.campaign.season).toBe("summer");

    expect(brief.products).toHaveLength(1);
    expect(brief.products[0].name).toBe("Sunscreen SPF 50");
    expect(brief.products[0].slug).toBe("sunscreen-spf-50");
    expect(brief.products[0].category).toBe("sun protection");
    expect(brief.products[0].keyFeatures).toEqual(["SPF 50", "water resistant"]);
    expect(brief.products[0].color).toBe("#F4A261");
    expect(brief.products[0].existingAsset).toBeNull();

    expect(brief.aspectRatios).toEqual(["1:1", "9:16"]);
    expect(brief.outputFormats).toEqual({ creative: "png", thumbnail: "webp" });
  });

  it("applies defaults for all optional DTO fields", () => {
    const minimalDto: CampaignBriefDto = {
      campaign: {
        id: "c1",
        name: "Test",
        message: "Hello",
        targetRegion: "US",
        targetAudience: "Everyone",
      },
      products: [
        { name: "Widget", slug: "widget", description: "A widget" },
      ],
      aspectRatios: ["1:1"],
    };

    const brief = briefDtoToPipelineBrief(minimalDto);

    expect(brief.campaign.tone).toBe("professional");
    expect(brief.campaign.season).toBe("summer");
    expect(brief.products[0].category).toBe("general");
    expect(brief.products[0].keyFeatures).toEqual([]);
    expect(brief.products[0].color).toBe("");
    expect(brief.products[0].existingAsset).toBeNull();
    expect(brief.outputFormats).toEqual({ creative: "png", thumbnail: "webp" });
  });

  it("defaults invalid season to summer", () => {
    const dto: CampaignBriefDto = {
      ...sampleBrief,
      campaign: { ...sampleBrief.campaign, season: "autumn" },
    };
    const brief = briefDtoToPipelineBrief(dto);
    expect(brief.campaign.season).toBe("summer");
  });

  it("accepts all four valid seasons", () => {
    for (const season of ["summer", "winter", "spring", "fall"]) {
      const dto: CampaignBriefDto = {
        ...sampleBrief,
        campaign: { ...sampleBrief.campaign, season },
      };
      const brief = briefDtoToPipelineBrief(dto);
      expect(brief.campaign.season).toBe(season);
    }
  });
});

describe("formatUpdatedAt", () => {
  it("formats ISO string to 'Updated Mon DD, YYYY'", () => {
    const result = formatUpdatedAt("2026-04-15T14:30:00.000Z");
    expect(result).toMatch(/Updated Apr 15, 2026/);
  });
});
