/**
 * S3 Storage — AWS S3-based storage for production deployment.
 *
 * Implements the `StorageProvider` interface using AWS S3 via the v3
 * SDK (`@aws-sdk/client-s3`) and pre-signed URL generator
 * (`@aws-sdk/s3-request-presigner`).
 *
 * WHY pre-signed URLs instead of public buckets:
 *
 * The alternative to pre-signed URLs is making the bucket (or specific
 * objects) publicly readable. That would leak generated campaign
 * assets to anyone who can guess a URL — a compliance and brand-safety
 * problem for a creative automation platform. Pre-signed URLs let us
 * keep the bucket private and mint short-lived (24-hour) URLs only
 * when a creative is actually being displayed to a user.
 *
 * WHY 24-hour URL expiry:
 *
 * Matches `docs/architecture/deployment.md`. Long enough that a user
 * can refresh the gallery mid-session without getting expired images,
 * short enough that leaked URLs don't grant permanent access. If a
 * user revisits the dashboard the next day, the gallery re-fetches the
 * generation results via `/api/generate` (or cached state) and the
 * URLs are minted fresh.
 *
 * WHY credentials aren't explicit:
 *
 * The AWS SDK v3 auto-resolves credentials from the environment chain:
 * `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` env vars, then IAM
 * instance profiles, then `~/.aws/credentials`, etc. Explicitly
 * passing them would fight the SDK's own credential loader and make
 * deployment harder (e.g., on Vercel where only env vars are
 * available). Region is explicit because the default lookup can be
 * platform-dependent.
 *
 * PRODUCTION CONSIDERATIONS:
 *
 * - The S3Client is created ONCE in the constructor, not per-request.
 *   This is correct for serverless because the instance lives for
 *   exactly one invocation and connection pooling within that
 *   invocation is valuable. If this code were long-lived (e.g., a
 *   traditional Node server), a shared client would still be fine —
 *   S3Client is thread-safe and connection-pooled internally.
 *
 * - Errors from AWS SDK v3 carry a `.name` property like "NoSuchKey"
 *   (for GetObject) or "NotFound" (for HeadObject). We match on these
 *   to distinguish "this object doesn't exist" from "something is
 *   actually broken." The former returns null/false; the latter
 *   re-throws so the caller surfaces a typed error.
 *
 * - CORS must be configured on the bucket for browser GET requests
 *   to pre-signed URLs. See the README "AWS Setup" section for the
 *   CORS policy we recommend.
 *
 * - This module does NOT set CacheControl headers on PutObject.
 *   A production version should set `CacheControl: "private, max-age=86400"`
 *   (matching the URL expiry) so browsers can cache the image for the
 *   lifetime of its pre-signed URL. Omitted here for POC simplicity.
 *
 * See `docs/architecture/deployment.md` for the bucket structure,
 * IAM policy, and CORS config.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "../pipeline/types";

/**
 * Pre-signed URL expiry in seconds. 24 hours matches
 * `docs/architecture/deployment.md` and the "read access valid for
 * one active session" UX expectation.
 */
const URL_EXPIRY_SECONDS = 60 * 60 * 24;

export class S3Storage implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly region: string
  ) {
    // Credentials auto-resolved from env: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
    // (or IAM instance profile in EC2/ECS, ~/.aws/credentials locally, etc.)
    this.client = new S3Client({ region });
  }

  /**
   * Upload an object to S3 under the given key.
   *
   * The return value (the S3 key echoed back) is a cosmetic identifier
   * — current callers (outputOrganizer) ignore it and call `getUrl()`
   * separately when they need a displayable URL. The interface
   * mandates a string return, so we return the key.
   */
  async save(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return key;
  }

  /**
   * Check whether an object exists at the given key.
   *
   * Uses HeadObject (metadata-only request) — cheaper than GetObject
   * when we only care about existence. AWS SDK throws an error with
   * `.name === "NotFound"` for missing objects; we catch that and
   * return false. Other errors (permissions, throttling) propagate.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch (error) {
      if (isAwsNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Generate a pre-signed GET URL for the given key.
   *
   * 24-hour expiry per `URL_EXPIRY_SECONDS`. The URL includes the
   * signature in the query string — it is safe to share to the
   * browser because possession of the URL is all that's needed to
   * GET the object for its expiry window. The bucket remains private.
   *
   * Note: this does NOT verify the object exists. A pre-signed URL
   * for a nonexistent key will return a 403 Forbidden (NOT 404) when
   * fetched — AWS does not leak existence info via pre-signed URLs.
   * Callers that need a "does this creative exist" check should use
   * `exists()` explicitly.
   */
  async getUrl(key: string): Promise<string> {
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: URL_EXPIRY_SECONDS }
    );
  }

  /**
   * Download an object from S3 as a Buffer.
   *
   * Returns null if the object doesn't exist (matching LocalStorage
   * behavior). Other errors (permissions, network) propagate.
   *
   * The SDK v3 returns a streaming body — `transformToByteArray()`
   * is the idiomatic way to fully buffer it into memory. For very
   * large objects this would be wasteful, but creative images here
   * are bounded at ~5 MB per DALL-E response so fully buffering is
   * fine.
   */
  async load(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      if (!response.Body) {
        return null;
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (isAwsNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Detect "this S3 object does not exist" errors from the AWS SDK v3.
 *
 * The SDK raises different error names depending on which operation
 * hit the missing object:
 * - `HeadObject` throws `NotFound`
 * - `GetObject` throws `NoSuchKey`
 * Both have a 404 HTTP status code.
 *
 * We match on the name rather than the status code because the SDK's
 * error shape has evolved across major versions and `error.name` is
 * the most stable surface across v3 minor versions. The type guard
 * uses `unknown` → narrowed `{ name: string }` because the SDK does
 * not export a clean error-class hierarchy we could `instanceof`
 * against.
 */
function isAwsNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "NotFound" || name === "NoSuchKey") {
    return true;
  }
  // Belt-and-suspenders: also check the HTTP status if available
  const httpStatus = candidate.$metadata?.httpStatusCode;
  return httpStatus === 404;
}
