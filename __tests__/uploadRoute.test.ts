/**
 * /api/upload — route contract tests (SPIKE-003 / INVESTIGATION-003).
 *
 * Covers:
 *   T1. POST init happy path in local mode — returns a valid
 *       UploadInitResponseBody with a key under `assets/<campaignId>/`
 *       and a local upload URL pointing back at the same route
 *   T2. PUT happy path in local mode — accepts a valid PNG body,
 *       writes via LocalStorage.save(), returns 204
 *   T3. PUT rejects a body whose magic bytes don't match the declared
 *       Content-Type (Content-Type spoofing defense — Adjustment 7)
 *   T4. PUT rejects an oversized body with 413 (stream-level byte cap)
 *   T5. POST init rejects an unsupported Content-Type with 400
 *   T6. PUT rejects a missing key query param with 400
 *   T7. POST init in S3 mode returns 501 NOT_IMPLEMENTED (D1.a scope)
 *
 * WHY mock LocalStorage.save via vi.mock at the services module:
 *
 * The route calls `getStorage()` from `@/lib/api/services`, which in
 * turn calls `createStorage()` from `@/lib/storage`. Mocking at the
 * `services` boundary lets us intercept `getStorage()` without touching
 * the factory or the filesystem. The same pattern is already used in
 * `generateRoute.test.ts` — consistency matters here so future readers
 * recognize the test shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST, PUT } from "@/app/api/upload/route";

// ---------------------------------------------------------------------------
// Storage mock — captures writes so the happy path can assert on them
// ---------------------------------------------------------------------------

const mockSave = vi.fn<
  (key: string, data: Buffer, contentType: string) => Promise<string>
>();
const mockExists = vi.fn();
const mockGetUrl = vi.fn();
const mockLoad = vi.fn();

vi.mock("@/lib/api/services", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/services")>(
    "@/lib/api/services"
  );
  return {
    ...actual,
    getStorage: vi.fn(() => ({
      save: mockSave,
      exists: mockExists,
      getUrl: mockGetUrl,
      load: mockLoad,
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a POST /api/upload init request with a JSON body. */
function createInitRequest(body: unknown): Request {
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a PUT /api/upload?key=... request with a raw binary body. */
function createPutRequest(
  key: string,
  body: Uint8Array,
  contentType = "image/png"
): Request {
  // TypeScript 5.8+ tightened `BodyInit` / `BufferSource` / `BlobPart` to
  // require the generic parameter `<ArrayBuffer>` (not the widened
  // `<ArrayBufferLike>` which DOM types now treat as possibly-shared
  // memory). Our `Uint8Array` helpers return the widened form at the
  // function boundary, which is safe at runtime but fails strict TS.
  // A `BodyInit` cast is localized, explicit, and has no runtime effect —
  // Node's fetch polyfill happily accepts the Uint8Array as a body.
  return new Request(
    `http://localhost/api/upload?key=${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: body as unknown as BodyInit,
    }
  );
}

/** Valid minimal PNG magic bytes (just the first 8 bytes + some filler). */
function pngBytes(size = 64): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
}

/** Valid JPEG magic bytes for the spoofing test. */
function jpegBytes(size = 64): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/upload (init)", () => {
  const originalStorageMode = process.env.STORAGE_MODE;

  beforeEach(() => {
    process.env.STORAGE_MODE = "local";
    mockSave.mockReset();
    mockSave.mockResolvedValue("ok");
  });

  afterEach(() => {
    if (originalStorageMode === undefined) {
      delete process.env.STORAGE_MODE;
    } else {
      process.env.STORAGE_MODE = originalStorageMode;
    }
  });

  // -------------------------------------------------------------------------
  // T1 — init happy path in local mode
  // -------------------------------------------------------------------------
  it("returns an UploadInitResponseBody with a local upload URL on valid init", async () => {
    const response = await POST(
      createInitRequest({
        filename: "hero.png",
        contentType: "image/png",
        campaignId: "coastal-sun-protection-summer-2026",
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // Shape assertions
    expect(body).toHaveProperty("uploadUrl");
    expect(body).toHaveProperty("key");
    expect(body).toHaveProperty("method");
    expect(body).toHaveProperty("headers");
    expect(body).toHaveProperty("assetUrl");

    // Key is under assets/ and carries the sanitized campaign id
    expect(body.key).toMatch(
      /^assets\/coastal-sun-protection-summer-2026\/\d+-hero\.png$/
    );

    // Local upload URL points back at the upload route
    expect(body.uploadUrl).toContain("/api/upload?key=");
    expect(body.uploadUrl).toContain(encodeURIComponent(body.key));
    expect(body.method).toBe("PUT");
    expect(body.headers).toEqual({ "Content-Type": "image/png" });

    // Asset URL points at the files route (for browser preview)
    expect(body.assetUrl).toContain("/api/files/");
  });

  // -------------------------------------------------------------------------
  // T5 — init rejects unsupported Content-Type
  // -------------------------------------------------------------------------
  it("returns 400 INVALID_BRIEF when contentType is not an allowed image MIME", async () => {
    const response = await POST(
      createInitRequest({
        filename: "secret.env",
        contentType: "text/plain",
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_BRIEF");
    expect(body.message).toContain("contentType");
  });

  // -------------------------------------------------------------------------
  // T5b — init rejects missing filename
  // -------------------------------------------------------------------------
  it("returns 400 INVALID_BRIEF when filename is missing", async () => {
    const response = await POST(
      createInitRequest({
        contentType: "image/png",
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_BRIEF");
    expect(body.message).toContain("filename");
  });

  // -------------------------------------------------------------------------
  // T7 — S3 mode returns 501 in D1.a scope
  // -------------------------------------------------------------------------
  it("returns 501 in STORAGE_MODE=s3 with a message pointing at SPIKE-003", async () => {
    process.env.STORAGE_MODE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const response = await POST(
      createInitRequest({
        filename: "hero.png",
        contentType: "image/png",
      })
    );
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.code).toBe("MISSING_CONFIGURATION");
    expect(body.message).toContain("SPIKE-003");
    // Cleanup so the other tests don't see the S3_BUCKET
    delete process.env.S3_BUCKET;
  });
});

// ---------------------------------------------------------------------------
// PUT handler tests
// ---------------------------------------------------------------------------

describe("PUT /api/upload (local bytes)", () => {
  const originalStorageMode = process.env.STORAGE_MODE;

  beforeEach(() => {
    process.env.STORAGE_MODE = "local";
    mockSave.mockReset();
    mockSave.mockResolvedValue("/fake/output/assets/adhoc/123-hero.png");
  });

  afterEach(() => {
    if (originalStorageMode === undefined) {
      delete process.env.STORAGE_MODE;
    } else {
      process.env.STORAGE_MODE = originalStorageMode;
    }
  });

  // -------------------------------------------------------------------------
  // T2 — PUT happy path
  // -------------------------------------------------------------------------
  it("writes the body via LocalStorage.save and returns 204", async () => {
    const body = pngBytes(128);
    const response = await PUT(
      createPutRequest("assets/adhoc/123-hero.png", body, "image/png")
    );
    expect(response.status).toBe(204);

    // LocalStorage.save must have been called with the key, a Buffer of
    // the same length as the body, and the normalized content type.
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [key, data, contentType] = mockSave.mock.calls[0];
    expect(key).toBe("assets/adhoc/123-hero.png");
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data.length).toBe(body.length);
    expect(contentType).toBe("image/png");
  });

  // -------------------------------------------------------------------------
  // T3 — magic-byte mismatch rejected
  // -------------------------------------------------------------------------
  it("returns 400 when magic bytes do not match the declared Content-Type", async () => {
    // JPEG bytes declared as PNG — the sniffer must reject this.
    const body = jpegBytes(64);
    const response = await PUT(
      createPutRequest("assets/adhoc/123-spoof.png", body, "image/png")
    );
    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody.code).toBe("INVALID_BRIEF");
    expect(responseBody.message).toContain("declared Content-Type");
    expect(mockSave).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T4 — oversized body rejected (stream-level byte cap)
  // -------------------------------------------------------------------------
  it("returns 413 when the body exceeds the upload size cap", async () => {
    // 11 MB body — cap is 10 MB. First read chunk is >10 MB in Node's
    // Request body stream implementation (default high-water mark), so
    // the reader's first read returns the whole thing and the stream-
    // level check trips immediately.
    const oversized = new Uint8Array(11 * 1024 * 1024);
    // Still needs valid PNG magic so the check fires for size, not format.
    oversized[0] = 0x89;
    oversized[1] = 0x50;
    oversized[2] = 0x4e;
    oversized[3] = 0x47;
    const response = await PUT(
      createPutRequest("assets/adhoc/123-huge.png", oversized, "image/png")
    );
    expect(response.status).toBe(413);
    const responseBody = await response.json();
    expect(responseBody.code).toBe("REQUEST_TOO_LARGE");
    expect(mockSave).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T6 — missing key query param rejected
  // -------------------------------------------------------------------------
  it("returns 400 when the key query param is missing", async () => {
    const response = await PUT(
      new Request("http://localhost/api/upload", {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: pngBytes(64) as unknown as BodyInit,
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_BRIEF");
    expect(body.message).toContain("key");
    expect(mockSave).not.toHaveBeenCalled();
  });
});
