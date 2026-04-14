/**
 * POST /api/upload  (init) + PUT /api/upload?key=...  (local bytes)
 *
 * Two-step asset upload flow with storage-mode parity. Implements
 * SPIKE-003 / INVESTIGATION-003.
 *
 * ------------------------------------------------------------------------
 *   STEP 1 — POST /api/upload
 * ------------------------------------------------------------------------
 * Client sends JSON `{filename, contentType, campaignId?}`. Server:
 *   1. Validates the body shape + MIME allowlist
 *   2. Builds a safe storage key `assets/<campaignId>/<timestamp>-<name>.<ext>`
 *   3. Returns `{ uploadUrl, key, method, headers, assetUrl }`
 *
 * In `STORAGE_MODE=s3` (deferred — D1.b; see SPIKE-003 §D1):
 *   - `uploadUrl` is a pre-signed S3 PUT URL minted via
 *     `getSignedUrl(PutObjectCommand, ...)` with a 5-minute expiry
 *   - The browser uploads DIRECTLY to S3 — the Next.js function never
 *     sees the bytes. This bypasses Vercel's 4.5 MB function body cap
 *     and Vercel's per-request bandwidth cost.
 *   - `assetUrl` is null; the pipeline mints a GET URL via
 *     `S3Storage.getUrl(key)` at creative-serving time.
 *
 * In `STORAGE_MODE=local` (interview target — D1.a):
 *   - `uploadUrl` points back at this same route: `<origin>/api/upload?key=...`
 *   - Step 2 handles the actual bytes, see below.
 *   - `assetUrl` is `<origin>/api/files/<key>` — the existing files route
 *     serves the uploaded bytes for browser preview after the PUT lands.
 *
 * ------------------------------------------------------------------------
 *   STEP 2 — PUT /api/upload?key=...   (LOCAL MODE ONLY)
 * ------------------------------------------------------------------------
 * Client PUTs the raw image bytes with `Content-Type: image/<type>`.
 * Server:
 *   1. Reads the body with a stream-level byte cap (10 MB)
 *   2. Validates Content-Type against the MIME allowlist
 *   3. Checks magic bytes against the declared Content-Type (Adjustment 7)
 *   4. Writes via `LocalStorage.save(key, buffer, contentType)` — NOT
 *      direct `fs.writeFile`, so the path-traversal guard from Block B's
 *      seed-dir work applies automatically (Adjustment 1)
 *   5. Returns 204 No Content (body is empty — the client already has
 *      the `key` from step 1)
 *
 * In S3 mode, PUT returns 404 — bytes flow to S3 directly, never hit
 * this handler.
 *
 * ------------------------------------------------------------------------
 *   CRITICAL correctness point (flagged in the external review)
 * ------------------------------------------------------------------------
 * The client MUST save the returned `key` into `product.existingAsset`,
 * NOT the `uploadUrl`. Signed URLs expire; the asset-resolver in
 * `lib/pipeline/assetResolver.ts` expects a storage key it can pass to
 * `storage.exists()` + `storage.load()`. If the client stores the URL,
 * upload will appear to succeed but the reuse branch will silently
 * fall through and the pipeline will call DALL-E anyway.
 *
 * See INVESTIGATION-003 §Risk register for the matching integration
 * test that guards this regression.
 *
 * ------------------------------------------------------------------------
 *   SCOPE: Local-only implementation (D1.a)
 * ------------------------------------------------------------------------
 * The S3 branch of the POST handler returns 501 NOT_IMPLEMENTED for
 * now. Implementing S3 parity requires: bucket CORS update to permit
 * browser PUT, `S3Client` + `getSignedUrl(PutObjectCommand, ...)` in
 * this file, and 2 additional test cases. Deferred to a post-interview
 * follow-up — see SPIKE-003 §Migration path from D1.a to D1.b.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import {
  createRequestContext,
  getStorage,
  getStorageMode,
  LogEvents,
  MissingConfigurationError,
  validateUploadEnv,
} from "@/lib/api/services";
import {
  buildApiError,
  MAX_UPLOAD_BODY_BYTES,
  readBinaryBodyWithLimit,
  type ApiError,
} from "@/lib/api/errors";
import {
  isImageMagicBytesMatching,
  type AllowedImageMime,
} from "@/lib/pipeline/imageValidation";
import type {
  UploadInitRequestBody,
  UploadInitResponseBody,
} from "@/lib/api/types";

/**
 * Force the Node runtime. App Router defaults to the Edge runtime where
 * `Buffer` and `LocalStorage` (via `node:fs`) are unavailable. Without
 * this hint, `npm run build` fails on the PUT handler with a cryptic
 * "Buffer is not defined" error.
 */
export const runtime = "nodejs";

/**
 * Allowlist of MIME types for the upload flow. Keep in sync with
 * `AllowedImageMime` in `lib/pipeline/imageValidation.ts`.
 *
 * NOTE: `image/jpg` is NOT included — only `image/jpeg`, which is the
 * standard IANA name. Browsers send `image/jpeg` for .jpg files, so
 * including `image/jpg` is redundant and confuses the magic-byte switch.
 */
const ALLOWED_IMAGE_CONTENT_TYPES: ReadonlySet<AllowedImageMime> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Max JSON body size for the init call. The init body is small:
 * `{filename, contentType, campaignId}` — realistic size is ~200 bytes.
 * 1 KB is 5× that budget; larger bodies are certainly junk.
 */
const MAX_INIT_BODY_BYTES = 1024;

// ---------------------------------------------------------------------------
// Filename / key sanitization
// ---------------------------------------------------------------------------

/**
 * Lowercase, alphanumeric+separators, trim, collapse repeats. Used to
 * normalize filename base and campaign id components for inclusion in
 * storage keys. Returns `fallback` if the sanitized string is empty.
 *
 * The `.` is allowed in the character class so extensions survive
 * (but `..` can't traverse directories — the key is consumed by
 * `LocalStorage.safePath` which enforces that at write time).
 */
function sanitizeSegment(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  const sanitized = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}

/**
 * Normalize a filename's extension against its Content-Type. Prefers
 * the extension if it's one of the allowed image types; otherwise falls
 * back to the mapped extension from the Content-Type. Returns a leading
 * dot so the caller can concatenate directly.
 */
function normalizeExtension(
  filename: string,
  contentType: AllowedImageMime
): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png" || ext === ".webp") return ext;
  if (ext === ".jpeg" || ext === ".jpg") return ".jpeg";
  switch (contentType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpeg";
    case "image/webp":
      return ".webp";
  }
}

/**
 * Build the canonical storage key for an uploaded asset.
 *
 * Shape: `assets/<sanitizedCampaignId>/<timestamp>-<sanitizedBase>.<ext>`
 *
 * The `assets/` prefix separates uploads from generated creatives
 * (which live under `<campaignId>/<productSlug>/<ratio>/`), so a
 * reviewer listing `./output/` sees a clean split between "what came
 * from the pipeline" and "what the user uploaded."
 *
 * The `<timestamp>` prefix prevents collisions when the same filename
 * is uploaded twice (e.g. two products both named `hero.png`). A ms-
 * precision timestamp collides only if two uploads land in the same
 * millisecond, which is fine for a demo.
 */
function buildAssetKey(
  filename: string,
  campaignId: string | undefined,
  contentType: AllowedImageMime
): string {
  const safeCampaignId = sanitizeSegment(campaignId ?? "adhoc", "adhoc");
  const extension = normalizeExtension(filename, contentType);
  const baseName = sanitizeSegment(
    path.basename(filename, path.extname(filename)),
    "asset"
  );
  return `assets/${safeCampaignId}/${Date.now()}-${baseName}${extension}`;
}

// ---------------------------------------------------------------------------
// Init body validation
// ---------------------------------------------------------------------------

type InitBodyResult =
  | { ok: true; value: Required<Pick<UploadInitRequestBody, "filename" | "contentType">> & { campaignId?: string } }
  | { ok: false; message: string };

function validateInitBody(body: unknown): InitBodyResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const candidate = body as Record<string, unknown>;

  const filename =
    typeof candidate.filename === "string" ? candidate.filename.trim() : "";
  if (!filename) {
    return { ok: false, message: "filename is required." };
  }
  if (filename.length > 255) {
    return { ok: false, message: "filename must be ≤255 characters." };
  }

  const rawContentType =
    typeof candidate.contentType === "string"
      ? candidate.contentType.trim().toLowerCase()
      : "";
  if (!rawContentType) {
    return { ok: false, message: "contentType is required." };
  }
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(rawContentType as AllowedImageMime)) {
    return {
      ok: false,
      message: `contentType must be one of: ${[...ALLOWED_IMAGE_CONTENT_TYPES].join(", ")}`,
    };
  }
  const contentType = rawContentType as AllowedImageMime;

  const campaignId =
    typeof candidate.campaignId === "string"
      ? candidate.campaignId.trim() || undefined
      : undefined;

  return { ok: true, value: { filename, contentType, campaignId } };
}

// ---------------------------------------------------------------------------
// POST /api/upload  — init
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.UploadInitReceived, {
    route: "/api/upload",
    method: "POST",
  });

  // Env validation — fail fast before touching the body. Upload doesn't
  // need OPENAI_API_KEY; `validateUploadEnv` scopes to `S3_BUCKET` only
  // when `STORAGE_MODE=s3` (covered by its JSDoc).
  try {
    validateUploadEnv();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      console.error(
        `[${ctx.requestId}] MissingConfigurationError in upload init:`,
        error.message
      );
      ctx.log(LogEvents.UploadInitFailed, { reason: "missing_config" });
      return NextResponse.json(
        buildApiError(
          "MISSING_CONFIGURATION",
          "Server configuration error. Contact support with the requestId.",
          ctx.requestId
        ) satisfies ApiError,
        { status: 500 }
      );
    }
    throw error;
  }

  // Read the JSON init body with a tiny byte cap — the body is
  // structurally small, and a larger body indicates junk or abuse.
  const bodyBytes = await readBinaryBodyWithLimit(request, MAX_INIT_BODY_BYTES);
  if (!bodyBytes.ok) {
    const code = bodyBytes.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_JSON";
    const status = bodyBytes.reason === "too_large" ? 413 : 400;
    const msg =
      bodyBytes.reason === "too_large"
        ? `Init body exceeds ${MAX_INIT_BODY_BYTES} bytes.`
        : bodyBytes.reason === "empty"
          ? "Request body is empty."
          : "Failed to read request body.";
    ctx.log(LogEvents.UploadInitFailed, { reason: bodyBytes.reason });
    return NextResponse.json(
      buildApiError(code, msg, ctx.requestId) satisfies ApiError,
      { status }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyBytes.data.toString("utf-8"));
  } catch {
    ctx.log(LogEvents.UploadInitFailed, { reason: "invalid_json" });
    return NextResponse.json(
      buildApiError(
        "INVALID_JSON",
        "Request body must be valid JSON.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  const parsed = validateInitBody(body);
  if (!parsed.ok) {
    ctx.log(LogEvents.UploadInitFailed, { reason: "invalid_body" });
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        parsed.message,
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  const { filename, contentType, campaignId } = parsed.value;
  const key = buildAssetKey(filename, campaignId, contentType);
  const mode = getStorageMode();

  if (mode === "s3") {
    // D1.a scope — S3 parity is deferred. The S3 branch of this POST
    // handler will mint a pre-signed S3 PUT URL via
    // `getSignedUrl(PutObjectCommand, ...)`. Until then we return a
    // clear not-implemented response pointing reviewers at the spike.
    ctx.log(LogEvents.UploadInitFailed, { reason: "s3_not_implemented" });
    return NextResponse.json(
      buildApiError(
        "MISSING_CONFIGURATION",
        "Asset upload in STORAGE_MODE=s3 is scheduled but not shipped — see SPIKE-003 §Migration path. For now run with STORAGE_MODE=local to exercise the upload flow.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 501 }
    );
  }

  // Local mode — point the client back at our own PUT handler. The
  // returned URL carries the generated key so the PUT handler can
  // pin the write location without trusting client-supplied paths.
  const origin = new URL(request.url).origin;
  const encodedKey = encodeURIComponent(key);
  const responseBody: UploadInitResponseBody = {
    uploadUrl: `${origin}/api/upload?key=${encodedKey}`,
    key,
    method: "PUT",
    headers: { "Content-Type": contentType },
    assetUrl: `${origin}/api/files/${encodedKey}`,
  };
  ctx.log(LogEvents.UploadInitComplete, { key, mode });
  return NextResponse.json(responseBody, { status: 200 });
}

// ---------------------------------------------------------------------------
// PUT /api/upload?key=...  — local bytes write
// ---------------------------------------------------------------------------

export async function PUT(request: Request): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.UploadPutReceived, {
    route: "/api/upload",
    method: "PUT",
  });

  // In S3 mode the browser talks directly to S3 via pre-signed URL.
  // Nothing ever reaches this handler — return a uniform 404 rather
  // than leaking "this route exists but you're in the wrong mode."
  if (getStorageMode() === "s3") {
    ctx.log(LogEvents.UploadPutFailed, { reason: "s3_mode_routed_here" });
    return NextResponse.json(
      buildApiError(
        "NOT_FOUND",
        "Not found.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 404 }
    );
  }

  // Extract + validate the key query param. The init handler encoded
  // it — we decode once via URL(), which Next.js provides.
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key) {
    ctx.log(LogEvents.UploadPutFailed, { reason: "missing_key" });
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        "Missing required query parameter: key",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  // Key-level sanity: reject any key that doesn't start with `assets/`
  // — the init handler only ever produces keys under that prefix, so
  // a mismatch means the caller is fabricating keys. This is a defense-
  // in-depth check; the real traversal guard lives in
  // `LocalStorage.safePath`.
  if (!key.startsWith("assets/")) {
    ctx.log(LogEvents.UploadPutFailed, { reason: "unexpected_key_prefix" });
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        "Key must be produced by POST /api/upload and start with 'assets/'.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  // Content-Type allowlist. Strip charset/boundary suffix so
  // `image/png; charset=binary` (which some clients send) still matches.
  const rawContentType = request.headers.get("content-type") ?? "";
  const normalizedType = rawContentType
    .split(";")[0]
    .trim()
    .toLowerCase() as AllowedImageMime;
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(normalizedType)) {
    ctx.log(LogEvents.UploadPutFailed, { reason: "bad_content_type" });
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        `Unsupported Content-Type: "${normalizedType || rawContentType}". Expected one of: ${[...ALLOWED_IMAGE_CONTENT_TYPES].join(", ")}`,
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  // Stream-level body read with hard byte cap — see
  // `readBinaryBodyWithLimit` JSDoc for why Content-Length alone is
  // not enough.
  const bodyResult = await readBinaryBodyWithLimit(request, MAX_UPLOAD_BODY_BYTES);
  if (!bodyResult.ok) {
    const code = bodyResult.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_BRIEF";
    const status = bodyResult.reason === "too_large" ? 413 : 400;
    const msg =
      bodyResult.reason === "too_large"
        ? `Upload exceeds ${MAX_UPLOAD_BODY_BYTES} bytes.`
        : bodyResult.reason === "empty"
          ? "Upload body is empty."
          : "Failed to read upload body.";
    ctx.log(LogEvents.UploadPutFailed, { reason: bodyResult.reason });
    return NextResponse.json(
      buildApiError(code, msg, ctx.requestId) satisfies ApiError,
      { status }
    );
  }

  // Magic-byte sniff — defeats Content-Type spoofing. A 40-line check,
  // reliable for simple misuse. Cryptographic tampering can still slip
  // through, but that's a higher-threat model than a POC demo guards.
  if (!isImageMagicBytesMatching(bodyResult.data, normalizedType)) {
    ctx.log(LogEvents.UploadPutFailed, { reason: "magic_bytes_mismatch" });
    return NextResponse.json(
      buildApiError(
        "INVALID_BRIEF",
        `Uploaded file content does not match declared Content-Type (${normalizedType}).`,
        ctx.requestId
      ) satisfies ApiError,
      { status: 400 }
    );
  }

  // Write via the StorageProvider abstraction — NOT direct fs.writeFile.
  // `LocalStorage.save()` handles mkdir -p + path-traversal guard,
  // inherited from Block B. The `_contentType` parameter is unused by
  // LocalStorage (the bytes are the bytes) but we pass it for interface
  // symmetry with S3Storage.save which DOES use it as `ContentType` on
  // the PutObjectCommand.
  try {
    const storage = getStorage();
    await storage.save(key, bodyResult.data, normalizedType);
  } catch (error) {
    console.error(
      `[${ctx.requestId}] Local upload write failed for key "${key}":`,
      error
    );
    ctx.log(LogEvents.UploadPutFailed, { key, reason: "storage_write" });
    return NextResponse.json(
      buildApiError(
        "STORAGE_ERROR",
        "Failed to persist uploaded asset.",
        ctx.requestId
      ) satisfies ApiError,
      { status: 500 }
    );
  }

  ctx.log(LogEvents.UploadPutComplete, {
    key,
    bytes: bodyResult.data.length,
    contentType: normalizedType,
  });

  // 204 No Content — the client already has the key from step 1, so
  // there's no body to return. Empty body avoids unnecessary bytes on
  // the wire and matches the REST convention for successful PUT.
  return new Response(null, { status: 204 });
}
