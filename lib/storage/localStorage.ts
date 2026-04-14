/**
 * Local Storage — Filesystem-based storage for local development.
 *
 * Implements the StorageProvider interface using the local filesystem.
 * This is the default when STORAGE_MODE is unset or "local" — lets
 * reviewers run the app with zero cloud credentials.
 *
 * READ-ONLY SEED DIRS (asset reuse demo):
 *
 * The assignment requires the pipeline to "reuse input assets when
 * available". `assetResolver.resolveOne()` checks `storage.exists(key)`
 * and `storage.load(key)` — so we can demonstrate asset reuse on a
 * fresh clone IF those methods can find a file that was committed to
 * the repo rather than written by the pipeline.
 *
 * `readOnlySeedDirs` gives LocalStorage exactly that: a list of
 * additional base directories to check AFTER the primary `baseDir`
 * misses. Writes still go ONLY to `baseDir` (the primary) — the seed
 * dirs are a pure read-through fallback. Each seed dir gets its own
 * path-traversal guard so a malicious key can't escape any of them.
 *
 * The factory in `lib/storage/index.ts` passes `./examples/seed-assets`
 * as the default seed directory in local mode. See
 * `scripts/seed-from-output.ts` for how seed assets are produced, and
 * `examples/campaigns/coastal-sun-protection/` for the showcase brief
 * that exercises the reuse branch end-to-end.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider } from "../pipeline/types";

export class LocalStorage implements StorageProvider {
  private readonly resolvedBase: string;
  private readonly resolvedSeedBases: readonly string[];

  constructor(
    private readonly baseDir: string,
    private readonly urlBase: string = "/api/files",
    readOnlySeedDirs: readonly string[] = []
  ) {
    this.resolvedBase = path.resolve(baseDir);
    // Pre-resolve every seed dir once so per-request reads don't repeat
    // the path.resolve work. Each seed gets its own absolute base; the
    // per-dir traversal guard in `safePathAgainst` uses its own base.
    this.resolvedSeedBases = readOnlySeedDirs.map((dir) => path.resolve(dir));
  }

  /**
   * Resolve a key to a safe filesystem path within baseDir (write target).
   * Prevents path traversal attacks (e.g., key = "../../etc/passwd").
   */
  private safePath(key: string): string {
    return this.safePathAgainst(this.resolvedBase, key);
  }

  /**
   * Resolve a key to a safe filesystem path within an arbitrary base
   * directory. Used by the seed-dir fallback so each read-only base
   * gets its own traversal guard — a key that escapes one base is
   * rejected for that base but may still resolve cleanly for another
   * (which is fine; the guard only ensures no base is escaped).
   */
  private safePathAgainst(base: string, key: string): string {
    const resolved = path.resolve(base, key);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(`Path traversal attempt detected: ${key}`);
    }
    return resolved;
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    // Writes ALWAYS go to the primary baseDir — seed dirs are read-only
    // by contract. If a caller ever wants to write a seed, they must
    // promote it explicitly via scripts/seed-from-output.ts (or similar).
    const filePath = this.safePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async exists(key: string): Promise<boolean> {
    // Primary check — the common case. Most keys are written by the
    // pipeline and live under baseDir, so this short-circuits cleanly.
    try {
      await fs.access(this.safePath(key));
      return true;
    } catch {
      // not present under primary — fall through to seed dirs
    }

    // Seed-dir fallback. Each dir gets its own traversal guard via
    // safePathAgainst. A path-traversal throw on one seed doesn't
    // abort the search — we catch it and keep looking so a stray
    // `..`-bearing key on one base doesn't accidentally succeed on
    // another with a different ancestor structure.
    for (const seedBase of this.resolvedSeedBases) {
      try {
        await fs.access(this.safePathAgainst(seedBase, key));
        return true;
      } catch {
        // not present in this seed dir — try the next
      }
    }
    return false;
  }

  async getUrl(key: string): Promise<string> {
    // URL generation is unchanged — every reachable key maps to
    // `/api/files/<key>`. In practice, the seed-dir fallback is used
    // by `assetResolver.resolveOne()` which calls `exists()` + `load()`
    // but NOT `getUrl()` (the seed asset is never served directly; it's
    // composited and saved to baseDir as a fresh creative, then the
    // browser fetches the composited creative via /api/files/<new-key>).
    // If a future caller ever needs a seed-dir URL, this will need a
    // corresponding route under /api/files/ that can read from seed dirs.
    return `${this.urlBase}/${encodeURIComponent(key)}`;
  }

  async load(key: string): Promise<Buffer | null> {
    // Primary check — see exists() rationale.
    try {
      return await fs.readFile(this.safePath(key));
    } catch {
      // not present under primary — fall through to seed dirs
    }

    // Seed-dir fallback. Returns the FIRST hit; later seeds are not
    // consulted. Order matters: pass more-specific seed dirs first in
    // the constructor if you ever have overlapping key spaces.
    for (const seedBase of this.resolvedSeedBases) {
      try {
        return await fs.readFile(this.safePathAgainst(seedBase, key));
      } catch {
        // not present in this seed dir — try the next
      }
    }
    return null;
  }
}
