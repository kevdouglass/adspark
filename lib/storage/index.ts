/**
 * Storage Factory — Returns the appropriate storage provider based on config.
 *
 * Accepts an injectable config (for testing) with an env-sourced default
 * (for production). This design makes the factory testable without
 * manipulating process.env and portable to non-Node runtimes.
 */

import type { StorageProvider } from "../pipeline/types";
import { LocalStorage } from "./localStorage";
import { S3Storage } from "./s3Storage";

export interface StorageConfig {
  mode: "s3" | "local";
  s3Bucket?: string;
  s3Region?: string;
  localOutputDir?: string;
  localUrlBase?: string;
}

export function createStorage(config: StorageConfig = readEnvConfig()): StorageProvider {
  if (config.mode === "s3") {
    if (!config.s3Bucket) {
      throw new Error(
        "s3Bucket is required when mode is 's3' (set S3_BUCKET env var)"
      );
    }
    return new S3Storage(config.s3Bucket, config.s3Region ?? "us-east-1");
  }

  return new LocalStorage(
    config.localOutputDir ?? "./output",
    config.localUrlBase ?? "/api/files"
  );
}

const VALID_STORAGE_MODES = ["s3", "local"] as const;

function readEnvConfig(): StorageConfig {
  const rawMode = process.env.STORAGE_MODE ?? "local";
  const mode = VALID_STORAGE_MODES.includes(rawMode as StorageConfig["mode"])
    ? (rawMode as StorageConfig["mode"])
    : (() => { throw new Error(`Invalid STORAGE_MODE: "${rawMode}". Must be one of: ${VALID_STORAGE_MODES.join(", ")}`); })();

  return {
    mode,
    s3Bucket: process.env.S3_BUCKET,
    s3Region: process.env.S3_REGION ?? "us-east-1",
    localOutputDir: process.env.LOCAL_OUTPUT_DIR ?? "./output",
    localUrlBase: process.env.LOCAL_URL_BASE ?? "/api/files",
  };
}
