/**
 * readBinaryBodyWithLimit — stream-level byte cap for binary upload
 * bodies. The test surface guards SPIKE-003 Adjustment 2: uploading a
 * body larger than `maxBytes` must be rejected at the stream level,
 * NOT after the whole body has been allocated in memory.
 *
 * Tests use `new Request(url, { body: bytes, method: "POST" })` which
 * accepts Uint8Array / Buffer and produces a ReadableStream body —
 * exactly what Next.js route handlers receive.
 */

import { describe, it, expect } from "vitest";
import { readBinaryBodyWithLimit } from "@/lib/api/errors";

function makeBinaryRequest(body: Uint8Array): Request {
  // Cast to BodyInit — TS 5.8+ rejects the widened `Uint8Array<ArrayBufferLike>`
  // at the `body` slot because BufferSource was tightened to `<ArrayBuffer>`.
  // The Uint8Array is a valid runtime body for Node's fetch Request; the
  // cast is a localized opt-out of the widened-generic check only.
  return new Request("http://localhost/api/upload?key=assets/test/x.png", {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: body as unknown as BodyInit,
  });
}

describe("readBinaryBodyWithLimit", () => {
  it("reads a small body into a Buffer with matching byte length", async () => {
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
    const result = await readBinaryBodyWithLimit(
      makeBinaryRequest(payload),
      1024
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(payload.length);
    // First 4 bytes should match PNG magic — proves the Buffer contents
    // didn't get mangled during stream chunking.
    expect(result.data[0]).toBe(0x89);
    expect(result.data[1]).toBe(0x50);
    expect(result.data[2]).toBe(0x4e);
    expect(result.data[3]).toBe(0x47);
  });

  it("rejects an oversized body with reason 'too_large' at the stream level", async () => {
    // Body is 2 KB, cap is 1 KB — the first `read()` chunk should already
    // exceed the cap. The reader is cancelled immediately so no 2 KB
    // allocation ever happens.
    const payload = new Uint8Array(2048).fill(0xff);
    const result = await readBinaryBodyWithLimit(
      makeBinaryRequest(payload),
      1024
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("too_large");
  });
});
