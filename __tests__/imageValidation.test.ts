/**
 * imageValidation magic-byte sniffer — SPIKE-003 Adjustment 7.
 *
 * Asserts the sniffer correctly identifies PNG / JPEG / WebP bytes AND
 * rejects mismatched Content-Type claims (JPEG bytes declared as PNG).
 * This is the last line of defense against Content-Type spoofing in the
 * upload PUT handler.
 */

import { describe, it, expect } from "vitest";
import { isImageMagicBytesMatching } from "@/lib/pipeline/imageValidation";

describe("isImageMagicBytesMatching", () => {
  it("accepts valid PNG magic bytes declared as image/png", () => {
    // First 8 bytes of any PNG: 89 50 4E 47 0D 0A 1A 0A
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff,
    ]);
    expect(isImageMagicBytesMatching(png, "image/png")).toBe(true);
  });

  it("accepts valid JPEG magic bytes declared as image/jpeg", () => {
    // JPEG SOI + APP marker: FF D8 FF E0 (JFIF) or FF D8 FF E1 (EXIF)
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(isImageMagicBytesMatching(jpeg, "image/jpeg")).toBe(true);
  });

  it("accepts valid WebP magic bytes (RIFF + WEBP at offset 8) declared as image/webp", () => {
    // Bytes 0-3: RIFF, bytes 4-7: file length (content-dependent, don't check),
    // bytes 8-11: WEBP.
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(isImageMagicBytesMatching(webp, "image/webp")).toBe(true);
  });

  it("rejects JPEG bytes declared as image/png (Content-Type spoofing)", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(isImageMagicBytesMatching(jpeg, "image/png")).toBe(false);
  });

  it("rejects a body that is too short to contain any magic bytes", () => {
    const empty = Buffer.from([]);
    expect(isImageMagicBytesMatching(empty, "image/png")).toBe(false);
    expect(isImageMagicBytesMatching(empty, "image/jpeg")).toBe(false);
    expect(isImageMagicBytesMatching(empty, "image/webp")).toBe(false);
  });

  it("rejects a RIFF container whose bytes 8-11 are NOT 'WEBP' (e.g. AVI)", () => {
    // RIFF + file length + 'AVI ' — a valid RIFF container but not WebP
    const avi = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
    ]);
    expect(isImageMagicBytesMatching(avi, "image/webp")).toBe(false);
  });
});
