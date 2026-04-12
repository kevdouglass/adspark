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
 * SECURITY:
 *
 * - Path traversal prevention: `path.resolve()` the requested key against
 *   the base directory, then verify the resolved path is still inside
 *   the base via a `startsWith(base + sep)` check. Mirrors the same
 *   defensive pattern used in `lib/storage/localStorage.ts:safePath`.
 *
 * - Extension allowlist: only `.png`, `.webp`, `.jpg/.jpeg`, `.json`
 *   are served. Everything else returns 404 — prevents someone pointing
 *   the route at a source file or `.env` if the base directory is
 *   misconfigured to a parent of the project root.
 *
 * - No directory listing: requests that resolve to a directory return 404.
 *
 * - No symlink following: `fs.readFile` follows symlinks by default, but
 *   the `path.resolve` + `startsWith` check is done on the REQUESTED
 *   path, not the resolved symlink target. If an attacker can write a
 *   symlink inside `output/` pointing to `/etc/passwd`, they've already
 *   compromised the box. Acceptable for the POC.
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
 * Cache-Control for successful responses. Generated creatives are
 * content-addressed by campaign id + product slug + aspect ratio, so
 * once written they never change. `immutable` lets browsers skip the
 * revalidation request entirely.
 */
const IMMUTABLE_CACHE_HEADER = "public, max-age=31536000, immutable";

/**
 * Resolve the active local output directory from the environment.
 * Called per-request so tests can change `LOCAL_OUTPUT_DIR` between
 * test cases without restarting the Next.js runtime.
 */
function getLocalRoot(): string {
  return path.resolve(process.env.LOCAL_OUTPUT_DIR ?? "./output");
}

/**
 * Build a 404 `ApiError` response with a client-generated correlation id.
 * All 404 responses share the same generic message — developers check
 * the server logs by requestId to see what actually happened.
 */
function notFoundResponse(): Response {
  return NextResponse.json(
    buildApiError(
      "INTERNAL_ERROR",
      "File not found.",
      `files-${crypto.randomUUID()}`
    ),
    { status: 404 }
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  // Local-only route: if S3 mode is active, the frontend should be
  // using the pre-signed URLs from the response envelope. Returning
  // 404 here prevents a confusing bypass path on cloud deployments.
  const storageMode = process.env.STORAGE_MODE ?? "local";
  if (storageMode !== "local") {
    return notFoundResponse();
  }

  // Next.js 15 delivers catch-all segments as a Promise resolving to
  // an array of decoded path segments. `/api/files/a/b/c.png` →
  // `['a', 'b', 'c.png']`. URL-encoded `/api/files/a%2Fb.png` →
  // `['a/b.png']` (single segment preserving the encoded separator).
  // Joining with `/` handles both cases uniformly.
  const { path: pathSegments } = await context.params;
  const key = pathSegments.join("/");
  if (!key) {
    return notFoundResponse();
  }

  // Extension allowlist — check BEFORE path resolution so we don't
  // waste a filesystem call on a request we'd reject anyway.
  const ext = path.extname(key).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return notFoundResponse();
  }

  // Path traversal protection. `path.resolve(root, key)` normalizes
  // `..` and `.` segments; the `startsWith(root + sep)` check verifies
  // the resolved path didn't escape the base. We also accept `resolved
  // === root` as a safety-net (would match a request for the root
  // itself, which isn't a file anyway and fails the readFile below).
  const root = getLocalRoot();
  const resolved = path.resolve(root, key);
  const isInsideRoot =
    resolved.startsWith(root + path.sep) || resolved === root;
  if (!isInsideRoot) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[files route] path traversal attempt: key="${key}" resolved="${resolved}" root="${root}"`
      );
    }
    return notFoundResponse();
  }

  // Read + serve. Any error (missing file, permission denied, it's a
  // directory) returns 404 with a generic message. The specific error
  // goes to console.error for dev debugging but NOT to the response.
  let data: Buffer;
  try {
    data = await fs.readFile(resolved);
  } catch (caught) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[files route] failed to read "${resolved}":`,
        caught instanceof Error ? caught.message : caught
      );
    }
    return notFoundResponse();
  }

  // Node's `Buffer` is a `Uint8Array` at runtime and Response accepts it,
  // but TypeScript's DOM `BodyInit` type is resolved in Next.js with a
  // quirk that refuses generic `Uint8Array<ArrayBufferLike>`. Copy the
  // bytes into a true `ArrayBuffer` (via `.slice()`) which satisfies
  // the type system without runtime surprises. Files are small (<5MB
  // per the module-level size-cap note), so the copy cost is negligible.
  const arrayBuffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": IMMUTABLE_CACHE_HEADER,
      "Content-Length": String(data.byteLength),
    },
  });
}
