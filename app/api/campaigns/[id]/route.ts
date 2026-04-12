/**
 * GET /api/campaigns/:id — Fetches results for a completed campaign.
 *
 * Returns the manifest (creative URLs, metadata, timing) for a
 * previously generated campaign.
 */

import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // TODO: Checkpoint 2 — load manifest from storage
  return NextResponse.json(
    { error: `Campaign ${id} not found — Checkpoint 2` },
    { status: 501 }
  );
}
