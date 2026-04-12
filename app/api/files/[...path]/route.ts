/**
 * GET /api/files/[...path] — Local-mode file-serving route.
 *
 * Makes creatives written to the local filesystem loadable from the
 * browser. Without this route, local-mode generation works end-to-end
 * on the backend but the React gallery can't display the results —
 * `file://` paths don't work from a web page.
 *
 * WHY a server-side route (not `public/`):
 *
 * The pipeline writes to a mutable directory (`./output` by default)
 * that can contain hundreds of campaign folders at any given time. Next.js
 * only serves static files from `public/` at build time — new files written
 * after `next build` would never be visible to the browser. This route
 * reads from the live output directory on every request so generated
 * creatives are immediately available.
 *
 * WHY local-only:
 *
 * In S3 mode, the frontend uses the pre-signed URLs returned in the
 * `GenerateSuccessResponseBody` directly — no serving route needed. This
 * route returns 404 when STORAGE_MODE=s3 to avoid a confusing bypass
 * where local-mode URLs happen to resolve against a dev machine's
 * filesystem on a cloud deploy.
 *
 * SECURITY (defense in depth):
 *
 * 1. Path traversal: `path.resolve()` the requested key against the base
 *    directory, then verify the resolved path is still inside the base
 *    via a `startsWith(base + sep)` check.
 *
 * 2. Symlink escape: after the path-resolve check, call `fs.realpath()`
 *    and verify the symlink-resolved path ALSO lives under the base.
 *    This catches a symlink planted inside `output/` pointing at
 *    `/etc/passwd` — which is realistic because the pipeline writes to
 *    this directory based on partially user-controlled data (campaign
 *    id, product slug). A path-traversal bug anywhere upstream in the
 *    writer would become a read-arbitrary-file bug without this layer.
 *
 * 3. Extension allowlist: only `.png`, `.webp`, `.jpg/.jpeg`, `.json`
 *    are served. For `.json` specifically, a stricter check verifies
 *    the basename is exactly `manifest.json` — this prevents a
 *    misconfigured LOCAL_OUTPUT_DIR from serving `package.json`,
 *    `tsconfig.json`, or `.env.json` secret configs.
 *
 * 4. Basename regex: the full basename must match a strict pattern
 *    (`/^[a-zA-Z0-9_-]+\.(png|webp|jpe?g|json)$/`) so double-extension
 *    tricks like `secret.env.png` are rejected.
 *
 * 5. Size cap: `fs.stat()` before reading — files larger than
 *    MAX_FILE_SIZE_BYTES are rejected to prevent memory exhaustion
 *    from a compromised or buggy writer.
 *
 * 6. No directory listing: requests that resolve to a directory return
 *    404 (stat detects it, readFile would also throw EISDIR).
 *
 * 7. Uniform 404 responses: every failure mode returns the same body
 *    so attackers cannot enumerate which files exist, are misconfigured,
 *    or are blocked by extension.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildApiError } from "@/lib/api/errors";

/**
 * Allowed file extensions. Everything else returns 404 — prevents
 * accidentally serving source files, config, or binaries.
 */
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".json",
]);

/**
 * For `.json` files, only `manifest.json` is served. This prevents a
 * misconfigured `LOCAL_OUTPUT_DIR` (e.g., set to the repo root) from
 * exposing `package.json`, `tsconfig.json`, `.env.json`, `.vercel/project.json`,
 * or any other JSON config that commonly contains secrets.
 */
const ALLOWED_JSON_BASENAME = "manifest.json";

/**
 * Strict basename regex — alphanumeric + dashes + underscores, single
 * dot, one of the allowed extensions. Rejects double-extension tricks
 * like `secret.env.png` because `secret.env` contains a dot that isn't
 * in the character class before the final extension.
 */
const STRICT_BASENAME_RE = /^[a-zA-Z0-9_-]+\.(png|webp|jpe?g|json)$/i;

/**
 * Map extension → Content-Type header value. Unknown extensions
 * (which shouldn't reach this map because of the allowlist) fall back
 * to `application/octet-stream`.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

/**
 * Maximum file size for serving. Larger files return 404 to prevent
 * memory exhaustion from a compromised or buggy writer. 10 MB is
 * generous — real DALL-E 1024×1024 PNGs are ~2-3 MB, and the biggest
 * 9:16 creatives top out around 4-5 MB.
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Cache-Control for successful responses.
 *
 * WHY NOT `immutable`: a prior version used `immutable` with the
 * rationale that files are content-addressed. They're NOT — filenames
 * are `{campaignId}/{product}/{ratio}/creative.png`, so re-running the
 * pipeline with the same brief overwrites the file at the same URL.
 * An `immutable` cache would make browsers serve the stale version
 * forever. `stale-while-revalidate` gives us snappy cached loads with
 * a fresh check in the background.
 */
const CACHE_CONTROL_HEADER =
  "public, max-age=3600, stale-while-revalidate=86400";

/**
 * Resolve the active local output directory from the environment.
 * Called per-request so tests can change `LOCAL_OUTPUT_DIR` between
 * test cases without restarting the Next.js runtime.
 */
function getLocalRoot(): string {
  return path.resolve(process.env.LOCAL_OUTPUT_DIR ?? "./output");
}

/**
 * Normalize and read the storage mode from the environment.
 *
 * `.trim().toLowerCase()` handles trailing-whitespace and casing typos
 * from a misconfigured Vercel env ("local ", "LOCAL", "Local"). The
 * comparison below is `=== "s3"` (fail-open on unknown), so an
 * unrecognized value falls through to local-mode serving — consistent
 * with the default when the env var is unset.
 */
function getStorageMode(): string {
  return (process.env.STORAGE_MODE ?? "local").trim().toLowerCase();
}

/**
 * Build a 404 `ApiError` response with the given correlation id.
 * All 404 responses share the same generic message so an attacker
 * cannot distinguish "file missing" from "extension rejected" from
 * "storage mode disabled" — prevents filesystem enumeration.
 */
function notFoundResponse(requestId: string): Response {
  return NextResponse.json(
    buildApiError("NOT_FOUND", "File not found.", requestId),
    { status: 404 }
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  // Mint the correlation id FIRST so every log line in this request
  // shares the same id. Mirrors `/api/generate`'s pattern via
  // `createRequestContext()` — unified grep-by-id debugging.
  const requestId = `files-${crypto.randomUUID()}`;

  // Local-only route: if S3 mode is active, the frontend should be
  // using the pre-signed URLs from the response envelope. Check is
  // fail-open on unknown values (treats garbage as local) so missing
  // or misconfigured env vars don't silently 404 every file.
  if (getStorageMode() === "s3") {
    return notFoundResponse(requestId);
  }

  // Next.js 15 delivers catch-all segments as a Promise resolving to
  // an array of decoded path segments. `/api/files/a/b/c.png` →
  // `['a', 'b', 'c.png']`. URL-encoded `/api/files/a%2Fb.png` →
  // `['a/b.png']` (single segment preserving the encoded separator).
  // Joining with `/` handles both cases uniformly.
  const { path: pathSegments } = await context.params;
  const key = pathSegments.join("/");
  if (!key) {
    return notFoundResponse(requestId);
  }

  // Extension allowlist — check BEFORE path resolution so we don't
  // waste filesystem calls on requests we'd reject anyway.
  const ext = path.extname(key).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return notFoundResponse(requestId);
  }

  // Path traversal protection via path.resolve + startsWith check.
  // `path.resolve(root, key)` normalizes `..` and `.` segments; the
  // `startsWith(root + sep)` check verifies the resolved path didn't
  // escape the base.
  const root = getLocalRoot();
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[${requestId}] path traversal attempt: key="${key}" resolved="${resolved}" root="${root}"`
      );
    }
    return notFoundResponse(requestId);
  }

  // Strict basename check — rejects double-extension tricks like
  // `secret.env.png` (contains a dot before the final extension that
  // isn't in the allowed character class).
  const basename = path.basename(resolved);
  if (!STRICT_BASENAME_RE.test(basename)) {
    return notFoundResponse(requestId);
  }

  // For .json, restrict to the exact `manifest.json` filename. Prevents
  // a misconfigured LOCAL_OUTPUT_DIR from serving package.json,
  // tsconfig.json, .env.json, etc.
  if (ext === ".json" && basename !== ALLOWED_JSON_BASENAME) {
    return notFoundResponse(requestId);
  }

  // Defense-in-depth: symlink realpath check.
  //
  // `path.resolve` + `startsWith` only checks the REQUESTED path
  // textually — it doesn't follow symlinks. If a symlink inside
  // `output/` points at `/etc/passwd`, the resolved path still looks
  // like it's under `output/`, and `fs.readFile` would happily follow
  // the symlink. Calling `fs.realpath` expands the link and we re-check
  // the result against the base.
  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch (caught) {
    // realpath fails for missing files — surface as a standard 404.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[${requestId}] realpath failed for "${resolved}":`,
        caught instanceof Error ? caught.message : caught
      );
    }
    return notFoundResponse(requestId);
  }
  if (!realPath.startsWith(root + path.sep)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[${requestId}] symlink escape attempt: key="${key}" realPath="${realPath}" root="${root}"`
      );
    }
    return notFoundResponse(requestId);
  }

  // Size cap via fs.stat — reject files larger than MAX_FILE_SIZE_BYTES
  // BEFORE loading them into memory. Also catches "it's a directory"
  // via stat.isFile() — EISDIR is a specific error class and we want
  // uniform 404s.
  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(realPath);
  } catch (caught) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[${requestId}] stat failed for "${realPath}":`,
        caught instanceof Error ? caught.message : caught
      );
    }
    return notFoundResponse(requestId);
  }
  if (!stats.isFile()) {
    return notFoundResponse(requestId);
  }
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[${requestId}] file exceeds size cap: "${realPath}" (${stats.size} bytes > ${MAX_FILE_SIZE_BYTES})`
      );
    }
    return notFoundResponse(requestId);
  }

  // Read the file.
  let data: Buffer;
  try {
    data = await fs.readFile(realPath);
  } catch (caught) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[${requestId}] readFile failed for "${realPath}":`,
        caught instanceof Error ? caught.message : caught
      );
    }
    return notFoundResponse(requestId);
  }

  // Convert Node Buffer to a fresh Uint8Array. Buffer IS a Uint8Array
  // at runtime, but its typing as `Uint8Array<ArrayBufferLike>` conflicts
  // with `Response`'s expected `Uint8Array<ArrayBuffer>`. Copying via
  // `new Uint8Array(data)` produces a clean `Uint8Array<ArrayBuffer>`.
  // The copy cost is negligible (<5 MB files) and this is the idiomatic
  // fix without any type casts.
  const body = new Uint8Array(data);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL_HEADER,
      "Content-Length": String(stats.size),
    },
  });
}
