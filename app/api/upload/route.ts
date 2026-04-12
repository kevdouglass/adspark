/**
 * POST /api/upload — Generates a pre-signed URL for asset upload.
 *
 * The frontend requests an upload URL, then uploads directly to S3
 * (or writes to local filesystem in dev mode). The frontend never
 * holds AWS credentials.
 */

import { NextResponse } from "next/server";

export async function POST(_request: Request) {
  // TODO: Checkpoint 2 — pre-signed S3 URL generation
  return NextResponse.json(
    { error: "Not implemented — Checkpoint 2" },
    { status: 501 }
  );
}
