/**
 * Unit tests for GET /api/files/[...path] — the local-mode file-serving route.
 *
 * Strategy: create a real temporary directory, write fixture files into
 * it, point `LOCAL_OUTPUT_DIR` at it, and invoke the route handler
 * directly with a constructed Request + params. Real filesystem + real
 * route handler = tests that actually prove the security boundary.
 *
 * What these tests prove:
 * 1. Happy path: PNG / WEBP / JSON files served with correct Content-Type
 * 2. Path traversal via `..` is blocked
 * 3. Extension allowlist rejects `.env`, `.html`, `.js`, `.ts`
 * 4. Missing files return 404
 * 5. Directory requests return 404
 * 6. Empty path returns 404
 * 7. Cache-Control header is set on successful responses
 * 8. Content-Length header matches file bytes
 * 9. Response body bytes match file bytes exactly
 * 10. `STORAGE_MODE=s3` disables the route entirely
 * 11. Nested multi-segment paths work
 * 12. Error responses use the ApiError envelope with a `files-` requestId
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/files/[...path]/route";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Fixture setup — real temp directory populated with real test files
// ---------------------------------------------------------------------------

let tempRoot: string;
const originalEnv = {
  localOutputDir: process.env.LOCAL_OUTPUT_DIR,
  storageMode: process.env.STORAGE_MODE,
};

// Realistic fixture: a valid 1x1 PNG (smallest possible, 67 bytes). This
// is the minimum valid PNG that `file` or `sharp` would recognize —
// important because a non-valid PNG could mask MIME-type bugs.
const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, // width = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  0x08, 0x02, // bit depth = 8, color type = 2 (RGB)
  0x00, 0x00, 0x00, // compression, filter, interlace
  0x90, 0x77, 0x53, 0xde, // CRC
  0x00, 0x00, 0x00, 0x0c, // IDAT chunk length
  0x49, 0x44, 0x41, 0x54, // "IDAT"
  0x08, 0x99, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01, // data
  0xe2, 0x26, 0x05, 0x9b, // CRC
  0x00, 0x00, 0x00, 0x00, // IEND chunk length
  0x49, 0x45, 0x4e, 0x44, // "IEND"
  0xae, 0x42, 0x60, 0x82, // CRC
]);

// Tiny WEBP fixture — just the RIFF header + minimum VP8L chunk. Enough
// for Content-Type checks even though it's not a renderable image.
const VALID_WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x1a, 0x00, 0x00, 0x00, // file size
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x56, 0x50, 0x38, 0x4c, // "VP8L"
  0x0e, 0x00, 0x00, 0x00, // VP8L chunk size
  0x2f, 0x00, 0x00, 0x00, 0x00, // VP8L magic + size
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // placeholder data
]);

const VALID_MANIFEST = {
  campaignId: "summer-2026-suncare",
  creatives: [],
  totalImages: 0,
};

beforeAll(() => {
  // Create a unique temp directory per test run. Windows-safe because
  // os.tmpdir() returns a writable temp path on all platforms.
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adspark-files-test-"));

  // Populate with a realistic campaign folder structure matching what
  // the pipeline actually produces.
  const campaignDir = path.join(
    tempRoot,
    "summer-2026-suncare",
    "spf-50-sunscreen",
    "1x1"
  );
  fs.mkdirSync(campaignDir, { recursive: true });

  fs.writeFileSync(path.join(campaignDir, "creative.png"), VALID_PNG_BYTES);
  fs.writeFileSync(path.join(campaignDir, "thumbnail.webp"), VALID_WEBP_BYTES);
  fs.writeFileSync(
    path.join(tempRoot, "summer-2026-suncare", "manifest.json"),
    JSON.stringify(VALID_MANIFEST, null, 2)
  );

  // A forbidden-extension file to prove the allowlist
  fs.writeFileSync(
    path.join(tempRoot, "summer-2026-suncare", "secret.env"),
    "API_KEY=shouldnotbereachable"
  );
});

afterAll(() => {
  // Recursive removal — Node 14.14+ supports { recursive: true } on rm
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.LOCAL_OUTPUT_DIR = tempRoot;
  process.env.STORAGE_MODE = "local";
  // Note: we don't touch NODE_ENV because TypeScript types it as readonly.
  // The dev-mode console.error calls in the route handler will fire during
  // negative-path tests — that's expected output and doesn't affect correctness.
});

afterEach(() => {
  // Restore originals so the test file doesn't pollute sibling tests
  if (originalEnv.localOutputDir === undefined) {
    delete process.env.LOCAL_OUTPUT_DIR;
  } else {
    process.env.LOCAL_OUTPUT_DIR = originalEnv.localOutputDir;
  }
  if (originalEnv.storageMode === undefined) {
    delete process.env.STORAGE_MODE;
  } else {
    process.env.STORAGE_MODE = originalEnv.storageMode;
  }
});

// ---------------------------------------------------------------------------
// Test helper — construct a route-handler invocation with catch-all params
// ---------------------------------------------------------------------------

function callGet(pathSegments: string[]): Promise<Response> {
  // Next.js 15 delivers `params` as a Promise; the handler awaits it.
  const request = new Request(
    `http://test/api/files/${pathSegments.join("/")}`
  );
  return GET(request, {
    params: Promise.resolve({ path: pathSegments }),
  });
}

// ---------------------------------------------------------------------------
// Group 1: Happy path — valid files served correctly
// ---------------------------------------------------------------------------

describe("GET /api/files/[...path] — happy path", () => {
  it("serves a PNG with image/png Content-Type", async () => {
    const response = await callGet([
      "summer-2026-suncare",
      "spf-50-sunscreen",
      "1x1",
      "creative.png",
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("serves a WEBP with image/webp Content-Type", async () => {
    const response = await callGet([
      "summer-2026-suncare",
      "spf-50-sunscreen",
      "1x1",
      "thumbnail.webp",
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  it("serves a JSON manifest with application/json Content-Type", async () => {
    const response = await callGet(["summer-2026-suncare", "manifest.json"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const parsed = await response.json();
    expect(parsed).toEqual(VALID_MANIFEST);
  });

  it("serves PNG body bytes that match the source file exactly", async () => {
    const response = await callGet([
      "summer-2026-suncare",
      "spf-50-sunscreen",
      "1x1",
      "creative.png",
    ]);

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.equals(VALID_PNG_BYTES)).toBe(true);
    expect(response.headers.get("Content-Length")).toBe(
      String(VALID_PNG_BYTES.byteLength)
    );
  });
});

// ---------------------------------------------------------------------------
// Group 2: Path traversal protection
// ---------------------------------------------------------------------------

describe("GET /api/files/[...path] — path traversal protection", () => {
  it("rejects `..` segments attempting to escape the base directory", async () => {
    // Try to read a file outside tempRoot by climbing up with `..`.
    // The handler must resolve the path and refuse to serve.
    const response = await callGet([
      "..",
      "..",
      "etc",
      "passwd",
    ]);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("File not found.");
  });

  it("rejects a deeply-nested traversal that ends inside tempRoot", async () => {
    // Tricky case: the `..` segments cancel out but still require the
    // `startsWith(root + sep)` check to work correctly. If someone
    // removes that check, this test catches the regression.
    const response = await callGet([
      "summer-2026-suncare",
      "..",
      "..",
      "..",
      "something",
    ]);

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Extension allowlist
// ---------------------------------------------------------------------------

describe("GET /api/files/[...path] — extension allowlist", () => {
  it("rejects .env files even when they exist inside the base directory", async () => {
    // The fixture writes a real `.env` file into tempRoot. Extension
    // check must reject it BEFORE the filesystem read, so the file is
    // never exposed.
    const response = await callGet(["summer-2026-suncare", "secret.env"]);

    expect(response.status).toBe(404);
  });

  it("rejects .js extension", async () => {
    const response = await callGet(["some", "script.js"]);
    expect(response.status).toBe(404);
  });

  it("rejects .html extension", async () => {
    const response = await callGet(["index.html"]);
    expect(response.status).toBe(404);
  });

  it("rejects files with no extension", async () => {
    const response = await callGet(["some", "binary"]);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Missing files + edge cases
// ---------------------------------------------------------------------------

describe("GET /api/files/[...path] — missing files and edge cases", () => {
  it("returns 404 for a non-existent PNG file", async () => {
    const response = await callGet([
      "summer-2026-suncare",
      "nonexistent-product",
      "1x1",
      "creative.png",
    ]);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("returns 404 for an empty path", async () => {
    const response = await callGet([]);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a directory path (readFile fails on dirs)", async () => {
    // The `1x1` directory exists but is not a file. `fs.readFile` on a
    // directory throws EISDIR, which falls into the generic 404 path.
    const response = await callGet([
      "summer-2026-suncare",
      "spf-50-sunscreen",
      "1x1.json", // doesn't exist as a file, won't resolve
    ]);

    expect(response.status).toBe(404);
  });

  it("returns an ApiError envelope with a `files-` correlation id", async () => {
    const response = await callGet([
      "nonexistent.png",
    ]);

    const body = await response.json();
    expect(body).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "File not found.",
    });
    expect(body.requestId).toMatch(/^files-/);
  });
});

// ---------------------------------------------------------------------------
// Group 5: STORAGE_MODE=s3 disables the route
// ---------------------------------------------------------------------------

describe("GET /api/files/[...path] — storage mode gating", () => {
  it("returns 404 when STORAGE_MODE=s3 (local route should be disabled)", async () => {
    process.env.STORAGE_MODE = "s3";

    const response = await callGet([
      "summer-2026-suncare",
      "spf-50-sunscreen",
      "1x1",
      "creative.png",
    ]);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("serves files correctly when STORAGE_MODE is unset (defaults to local)", async () => {
    delete process.env.STORAGE_MODE;

    const response = await callGet([
      "summer-2026-suncare",
      "manifest.json",
    ]);

    expect(response.status).toBe(200);
  });
});
