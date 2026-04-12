/**
 * Local Storage — Filesystem-based storage for local development.
 *
 * Implements the StorageProvider interface using the local filesystem.
 * This is the default when STORAGE_MODE is unset or "local" — lets
 * reviewers run the app with zero cloud credentials.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider } from "../pipeline/types";

export class LocalStorage implements StorageProvider {
  private readonly resolvedBase: string;

  constructor(
    private readonly baseDir: string,
    private readonly urlBase: string = "/api/files"
  ) {
    this.resolvedBase = path.resolve(baseDir);
  }

  /**
   * Resolve a key to a safe filesystem path within baseDir.
   * Prevents path traversal attacks (e.g., key = "../../etc/passwd").
   */
  private safePath(key: string): string {
    const resolved = path.resolve(this.resolvedBase, key);
    if (!resolved.startsWith(this.resolvedBase + path.sep) && resolved !== this.resolvedBase) {
      throw new Error(`Path traversal attempt detected: ${key}`);
    }
    return resolved;
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = this.safePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.safePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string> {
    return `${this.urlBase}/${encodeURIComponent(key)}`;
  }

  async load(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.safePath(key));
    } catch {
      return null;
    }
  }
}
