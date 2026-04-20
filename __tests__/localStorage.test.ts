/**
 * LocalStorage seed-dir fallback — asset reuse demo support.
 *
 * Primary writes still go to baseDir; reads fall through to read-only
 * seed dirs when the primary misses. This lets committed seed assets
 * (produced by scripts/seed-from-output.ts, living under
 * ./examples/seed-assets/) drive the pipeline's reuse branch on a
 * fresh clone without needing a prior pipeline run to populate output/.
 *
 * See lib/storage/localStorage.ts for the contract.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalStorage } from "@/lib/storage/localStorage";

describe("LocalStorage — seed-dir fallback", () => {
  let tmpRoot: string;
  let primaryDir: string;
  let seedDirA: string;
  let seedDirB: string;

  beforeEach(async () => {
    // Each test gets its own tmp root so parallel runs and failed
    // tests leave no shared state behind.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "adspark-localstorage-"));
    primaryDir = path.join(tmpRoot, "primary");
    seedDirA = path.join(tmpRoot, "seed-a");
    seedDirB = path.join(tmpRoot, "seed-b");
    await fs.mkdir(primaryDir, { recursive: true });
    await fs.mkdir(seedDirA, { recursive: true });
    await fs.mkdir(seedDirB, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  // --- primary hit path ------------------------------------------------

  it("exists() returns true when key is present under primary baseDir", async () => {
    await fs.writeFile(path.join(primaryDir, "hello.bin"), Buffer.from("hi"));
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA]);
    expect(await storage.exists("hello.bin")).toBe(true);
  });

  it("load() returns primary content when key exists under baseDir, even if a seed dir also has a file at that key", async () => {
    // Shadowing test: if BOTH primary and a seed dir have the same key,
    // primary wins. This preserves the rule that writes are authoritative
    // — the pipeline can overwrite a seed asset's "slot" with a real
    // generation and subsequent loads return the pipeline's output.
    await fs.writeFile(path.join(primaryDir, "k.bin"), Buffer.from("from-primary"));
    await fs.writeFile(path.join(seedDirA, "k.bin"), Buffer.from("from-seed"));
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA]);
    const buf = await storage.load("k.bin");
    expect(buf?.toString("utf-8")).toBe("from-primary");
  });

  // --- seed fallback path ---------------------------------------------

  it("exists() returns true when key is only present in a seed dir", async () => {
    await fs.writeFile(path.join(seedDirA, "only-in-seed.bin"), Buffer.from("seed"));
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA]);
    expect(await storage.exists("only-in-seed.bin")).toBe(true);
  });

  it("load() returns the seed buffer when key is only present in a seed dir", async () => {
    await fs.writeFile(
      path.join(seedDirA, "only-in-seed.bin"),
      Buffer.from("seed-content")
    );
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA]);
    const buf = await storage.load("only-in-seed.bin");
    expect(buf?.toString("utf-8")).toBe("seed-content");
  });

  it("load() searches multiple seed dirs in order and returns the first hit", async () => {
    // Key exists in seedDirB only — primary AND seedDirA miss.
    await fs.writeFile(path.join(seedDirB, "deep.bin"), Buffer.from("from-b"));
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    const buf = await storage.load("deep.bin");
    expect(buf?.toString("utf-8")).toBe("from-b");
  });

  it("load() returns the earliest seed dir's copy when multiple seeds shadow the same key", async () => {
    // Both seeds have a file at the same key; the constructor order
    // (seedDirA before seedDirB) determines which wins.
    await fs.writeFile(path.join(seedDirA, "k.bin"), Buffer.from("from-a"));
    await fs.writeFile(path.join(seedDirB, "k.bin"), Buffer.from("from-b"));
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    const buf = await storage.load("k.bin");
    expect(buf?.toString("utf-8")).toBe("from-a");
  });

  // --- miss path -------------------------------------------------------

  it("exists() returns false when key is absent from primary and all seed dirs", async () => {
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    expect(await storage.exists("nope.bin")).toBe(false);
  });

  it("load() returns null when key is absent from primary and all seed dirs", async () => {
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    expect(await storage.load("nope.bin")).toBeNull();
  });

  // --- writes stay in primary -----------------------------------------

  it("save() writes to primary baseDir and never touches seed dirs", async () => {
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    await storage.save("new.bin", Buffer.from("written"), "application/octet-stream");

    // Present under primary.
    const primaryBuf = await fs.readFile(path.join(primaryDir, "new.bin"));
    expect(primaryBuf.toString("utf-8")).toBe("written");

    // Absent from every seed dir — writes are authoritative to primary only.
    await expect(fs.access(path.join(seedDirA, "new.bin"))).rejects.toThrow();
    await expect(fs.access(path.join(seedDirB, "new.bin"))).rejects.toThrow();
  });

  // --- backward compatibility -----------------------------------------

  it("omitting readOnlySeedDirs preserves the original primary-only behavior", async () => {
    // No third constructor arg — behaves exactly like pre-seed-dir code.
    // Important so existing tests that mount LocalStorage directly with
    // two args don't change behavior.
    await fs.writeFile(path.join(seedDirA, "shouldNotBeVisible.bin"), Buffer.from("x"));
    const storage = new LocalStorage(primaryDir, "/api/files");
    expect(await storage.exists("shouldNotBeVisible.bin")).toBe(false);
    expect(await storage.load("shouldNotBeVisible.bin")).toBeNull();
  });

  // --- traversal guard -------------------------------------------------

  it("rejects path-traversal keys without leaking through the seed-dir loop", async () => {
    // A malicious key is rejected by each base's own traversal guard.
    // The fallback loop catches the throw per-base and continues, so a
    // path that escapes one base cannot accidentally succeed on another.
    // Net result for a fully-escaping key: false / null, never a match.
    const storage = new LocalStorage(primaryDir, "/api/files", [seedDirA, seedDirB]);
    expect(await storage.exists("../../etc/passwd")).toBe(false);
    expect(await storage.load("../../etc/passwd")).toBeNull();
  });
});
