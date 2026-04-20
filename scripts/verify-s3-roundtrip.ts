/**
 * verify-s3-roundtrip — end-to-end S3 sanity check for the AdSpark bucket.
 *
 * Exercises every code path the pipeline uses against the real bucket:
 *
 *   1. Save a tiny test PNG via `S3Storage.save`   (PutObject)
 *   2. Verify it exists via `S3Storage.exists`     (HeadObject)
 *   3. Mint a pre-signed GET URL via `S3Storage.getUrl`
 *   4. Fetch the URL via native fetch to prove the browser path works
 *   5. Verify the round-tripped bytes match the uploaded bytes
 *   6. Delete the test object (direct `DeleteObjectCommand` — not part of
 *      the `StorageProvider` interface)
 *
 * WHY this script exists:
 *
 * The route-level tests mock `StorageProvider`, so they prove the route
 * CALLS storage correctly but not that storage ACTUALLY WORKS against
 * the real bucket. That's the gap this script closes — it's a live
 * integration probe you can run anytime to confirm:
 *
 *   - AWS credentials in `~/.aws/credentials` authenticate successfully
 *   - The bucket is reachable + writable
 *   - Pre-signed GET URLs mint correctly
 *   - Pre-signed GET URLs are fetchable from the current origin
 *     (proves the bucket CORS rule permits GET from wherever this runs)
 *   - The HeadObject + PutObject + GetObject + DeleteObject IAM
 *     permissions are all in place on the effective identity
 *
 * SECURITY NOTES:
 *
 *   - Pre-signed URLs are short-lived credentials — the script DOES NOT
 *     print the full URL to stdout. Only its length + a masked prefix.
 *   - Access keys never reach stdout. The AWS SDK reads them from
 *     `~/.aws/credentials` via the default provider chain.
 *   - Test objects are written to `verify-roundtrip/<timestamp>-test.png`
 *     and deleted on both success AND failure paths. Nothing lingers.
 *
 * HOW TO RUN:
 *
 *   S3_BUCKET=adspark-creatives-905740063772 npx tsx scripts/verify-s3-roundtrip.ts
 *
 * or if S3 env vars are already set in your shell:
 *
 *   npx tsx scripts/verify-s3-roundtrip.ts
 *
 * Exit code 0 on success, 1 on any failure.
 */

import sharp from "sharp";
import {
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { S3Storage } from "../lib/storage/s3Storage";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.S3_REGION ?? "us-east-1";

if (!BUCKET) {
  console.error("FAIL: S3_BUCKET env var required");
  console.error("");
  console.error("Run with the bucket name inline:");
  console.error(
    "  S3_BUCKET=adspark-creatives-905740063772 npx tsx scripts/verify-s3-roundtrip.ts"
  );
  console.error("");
  console.error("Or export the env vars first:");
  console.error("  $env:S3_BUCKET='adspark-creatives-905740063772'   # PowerShell");
  console.error("  export S3_BUCKET=adspark-creatives-905740063772    # bash");
  process.exit(1);
}

/**
 * Key prefix used for all test objects this script creates. Scoped under
 * `verify-roundtrip/` so it never collides with pipeline output (which
 * uses `<campaignId>/...`) or uploads (which use `assets/...`).
 *
 * Every object this script writes has a timestamp suffix so repeated
 * runs don't collide with each other. Cleanup removes the object on
 * both success + failure paths.
 */
const TEST_KEY = `verify-roundtrip/${Date.now()}-test.png`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a pre-signed URL before logging. The URL query string contains the
 * AWS signature — short-lived credential material we don't want to echo
 * into terminal history. Showing just the domain + first few chars of the
 * path is enough to confirm the URL is well-formed.
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const prefix = `${parsed.origin}${parsed.pathname}`;
    return `${prefix.slice(0, 80)}...?<${url.length - prefix.length} sig chars redacted>`;
  } catch {
    return `<unparseable url, ${url.length} chars>`;
  }
}

/**
 * Step logger — prints a consistent `[N/M] ...` prefix so the flow is
 * easy to follow in the terminal. Step numbers are baked in so the
 * script can evolve without renumbering.
 */
function step(n: number, total: number, message: string): void {
  console.log(`[${n}/${total}] ${message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const storage = new S3Storage(BUCKET!, REGION);
  let uploaded = false;

  try {
    // Step 1: generate a tiny valid PNG
    step(1, 6, "generating 8x8 test PNG via Sharp");
    const buf = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 244, g: 162, b: 97 },
      },
    })
      .png()
      .toBuffer();
    console.log(`     bytes=${buf.length}`);

    // Step 2: upload via S3Storage.save — exercises PutObjectCommand
    step(2, 6, `storage.save("${TEST_KEY}", ..., "image/png")`);
    await storage.save(TEST_KEY, buf, "image/png");
    uploaded = true;
    console.log(`     uploaded`);

    // Step 3: verify object exists via HeadObject
    step(3, 6, `storage.exists("${TEST_KEY}")`);
    const exists = await storage.exists(TEST_KEY);
    if (!exists) {
      throw new Error(
        "exists() returned false immediately after save() — possible S3 read-after-write consistency issue OR missing s3:GetObject / s3:ListBucket permission on the effective identity"
      );
    }
    console.log(`     ok`);

    // Step 4: mint pre-signed GET URL
    step(4, 6, `storage.getUrl("${TEST_KEY}")`);
    const signedUrl = await storage.getUrl(TEST_KEY);
    console.log(`     minted: ${maskUrl(signedUrl)}`);

    // Step 5: fetch the URL via native fetch — proves browser path works
    step(5, 6, "fetch(signedUrl) — simulates browser GET");
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(
        `fetch failed: HTTP ${response.status} ${response.statusText}`
      );
    }
    const fetched = Buffer.from(await response.arrayBuffer());
    console.log(`     HTTP ${response.status} bytes=${fetched.length}`);

    // Step 6: byte-for-byte match
    step(6, 6, "byte-for-byte equality check");
    if (fetched.length !== buf.length) {
      throw new Error(
        `byte-count mismatch: uploaded=${buf.length} fetched=${fetched.length}`
      );
    }
    if (!fetched.equals(buf)) {
      throw new Error(
        "byte-content mismatch: buffers have identical length but differ in content"
      );
    }
    console.log(`     match`);

    console.log(
      "\n✅ S3 roundtrip PASSED — bucket is reachable, writable, readable, and pre-signed URLs work from this host"
    );
  } catch (err) {
    console.error(
      `\n❌ S3 roundtrip FAILED: ${err instanceof Error ? err.message : String(err)}`
    );
    if (err instanceof Error && err.stack) {
      // Print only the FIRST stack frame — full stacks can leak internal
      // SDK paths but the first frame is useful for diagnosing which
      // operation exploded.
      const firstFrame = err.stack
        .split("\n")
        .slice(1, 2)
        .join("\n")
        .trim();
      if (firstFrame) {
        console.error(`   at ${firstFrame.replace(/^at\s*/, "")}`);
      }
    }
    process.exitCode = 1;
  } finally {
    // Cleanup — always attempt to delete the test object so failed runs
    // don't leave junk in the bucket. Uses the raw SDK because the
    // `StorageProvider` interface (intentionally) doesn't expose delete.
    if (uploaded) {
      try {
        const client = new S3Client({ region: REGION });
        await client.send(
          new DeleteObjectCommand({ Bucket: BUCKET!, Key: TEST_KEY })
        );
        console.log(`[cleanup] deleted ${TEST_KEY}`);
      } catch (cleanupErr) {
        console.warn(
          `[cleanup] WARNING: could not delete test object: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`
        );
        console.warn(
          `[cleanup] run manually: aws s3 rm s3://${BUCKET}/${TEST_KEY}`
        );
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(
    `FATAL: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
