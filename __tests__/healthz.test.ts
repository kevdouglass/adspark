/**
 * /api/healthz — contract tests for the container health probe.
 *
 * Locks in the fields that reverse-proxy configuration depends on:
 *   - recommendedProxyTimeoutMs exists and is >= clientTimeoutMs
 *   - clientTimeoutMs > pipelineBudgetMs (stagger invariant)
 *   - storageMode is normalized to "local" | "s3"
 *   - 503 is returned while shutting down, 200 while healthy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/healthz/route";
import {
  getHealth,
  getStorageMode,
  markShuttingDown,
  isShuttingDown,
} from "@/lib/api/services";
import {
  PIPELINE_BUDGET_MS,
  CLIENT_REQUEST_TIMEOUT_MS,
} from "@/lib/api/timeouts";

// The shutdown flag is module-level and can't be reset cleanly from
// outside. We only call markShuttingDown() in the very last test so
// it doesn't affect the others.

describe("getHealth contract", () => {
  const originalStorageMode = process.env.STORAGE_MODE;
  const originalAppVersion = process.env.APP_VERSION;

  beforeEach(() => {
    process.env.STORAGE_MODE = "local";
    process.env.APP_VERSION = "test-1.2.3";
  });

  afterEach(() => {
    if (originalStorageMode === undefined) {
      delete process.env.STORAGE_MODE;
    } else {
      process.env.STORAGE_MODE = originalStorageMode;
    }
    if (originalAppVersion === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalAppVersion;
    }
  });

  it("reports the canonical timeout cascade matching lib/api/timeouts.ts", () => {
    const health = getHealth();
    expect(health.pipelineBudgetMs).toBe(PIPELINE_BUDGET_MS);
    expect(health.clientTimeoutMs).toBe(CLIENT_REQUEST_TIMEOUT_MS);
  });

  it("recommendedProxyTimeoutMs is >= clientTimeoutMs (stagger invariant)", () => {
    const health = getHealth();
    expect(health.recommendedProxyTimeoutMs).toBeGreaterThanOrEqual(
      health.clientTimeoutMs
    );
  });

  it("clientTimeoutMs is strictly greater than pipelineBudgetMs", () => {
    // This is the container-level mirror of the Vercel stagger
    // invariant: the SERVER budget must fire before the CLIENT gives up.
    const health = getHealth();
    expect(health.clientTimeoutMs).toBeGreaterThan(health.pipelineBudgetMs);
  });

  it("reports version from APP_VERSION env var", () => {
    const health = getHealth();
    expect(health.version).toBe("test-1.2.3");
  });

  it("reports storageMode=local when STORAGE_MODE is unset", () => {
    delete process.env.STORAGE_MODE;
    const health = getHealth();
    expect(health.storageMode).toBe("local");
  });

  it("normalizes STORAGE_MODE with trimming + lowercasing", () => {
    process.env.STORAGE_MODE = "  S3  ";
    expect(getStorageMode()).toBe("s3");
    process.env.STORAGE_MODE = "Local";
    expect(getStorageMode()).toBe("local");
    process.env.STORAGE_MODE = "garbage";
    // Fail-open to local on unrecognized values
    expect(getStorageMode()).toBe("local");
  });
});

describe("GET /api/healthz route", () => {
  it("returns 200 with the full HealthReport payload when healthy", async () => {
    // We cannot reliably test this AFTER the shutdown test runs in the
    // same file because markShuttingDown is one-way. Run this first.
    if (isShuttingDown()) {
      // Skip if another test already flipped the flag
      return;
    }
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      shuttingDown: false,
      pipelineBudgetMs: PIPELINE_BUDGET_MS,
      clientTimeoutMs: CLIENT_REQUEST_TIMEOUT_MS,
    });
    // Verify recommendedProxyTimeoutMs is present and numeric
    expect(typeof body.recommendedProxyTimeoutMs).toBe("number");
  });

  it("uses no-store Cache-Control so shutdown transitions propagate", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("no-store");
  });

  // This test MUST run last because markShuttingDown is one-way.
  // Vitest runs tests in declaration order within a describe by default.
  it("returns 503 and ok=false after markShuttingDown() is called", async () => {
    markShuttingDown();
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.shuttingDown).toBe(true);
  });
});
