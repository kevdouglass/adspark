/**
 * POST /api/generate — Runs the creative generation pipeline.
 *
 * Accepts a campaign brief JSON, runs the full pipeline, and returns
 * the generated creative URLs and metadata.
 */

import { NextResponse } from "next/server";
import { parseBrief } from "@/lib/pipeline/briefParser";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  try {
    const result = parseBrief(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid campaign brief", details: result.errors },
        { status: 400 }
      );
    }

    // TODO [Checkpoint 1]: call runPipeline() with parsed brief, storage, and API key
    return NextResponse.json({
      message: "Pipeline not yet implemented — brief validated successfully",
      campaignId: result.brief.campaign.id,
      productsCount: result.brief.products.length,
      aspectRatios: result.brief.aspectRatios,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
