/**
 * Image magic-byte validation — defeats Content-Type spoofing.
 *
 * The upload route trusts neither the client's declared `Content-Type`
 * header nor the filename extension. A reviewer uploading a secrets
 * file as `secret.png` with `Content-Type: image/png` would otherwise
 * flow all the way to `Sharp.resize()` which would reject it with a
 * confusing "unsupported image format" deep in the pipeline — by which
 * point the bytes have been persisted to storage and the request has
 * already been counted as successful.
 *
 * Matching the first few bytes of the body against each image format's
 * published magic bytes is a ~20-line check that catches this at the
 * boundary. It's not a cryptographic guarantee (a crafted file could
 * still have valid PNG headers followed by garbage), but it's enough to
 * block accidental misuse and simple spoofing, and any surviving garbage
 * will fail cleanly inside Sharp at compositing time.
 *
 * References:
 * - PNG: https://www.w3.org/TR/png/#5PNG-file-signature
 *   First 8 bytes are `89 50 4E 47 0D 0A 1A 0A`. Checking the first 4
 *   (`89 50 4E 47` = `\x89PNG`) is enough — the trailing bytes are a
 *   line-ending sanity check, not a format marker.
 * - JPEG: https://www.iso.org/standard/18902.html
 *   SOI (Start of Image) marker is `FF D8`, followed by an APP0 or APP1
 *   marker starting with `FF`. Checking the first 3 bytes (`FF D8 FF`)
 *   matches both JFIF and EXIF variants.
 * - WebP: https://developers.google.com/speed/webp/docs/riff_container
 *   RIFF container — bytes 0-3 are `52 49 46 46` (`RIFF`), bytes 4-7 are
 *   the file length, bytes 8-11 are `57 45 42 50` (`WEBP`). The file-length
 *   field is content-dependent so we skip it; checking the `RIFF` marker
 *   AND the `WEBP` marker at offset 8 is the canonical sniff.
 */

/**
 * The image MIME types the upload route accepts. Keep in sync with the
 * `ALLOWED_IMAGE_CONTENT_TYPES` set in `app/api/upload/route.ts`.
 */
export type AllowedImageMime = "image/png" | "image/jpeg" | "image/webp";

// Magic byte sequences per format.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const;

/**
 * Test whether `buf` begins with the given byte sequence at the given
 * offset. Bounds-checked — returns false if the buffer is shorter than
 * `offset + magic.length`.
 */
function startsWith(
  buf: Buffer,
  magic: readonly number[],
  offset = 0
): boolean {
  if (buf.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[offset + i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Check whether the first bytes of `buf` match the magic bytes for
 * `declaredMime`. Returns false on mismatch — the caller should reject
 * the upload with a 400.
 *
 * The function is total over the `AllowedImageMime` union: TypeScript's
 * exhaustiveness check catches a new variant being added without a
 * matching case. If a future PR widens `AllowedImageMime` to include
 * GIF, AVIF, or HEIC, the compiler will surface it here.
 */
export function isImageMagicBytesMatching(
  buf: Buffer,
  declaredMime: AllowedImageMime
): boolean {
  switch (declaredMime) {
    case "image/png":
      return startsWith(buf, PNG_MAGIC);
    case "image/jpeg":
      return startsWith(buf, JPEG_MAGIC);
    case "image/webp":
      // WebP is RIFF-wrapped — the `RIFF` marker is at offset 0, the
      // `WEBP` marker is at offset 8 (after the 4-byte file length
      // field that we intentionally skip because it's content-dependent).
      return startsWith(buf, RIFF_MAGIC, 0) && startsWith(buf, WEBP_MAGIC, 8);
  }
}
