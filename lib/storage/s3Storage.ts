/**
 * S3 Storage — AWS S3-based storage for production deployment.
 *
 * Implements the StorageProvider interface using AWS S3.
 * Uses pre-signed URLs so the frontend never holds AWS credentials.
 *
 * See docs/architecture/deployment.md for S3 bucket structure and access patterns.
 */

import type { StorageProvider } from "../pipeline/types";

// Placeholder — implementation in Checkpoint 2
// This will use @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner

export class S3Storage implements StorageProvider {
  constructor(
    private readonly _bucket: string,
    private readonly _region: string
  ) {}

  async save(_key: string, _data: Buffer, _contentType: string): Promise<string> {
    // TODO: PutObjectCommand
    throw new Error("Not implemented — Checkpoint 2");
  }

  async exists(_key: string): Promise<boolean> {
    // TODO: HeadObjectCommand
    throw new Error("Not implemented — Checkpoint 2");
  }

  async getUrl(_key: string): Promise<string> {
    // TODO: getSignedUrl with GetObjectCommand
    throw new Error("Not implemented — Checkpoint 2");
  }

  async load(_key: string): Promise<Buffer | null> {
    // TODO: GetObjectCommand
    throw new Error("Not implemented — Checkpoint 2");
  }
}
