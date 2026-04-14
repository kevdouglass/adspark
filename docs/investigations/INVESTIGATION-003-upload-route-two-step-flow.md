# INVESTIGATION-003 — Upload Route Stub → Two-Step Flow: Audit & Implementation Plan

| | |
|---|---|
| **Status** | 📋 Complete — audit + plan drafted, implementation pending owner approval |
| **Owner** | Kevin Douglass |
| **Created** | 2026-04-14 |
| **Investigation duration** | ~45 minutes (external review read + codebase audit + adjustment list + plan draft) |
| **Severity** | 🟡 Medium — no production incident; this is a planning investigation driven by a gap identified against the Adobe take-home "Data Sources" requirement |
| **Root cause** | `app/api/upload/route.ts` was scaffolded as a stub at project init (ADS-013 placeholder) and never implemented. The real S3 pre-signed URL work slipped to post-MVP. BriefForm's `existingAsset` field was correspondingly registered as a hidden input pending the upload route |
| **Resolution path** | Replace the stub with a two-step init + PUT flow, adapted from an external review against AdSpark's existing conventions (`RequestContext`, structured logging, `StorageProvider` abstraction, `buildApiError` envelope, magic-byte validation, byte-stream body cap) |
| **Related** | [SPIKE-003 — Asset upload flow (parent ticket)](../spikes/SPIKE-003-asset-upload-flow.md), [SPIKE-002 — Pipeline latency audit](../spikes/SPIKE-002-pipeline-latency-audit.md), [INVESTIGATION-001 — Vercel S3 signature mismatch](INVESTIGATION-001-vercel-s3-signature-mismatch.md), external review files: `c:\Users\dougi\Downloads\adspark-upload-route.patch`, `c:\Users\dougi\Downloads\route.ts.fixed`, [`lib/pipeline/assetResolver.ts`](../../lib/pipeline/assetResolver.ts), [`lib/storage/localStorage.ts`](../../lib/storage/localStorage.ts), [`lib/storage/s3Storage.ts`](../../lib/storage/s3Storage.ts), [`lib/api/errors.ts`](../../lib/api/errors.ts), [`lib/api/services.ts`](../../lib/api/services.ts) |

---

## 🎯 Investigation Scope

Build a concrete, file-by-file implementation plan for adding a manual asset upload flow to AdSpark, based on:

1. The external reviewer's proposed `route.ts.fixed` patched file (two-step init + PUT flow, local + S3 parity via signed URLs)
2. A fresh deep audit of every current AdSpark file the upload flow would touch
3. Gap analysis: where the external patch deviates from AdSpark conventions and needs adjustment before landing
4. A test plan that gates "the reuse code path fires for uploaded assets" as the primary acceptance criterion

The **strategic questions** — do we ship this? local-only or local+S3? when? — are in [SPIKE-003](../spikes/SPIKE-003-asset-upload-flow.md). This document is the **tactical plan** the spike attaches to.

---

## 📋 The external reviewer's position (recorded for provenance)

A reviewer read the AdSpark storage layer + missing upload route and concluded:

> I reviewed the storage layer and the missing upload route. The core problem is:
>
> - your `StorageProvider` abstraction is already good
> - `S3Storage` already supports save/load/exists/getUrl
> - but `/api/upload` is still a stub, so the frontend has **no way** to:
>   - get a signed upload target for S3
>   - or upload bytes to local storage in dev mode

The reviewer's proposed fix (full file: `c:\Users\dougi\Downloads\route.ts.fixed`) implements a **two-step flow** with parity across storage modes:

### In `STORAGE_MODE=s3`
**Step 1:** `POST /api/upload` with JSON `{filename, contentType, campaignId}` — server validates, builds a safe key, and returns a pre-signed S3 `PUT` URL.
**Step 2:** Browser does `PUT <signed-url>` with the file body. Bytes go **directly to S3**, bypassing the Next.js function entirely.

### In `STORAGE_MODE=local`
**Step 1:** `POST /api/upload` with the same JSON body — server returns a URL pointing back to the same route with a `?key=...` query param.
**Step 2:** Browser does `PUT /api/upload?key=<key>` with the file body — server writes via `fs.writeFile` (the patch does this directly; see §Adjustment 1 below).

### Critical correctness point
The reviewer emphasized:

> A very common mistake is this:
> ```ts
> product.existingAsset = uploadInit.uploadUrl;
> ```
> That would be wrong for your pipeline. Why:
> - signed URLs expire
> - `assetResolver` expects a storage key
> - not a temporary URL
>
> Use the returned `key`.

This matches AdSpark's `assetResolver.resolveOne` contract (audited below): it calls `storage.exists(product.existingAsset)` + `storage.load(product.existingAsset)`, both of which expect a storage KEY, not a URL.

---

## 🔍 Deep audit — every current file the upload flow touches

### A. `app/api/upload/route.ts` — the stub (to be replaced)

```ts
// Current implementation — 17 lines total
import { NextResponse } from "next/server";

export async function POST(_request: Request) {
  // TODO: Checkpoint 2 — pre-signed S3 URL generation
  return NextResponse.json(
    { error: "Not implemented — Checkpoint 2" },
    { status: 501 }
  );
}
```

**Observations:**
- Returns a non-standard error shape (`{error: string}`, not the `ApiError` envelope the rest of the codebase uses).
- No `RequestContext` / no structured logging / no request correlation.
- Doesn't participate in the `buildApiError` + `ApiErrorCode` contract enforced by all other routes.
- README advertises this route as working; reality is 501.

### B. `lib/storage/localStorage.ts` — the write target in local mode

```ts
// Relevant methods (post-Block B)
async save(key: string, data: Buffer, _contentType: string): Promise<string> {
  const filePath = this.safePath(key);  // traversal guard
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return filePath;
}

async exists(key: string): Promise<boolean> { ... }  // primary + seed-dir fallback
async load(key: string): Promise<Buffer | null> { ... }  // primary + seed-dir fallback
```

**Observations:**
- **`save()` already exists** and already writes with path-traversal protection. The external patch bypasses this and calls `fs.writeFile` directly — that's a duplication we should remove (Adjustment 1).
- `save()` accepts `contentType` but currently ignores it (hence the `_contentType` parameter name). That's fine for local mode; S3Storage.save() uses it.
- The Block B seed-dir fallback does NOT apply here — uploads go to the PRIMARY `baseDir` (`./output/`), not a seed dir, so seed-dir resolution is a no-op for uploaded keys.

### C. `lib/storage/s3Storage.ts` — existing S3 implementation

```ts
// Current save method — uses PutObjectCommand, accepts ContentType
async save(key: string, data: Buffer, contentType: string): Promise<string> {
  await this.client.send(
    new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType })
  );
  return key;
}

// No explicit "getSignedUploadUrl" method exists
async getUrl(key: string): Promise<string> { ... }  // GET URL, 24 hr expiry
```

**Observations:**
- **There is NO `getSignedUploadUrl` method on `S3Storage` today.** `getUrl()` mints GET URLs with a 24-hour expiry. For upload parity we need a new method OR we call `getSignedUrl(PutObjectCommand, ...)` inline in the route handler. The external patch does the latter.
- **Cleaner option:** add `getSignedUploadUrl(key, contentType, expiresIn)` to the `StorageProvider` interface, implement it on both `LocalStorage` (returns the `${origin}/api/upload?key=...` URL pattern) and `S3Storage` (returns the real signed URL). This keeps the route handler mode-agnostic. See Adjustment 5 below.

### D. `lib/storage/index.ts` — the factory

```ts
// Post-Block B signature
export interface StorageConfig {
  mode: "s3" | "local";
  s3Bucket?: string;
  s3Region?: string;
  localOutputDir?: string;
  localUrlBase?: string;
  localSeedDirs?: readonly string[];  // added in Block B
}

export function createStorage(config: StorageConfig = readEnvConfig()): StorageProvider { ... }
```

**Observations:**
- `getStorage()` in `lib/api/services.ts` delegates here.
- The factory is fully injectable via config, which means tests can pass a custom `StorageProvider` mock. Good.

### E. `lib/pipeline/assetResolver.ts` — the consumer of uploaded keys

```ts
// This is the function that fires the reuse branch
async function resolveOne(product: Product, storage: StorageProvider): Promise<AssetResolution> {
  if (product.existingAsset) {
    const exists = await storage.exists(product.existingAsset);  // ← called with the uploaded key
    if (exists) {
      const buffer = await storage.load(product.existingAsset);  // ← loads the uploaded buffer
      if (buffer !== null) {
        return {
          product,
          hasExistingAsset: true,
          existingAssetBuffer: buffer,
          needsGeneration: false,
        };
      }
    }
  }
  return { product, hasExistingAsset: false, existingAssetBuffer: null, needsGeneration: true };
}
```

**Observations:**
- **`existingAsset` is used as a storage KEY, not a URL.** The external reviewer's warning lands exactly here: if the frontend saved the signed URL instead of the key, `storage.exists(<signed-url>)` would `path.resolve` the URL under `baseDir` and either throw a traversal error or return false, and the reuse branch would silently NOT fire — the pipeline would call DALL-E anyway.
- **So the frontend MUST call `setValue('products.${i}.existingAsset', uploadResult.key)`, not `uploadResult.uploadUrl`.** This is the #1 thing to get right.
- The resolver already correctly handles per-product error isolation (`Promise.allSettled` fallback to "needs generation"), so a storage.exists failure on one product doesn't break the batch.

### F. `lib/pipeline/briefParser.ts` — the Zod schema for `existingAsset`

```ts
// Relevant schema fragment
const productSchema = z.object({
  // ...
  existingAsset: z.string().nullable(),
});
```

**Observations:**
- `existingAsset` accepts `string` or `null`. No format constraint beyond "string" — no regex, no max length.
- **Gap:** a malicious brief could set `existingAsset: "../../etc/passwd"` and rely on `LocalStorage.safePath` to catch it. The safe-path guard DOES catch it — verified in `__tests__/localStorage.test.ts:traversal guard` (added in Block B). So this is not a live vulnerability, but we SHOULD tighten the Zod schema to reject obviously invalid patterns (empty strings after trim, path separators, trailing slashes) — see Adjustment 6.

### G. `components/BriefForm.tsx` — the current hidden field

```tsx
// Line 805-810
{/* existingAsset is part of the schema but hidden in the UI —
    ADS-013 (pre-signed S3 uploads) will add the real upload control */}
<input
  type="hidden"
  {...register(`products.${index}.existingAsset`)}
/>
```

**Observations:**
- The field is ALREADY registered with `react-hook-form`. When the user submits, its value (currently always `null` because there's no control to set it) flows into `GenerateRequestBody` unchanged.
- `setValue('products.${i}.existingAsset', key, { shouldDirty: true })` from react-hook-form is the idiomatic way to write to a registered field programmatically. We'll need that in the upload handler.
- **No new form state needed** for the upload control itself — the upload progress (pending/error) is UI state, not form state, and belongs in `useState` inside the component.
- The file picker has to be rendered PER PRODUCT because each product has its own `existingAsset`. Field array index is already available (`index` in the map loop).

### H. `lib/api/errors.ts` — the `ApiError` envelope

```ts
export type ApiErrorCode =
  | "INVALID_JSON"
  | "INVALID_BRIEF"
  | "REQUEST_TOO_LARGE"
  | "CONTENT_POLICY_VIOLATION"
  | "NOT_FOUND"
  | "MISSING_CONFIGURATION"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "STORAGE_ERROR"
  | "PROCESSING_ERROR"
  | "INTERNAL_ERROR"
  | "CLIENT_NETWORK_ERROR"
  | "CLIENT_TIMEOUT"
  | "CLIENT_ABORTED";

export function buildApiError(code, message, requestId, details?): ApiError { ... }
```

**Observations:**
- The external patch uses codes that ALL exist: `MISSING_CONFIGURATION`, `INVALID_JSON`, `INVALID_BRIEF`, `UPSTREAM_ERROR`, `NOT_FOUND`, `REQUEST_TOO_LARGE`, `INTERNAL_ERROR`, `STORAGE_ERROR`. No new code additions needed. ✅
- **No existing `readBinaryBodyWithLimit` helper.** The text version in `app/api/generate/route.ts` (`readBodyWithLimit`) does stream-level byte counting but returns UTF-8 decoded text. We need a Buffer-returning sibling for uploads — see Adjustment 2.
- `KNOWN_API_ERROR_CODES` runtime set must be kept in sync (automatic for our case since we're not adding codes).

### I. `lib/api/services.ts` — `RequestContext` + `getStorage` + `validateRequiredEnv`

```ts
export function createRequestContext(): RequestContext { ... }  // requestId + ctx.log
export function getStorage(): StorageProvider { ... }
export function validateRequiredEnv(): void { ... }  // fails fast on missing OPENAI_API_KEY + S3_BUCKET
```

**Observations:**
- The external patch does NOT use `createRequestContext()` — it rolls its own `getRequestId("upload-init")` helper. That's a break from AdSpark's one-requestId-pattern. See Adjustment 3.
- The external patch does NOT use `ctx.log()` — it uses ad-hoc `console.error`. Break from structured-JSON logging. See Adjustment 3.
- The external patch does NOT call `validateRequiredEnv()` — it rolls its own `assertUploadConfig` that only checks `S3_BUCKET` when `STORAGE_MODE=s3`. This is actually **correct** for uploads specifically (upload doesn't need `OPENAI_API_KEY`) but it duplicates the env-check surface. A small helper `validateUploadEnv()` in `lib/api/services.ts` is the right move. See Adjustment 4.

### J. `lib/api/client.ts` — the frontend HTTP layer

```ts
// Current surface
export const DEFAULT_GENERATE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;
// ... postJson helper + generateCreatives() only
```

**Observations:**
- No `uploadAsset()` method exists. Needs to be added — see §File-by-file implementation plan below.
- The existing `postJson<TSuccess>()` helper handles JSON-body POST requests and returns a `Result` union. It can be reused as-is for **step 1** (the init call). For **step 2** (the binary PUT) we need a new helper because the body is a `File`, not JSON.

### K. `lib/api/types.ts` — shared wire types

```ts
// Post-Block C shape
export interface ApiCreativeOutput { ... sourceType: CreativeSourceType }
export interface GenerateSuccessResponseBody {
  ...
  summary: RunSummary;
}
```

**Observations:**
- No `UploadInitRequestBody` / `UploadInitResponseBody` yet. Needs adding. See §File-by-file plan.
- Per ADR-006, these should be **explicit parallel shapes** with mappers if they ever cross the domain-API boundary. For now they're API-only shapes (upload is a thin API concern; no domain projection needed) so plain interfaces in `lib/api/types.ts` are appropriate.

### L. `app/api/files/[...path]/route.ts` — the local file-serving route

```ts
// Relevant constraints
const ALLOWED_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg", ".json"]);
const STRICT_BASENAME_RE = /^[a-zA-Z0-9_-]+\.(png|webp|jpe?g|json)$/i;
function getLocalRoot(): string { return path.resolve(process.env.LOCAL_OUTPUT_DIR ?? "./output"); }
```

**Observations:**
- The files route serves from `$LOCAL_OUTPUT_DIR` — same base as where the upload PUT writes. ✅
- `STRICT_BASENAME_RE` requires basenames like `creative.png` or `1729876543-hero.webp`. The upload key pattern from the external patch is `assets/<campaignId>/<timestamp>-<filename>.<ext>` — the *basename* is `<timestamp>-<filename>.<ext>`, which matches the regex (digits + hyphens + alnum + extension). ✅ The files route can serve uploaded assets for preview.
- `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024` — 10 MB. Matches the upload cap in the external patch. ✅

### M. Existing routes for pattern-matching — `app/api/generate/route.ts`

The generate route is the gold standard for AdSpark route conventions. Key patterns to mirror:

1. **`createRequestContext()` first, `ctx.log(LogEvents.RequestReceived, ...)` second.** Every route starts with this.
2. **`validateRequiredEnv()` BEFORE touching the body.** Fail-fast on missing config.
3. **`readBodyWithLimit()` for stream-level byte counting.** Content-Length alone is not enough.
4. **`satisfies ApiError` on every error branch.** Compile-time exhaustiveness.
5. **`NextResponse.json(body, { status })` shape.** Consistent across routes.
6. **`console.error(`[${ctx.requestId}] <description>:`, error)` for server-side error logging alongside `ctx.log`.** Belt and suspenders.
7. **`try { ... } finally { clearTimeout(pipelineBudgetTimer); }`** pattern for cleanup — applies to any routes that set timers.

---

## ⚖️ Gap analysis — external patch vs AdSpark conventions

The external `route.ts.fixed` is directionally correct. The following adjustments align it with AdSpark's existing patterns:

### Adjustment 1 — Use `LocalStorage.save()` instead of direct `fs.writeFile`

**What the patch does:**
```ts
// route.ts.fixed PUT handler
const targetPath = safeLocalPath(key);  // duplicates LocalStorage.safePath
await fs.mkdir(path.dirname(targetPath), { recursive: true });
await fs.writeFile(targetPath, buffer);
```

**Why it's wrong:** duplicates the path-traversal guard that already exists in `LocalStorage.safePathAgainst`, and bypasses the `StorageProvider` abstraction. If a bug is ever introduced in the local path resolution, there are now two places to fix it.

**Fix:** use `getStorage().save(key, buffer, contentType)`. The `StorageProvider.save` contract already handles `mkdir -p` + `writeFile` + path traversal. In S3 mode this would be wrong (S3 uploads bypass the function entirely via pre-signed URL), but in S3 mode we never reach the PUT handler — it returns 404 upfront.

### Adjustment 2 — Add `readBinaryBodyWithLimit` helper; don't use `arrayBuffer()` alone

**What the patch does:**
```ts
// route.ts.fixed PUT handler
const contentLengthHeader = request.headers.get("content-length");
const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
  return NextResponse.json(..., { status: 413 });
}
const bytes = Buffer.from(await request.arrayBuffer());
if (bytes.byteLength > MAX_UPLOAD_BYTES) { return ... 413 ... }
```

**Why it's incomplete:** `request.arrayBuffer()` reads the ENTIRE body into memory before the size check fires. A malicious client can omit Content-Length and stream 10 GB — the server's heap explodes before the post-read check catches it. The existing `readBodyWithLimit` in `/api/generate/route.ts` solves this at the stream level: it reads chunks, counts bytes incrementally, and aborts the reader as soon as the cumulative count exceeds the cap.

**Fix:** add `readBinaryBodyWithLimit(request, maxBytes): Promise<{ok: true, data: Buffer} | {ok: false, reason}>` to `lib/api/errors.ts` as a sibling to `readBodyWithLimit`. Same stream-chunk loop, returns a Buffer instead of a string. Use it in the PUT handler.

### Adjustment 3 — Use `createRequestContext()` + `ctx.log(LogEvents.X)` for observability

**What the patch does:**
```ts
function getRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
// ...
console.error(`[${requestId}] Failed to create S3 upload URL`, error);
```

**Why it's wrong:** every other AdSpark route uses `createRequestContext()` from `lib/api/services.ts`, which mints a plain UUID (no `upload-init-` prefix), binds a structured logger, and emits JSON-line events via `ctx.log(...)`. Using ad-hoc `console.error` fragments the observability surface — a production log viewer filtering on `requestId=abc123` would miss upload events.

**Fix:** replace `getRequestId` + `console.error` with the standard:
```ts
const ctx = createRequestContext();
ctx.log(LogEvents.RequestReceived, { route: "/api/upload", method: "POST" });
// ... on error:
console.error(`[${ctx.requestId}] Failed to create S3 upload URL:`, error);
ctx.log(LogEvents.UploadInitFailed, { mode, cause: error instanceof Error ? error.constructor.name : "unknown" });
```

New log event names to add to `lib/api/logEvents.ts`:
- `UploadInitReceived`
- `UploadInitComplete`
- `UploadInitFailed`
- `UploadPutReceived`
- `UploadPutComplete`
- `UploadPutFailed`

### Adjustment 4 — `validateUploadEnv()` helper in `lib/api/services.ts`

**What the patch does:**
```ts
function assertUploadConfig(mode: "local" | "s3"): void {
  if (mode === "s3" && !process.env.S3_BUCKET) {
    throw new Error("S3_BUCKET is required when STORAGE_MODE=s3");
  }
}
```

**Why it's incomplete:** this is correct for upload specifically (upload doesn't need `OPENAI_API_KEY`), but it lives in the route handler instead of the services module where every other env validator lives. A reviewer grepping for "env var check" would miss this.

**Fix:** add `validateUploadEnv()` to `lib/api/services.ts` alongside `validateRequiredEnv()`. Throws `MissingConfigurationError` on missing `S3_BUCKET` in S3 mode, nothing otherwise.

### Adjustment 5 — (optional) Promote `getSignedUploadUrl` to the `StorageProvider` interface

**What the patch does:**
```ts
// Inline in the S3 branch of the POST handler
const client = createS3Client();
const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
```

**Why it could be cleaner:** the route handler knows about S3 SDK types. That's a leak — the whole point of `StorageProvider` is that callers DON'T know which backend they're talking to.

**Fix (optional, higher-cost):** add a new method to the interface:
```ts
// lib/pipeline/types.ts
export interface StorageProvider {
  save(...): Promise<string>;
  exists(...): Promise<boolean>;
  getUrl(...): Promise<string>;
  load(...): Promise<Buffer | null>;
  // NEW:
  getSignedUploadUrl?(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<{ url: string; headers: Record<string, string> }>;
}
```

Implement on both `S3Storage` (real signed URL) and `LocalStorage` (returns the `${origin}/api/upload?key=...` URL). The route handler calls `storage.getSignedUploadUrl(...)` mode-agnostically.

**Trade-off:** this is a cleaner abstraction (3 methods → 4) but adds ~30 minutes to the plan (new interface method, two implementations, two tests). For tomorrow's interview-prep path, **I recommend DEFERRING this adjustment** — keep the route handler inline for now, fold the interface promotion into a follow-up cleanup after the interview. Mark it explicitly in the TODO.

### Adjustment 6 — Tighten `existingAsset` Zod schema

**Current schema:**
```ts
existingAsset: z.string().nullable(),
```

**Fix:**
```ts
existingAsset: z
  .string()
  .max(256, "existingAsset key must be ≤ 256 characters")
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/,
    "existingAsset must be a relative storage key — no leading slash, no dotfiles"
  )
  .refine(
    (k) => !k.includes("..") && !k.includes("\\"),
    "existingAsset must not contain path traversal segments"
  )
  .nullable(),
```

This is defensive (the `LocalStorage.safePath` guard catches traversal attempts at runtime) but it fails earlier — at the Zod validation boundary — and provides a clearer error message to the client. Two-layer defense.

### Adjustment 7 — Magic-byte validation to defeat Content-Type spoofing

**Why:** the external patch trusts `Content-Type: image/png` from the client. A reviewer could rename `secrets.env` to `secret.png`, set `Content-Type: image/png`, and upload it. The pipeline would happily composite text overlay onto the garbage file — Sharp's decoder would reject it with `Input file has unsupported image format`, which becomes a processing error. Not a security issue per se, but a UX issue and a mark against defensive thinking.

**Fix:** add a 40-line magic-byte sniffer at `lib/pipeline/imageValidation.ts`:

```ts
export type AllowedImageMime = "image/png" | "image/webp" | "image/jpeg";

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(buf: Buffer, magic: number[], offset = 0): boolean {
  if (buf.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[offset + i] !== magic[i]) return false;
  }
  return true;
}

export function isImageMagicBytesMatching(buf: Buffer, declaredMime: AllowedImageMime): boolean {
  switch (declaredMime) {
    case "image/png":
      return startsWith(buf, PNG);
    case "image/jpeg":
      return startsWith(buf, JPEG);
    case "image/webp":
      return startsWith(buf, RIFF, 0) && startsWith(buf, WEBP, 8);
  }
}
```

Call from the PUT handler right after reading the body. Return 400 `INVALID_BRIEF` with a clear message on mismatch.

---

## 📝 File-by-file implementation plan

Ordered so each step type-checks cleanly before the next.

### Step 1 — `lib/api/logEvents.ts` — add upload event names

Add to the `LogEvents` constant object:
```ts
UploadInitReceived: "upload.init.received",
UploadInitComplete: "upload.init.complete",
UploadInitFailed: "upload.init.failed",
UploadPutReceived: "upload.put.received",
UploadPutComplete: "upload.put.complete",
UploadPutFailed: "upload.put.failed",
```

**Test impact:** none (event names are strings; TS narrowing validates usage at call sites).

### Step 2 — `lib/api/errors.ts` — add `readBinaryBodyWithLimit`

Sibling to `readBodyWithLimit`. Stream-chunk body reader, returns a discriminated union:
```ts
export async function readBinaryBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; data: Buffer }
  | { ok: false; reason: "too_large" | "read_error" | "empty" }
> { ... }
```

Implementation: exactly mirrors `readBodyWithLimit` but concatenates chunks into a `Buffer` instead of a UTF-8 string. ~30 lines.

**Tests:** 3 cases — happy path (small PNG), oversized body (> maxBytes), empty body. Add to a new `__tests__/readBinaryBodyWithLimit.test.ts` or fold into existing errors test.

### Step 3 — `lib/pipeline/imageValidation.ts` (new)

The magic-byte sniffer from Adjustment 7. Pure function, no framework deps.

**Tests:** 4 cases — valid PNG bytes with PNG mime, valid JPEG with JPEG mime, valid WebP (tricky because RIFF header + WEBP at offset 8), mismatched (JPEG bytes declared as PNG).

### Step 4 — `lib/api/services.ts` — add `validateUploadEnv`

```ts
/**
 * Validate env vars required specifically for the upload flow. Upload
 * doesn't need OPENAI_API_KEY (it never calls OpenAI), but it DOES
 * need S3_BUCKET when STORAGE_MODE=s3 — otherwise the signed URL mint
 * would throw a confusing error deep in the AWS SDK.
 *
 * Called from `app/api/upload/route.ts` at request entry.
 */
export function validateUploadEnv(): void {
  const missing: string[] = [];
  if (getStorageMode() === "s3" && !process.env.S3_BUCKET) {
    missing.push("S3_BUCKET (required when STORAGE_MODE=s3)");
  }
  if (missing.length > 0) {
    throw new MissingConfigurationError(
      `Upload flow missing required env vars: ${missing.join(", ")}`
    );
  }
}
```

**Tests:** 2 cases — missing `S3_BUCKET` in s3 mode throws, missing `S3_BUCKET` in local mode does not throw.

### Step 5 — `lib/api/types.ts` — add upload wire types

```ts
export interface UploadInitRequestBody {
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  campaignId?: string;
}

export interface UploadInitResponseBody {
  uploadUrl: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
  /**
   * URL the frontend can use to PREVIEW the uploaded asset after the
   * PUT completes. In local mode this is `/api/files/<key>`. In S3 mode
   * this is NOT currently populated — the S3 GET URL is minted at brief
   * submission time via `S3Storage.getUrl`, not at upload time.
   */
  assetUrl: string | null;
}
```

**Tests:** type-check only.

### Step 6 — `app/api/upload/route.ts` — full rewrite

Adapted from the external `route.ts.fixed` with all 7 adjustments applied. Structure:

```ts
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_EXPIRY_SECONDS = 300;
const ALLOWED_IMAGE_CONTENT_TYPES: ReadonlySet<AllowedImageMime> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// Strict init-body validator (returns Result union)
function validateInitBody(body: unknown): ...

// Storage-key builder — same shape as the external patch:
// assets/<safeCampaignId>/<timestamp>-<sanitizedBase>.<ext>
function buildAssetKey(filename, campaignId, contentType): string { ... }

// POST handler — returns { uploadUrl, key, method, headers, assetUrl }
export async function POST(request: Request): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.UploadInitReceived, { route: "/api/upload", method: "POST" });

  try { validateUploadEnv(); } catch (e) { ... MISSING_CONFIGURATION 500 ... }

  let body: unknown;
  try { body = await request.json(); }
  catch { return ... INVALID_JSON 400 ... }

  const parsed = validateInitBody(body);
  if (!parsed.ok) return ... INVALID_BRIEF 400 ...

  const key = buildAssetKey(parsed.value.filename, parsed.value.campaignId, parsed.value.contentType);

  if (getStorageMode() === "s3") {
    try {
      const client = new S3Client({ region: process.env.S3_REGION ?? "us-east-1" });
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        ContentType: parsed.value.contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
      ctx.log(LogEvents.UploadInitComplete, { key, mode: "s3" });
      return NextResponse.json({
        uploadUrl,
        key,
        method: "PUT",
        headers: { "Content-Type": parsed.value.contentType },
        assetUrl: null,
      } satisfies UploadInitResponseBody);
    } catch (error) {
      console.error(`[${ctx.requestId}] S3 signed URL mint failed:`, error);
      ctx.log(LogEvents.UploadInitFailed, { mode: "s3" });
      return ... UPSTREAM_ERROR 502 ...
    }
  }

  // Local mode — return a URL back to this same route
  const origin = new URL(request.url).origin;
  const encodedKey = encodeURIComponent(key);
  ctx.log(LogEvents.UploadInitComplete, { key, mode: "local" });
  return NextResponse.json({
    uploadUrl: `${origin}/api/upload?key=${encodedKey}`,
    key,
    method: "PUT",
    headers: { "Content-Type": parsed.value.contentType },
    assetUrl: `${origin}/api/files/${encodedKey}`,
  } satisfies UploadInitResponseBody);
}

// PUT handler — accepts binary body in local mode, returns 404 in S3 mode
export async function PUT(request: Request): Promise<Response> {
  const ctx = createRequestContext();
  ctx.log(LogEvents.UploadPutReceived, { route: "/api/upload", method: "PUT" });

  if (getStorageMode() === "s3") {
    return ... NOT_FOUND 404 (uploads go direct to S3, not through this route) ...
  }

  // Read + validate key query param
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key) return ... INVALID_BRIEF 400 ...
  // Normalize key against traversal — LocalStorage.save() will re-check

  // Content-Type allowlist (strip charset/boundary)
  const rawContentType = request.headers.get("content-type") ?? "";
  const normalizedType = rawContentType.split(";")[0].trim().toLowerCase() as AllowedImageMime;
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(normalizedType)) {
    return ... INVALID_BRIEF 400 ...
  }

  // Stream-level body byte cap
  const bodyResult = await readBinaryBodyWithLimit(request, MAX_UPLOAD_BYTES);
  if (!bodyResult.ok) {
    const code = bodyResult.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_BRIEF";
    const status = bodyResult.reason === "too_large" ? 413 : 400;
    return ... code status ...
  }

  // Magic-byte sniff
  if (!isImageMagicBytesMatching(bodyResult.data, normalizedType)) {
    return ... INVALID_BRIEF 400 "content does not match declared Content-Type" ...
  }

  // Write via StorageProvider (NOT direct fs.writeFile — Adjustment 1)
  try {
    const storage = getStorage();
    await storage.save(key, bodyResult.data, normalizedType);
    ctx.log(LogEvents.UploadPutComplete, { key, bytes: bodyResult.data.length, contentType: normalizedType });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`[${ctx.requestId}] Local upload write failed:`, error);
    ctx.log(LogEvents.UploadPutFailed, { key });
    return ... STORAGE_ERROR 500 ...
  }
}
```

### Step 7 — `lib/api/client.ts` — add `uploadAsset` client method

```ts
export interface UploadAssetResult {
  key: string;
  bytes: number;
}

/**
 * Two-step upload: init (POST) → PUT bytes → return the storage key.
 * The caller saves the key into `product.existingAsset` and submits
 * the brief as usual. The pipeline's assetResolver then finds it.
 */
export async function uploadAsset(
  file: File,
  options: { campaignId?: string; signal?: AbortSignal } = {}
): Promise<UploadAssetResult> {
  // Validate client-side before the round trip
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error(`File exceeds ${MAX_BYTES} bytes (${file.size} bytes)`);
  }

  // Step 1 — init
  const initResult = await postJson<UploadInitResponseBody>(
    "/api/upload",
    {
      filename: file.name,
      contentType: file.type,
      campaignId: options.campaignId,
    } satisfies UploadInitRequestBody,
    { signal: options.signal }
  );
  if (!initResult.ok) {
    throw new Error(initResult.error.message);
  }

  // Step 2 — PUT bytes
  const putResponse = await fetch(initResult.data.uploadUrl, {
    method: initResult.data.method,
    headers: initResult.data.headers,
    body: file,
    signal: options.signal,
  });
  if (!putResponse.ok) {
    throw new Error(`Upload PUT failed with status ${putResponse.status}`);
  }

  return { key: initResult.data.key, bytes: file.size };
}
```

**Tests:** 2 cases — happy path (mocked fetch), init failure propagates error message.

### Step 8 — `components/BriefForm.tsx` — reveal `existingAsset` + add upload control

Replace the hidden input (line 805–810) with a visible control group per product. Uses `setValue` from react-hook-form's `useFormContext` to populate the field after upload succeeds.

```tsx
// Add to component-level state
const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
const [uploadError, setUploadError] = useState<string | null>(null);

const { watch, setValue } = useFormContext();  // or however the existing BriefForm accesses form methods

async function handleAssetUpload(
  index: number,
  e: React.ChangeEvent<HTMLInputElement>
) {
  const file = e.target.files?.[0];
  if (!file) return;
  setUploadingIndex(index);
  setUploadError(null);
  try {
    const result = await uploadAsset(file, {
      // Campaign ID may not be set yet at upload time; server falls back to "adhoc"
      campaignId: watch("campaign.id") || undefined,
    });
    setValue(`products.${index}.existingAsset`, result.key, {
      shouldDirty: true,
      shouldValidate: true,
    });
  } catch (err) {
    setUploadError(err instanceof Error ? err.message : "Upload failed");
  } finally {
    setUploadingIndex(null);
    e.target.value = "";  // allow re-selecting the same file
  }
}

// Inside the product map, replace the hidden input:
const existingAsset = watch(`products.${index}.existingAsset`);

<div className="space-y-2">
  <label className="block text-xs font-semibold text-[var(--ink-muted)]">
    Product asset (optional)
  </label>

  {existingAsset ? (
    <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <span className="truncate font-mono text-xs text-[var(--ink)]">
        {existingAsset}
      </span>
      <button
        type="button"
        onClick={() =>
          setValue(`products.${index}.existingAsset`, null, { shouldDirty: true })
        }
        className="text-xs text-[var(--ink-muted)] underline hover:text-[var(--ink)]"
      >
        Clear
      </button>
    </div>
  ) : (
    <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg)] px-3 py-4 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface)]">
      <input
        type="file"
        accept="image/png,image/webp,image/jpeg"
        className="sr-only"
        disabled={uploadingIndex === index}
        onChange={(e) => handleAssetUpload(index, e)}
      />
      <span>
        {uploadingIndex === index
          ? "Uploading…"
          : "Upload a product image (PNG / WebP / JPEG)"}
      </span>
    </label>
  )}

  {uploadError && uploadingIndex === null && (
    <p className="text-xs text-rose-600">{uploadError}</p>
  )}

  <p className="text-[10px] text-[var(--ink-subtle)]">
    Leave blank to generate via DALL-E. Upload a real product photo to reuse
    instead — the pipeline will skip DALL-E for this product and composite the
    campaign message onto your image.
  </p>
</div>
```

**Tests:** frontend component tests are not part of the current test surface (AdSpark tests are pipeline + API). Verify manually via local dev server. Add to the dry-run checklist in Block F.

### Step 9 — `README.md` — update the upload architecture description

Remove the stale line *"POST /api/upload — pre-signed S3 URL for asset upload"*. Replace with:

```markdown
### `POST /api/upload` (init) + `PUT /api/upload?key=...` (local bytes)

Two-step asset upload flow with parity across storage modes:
1. **Init:** frontend POSTs `{filename, contentType, campaignId?}`, server validates and returns an `uploadUrl` + `key`.
2. **Upload:**
   - **S3 mode:** `uploadUrl` is a pre-signed S3 PUT URL. Browser uploads directly to S3, bypassing the Next.js function.
   - **Local mode:** `uploadUrl` points back at `/api/upload?key=...`. Browser PUTs the binary body; the route writes via `LocalStorage.save()`.
3. Frontend saves the returned `key` to `product.existingAsset`. The pipeline's `assetResolver` finds it on the next `/api/generate` call and skips DALL-E for that product.

See [SPIKE-003](docs/spikes/SPIKE-003-asset-upload-flow.md) and [INVESTIGATION-003](docs/investigations/INVESTIGATION-003-upload-route-two-step-flow.md) for the full design.
```

### Step 10 — `lib/pipeline/briefParser.ts` — tighten `existingAsset` Zod schema (Adjustment 6)

Apply the tightened schema from Adjustment 6.

**Test impact:** 2 existing test fixtures use `existingAsset: null` — still valid, no changes needed. Add 2 new parser tests — rejected patterns (`../etc/passwd`, empty string) and accepted pattern (the upload-key format `assets/adhoc/1729876543-hero.png`).

---

## 🧪 Test plan

Seven new tests. Ordering matches dependencies — later tests don't exist until earlier layers are in place.

| # | File | Test name | Asserts |
|---|---|---|---|
| T1 | `__tests__/readBinaryBodyWithLimit.test.ts` (new) | reads small body into a Buffer | `ok: true, data.length === N` |
| T2 | `__tests__/readBinaryBodyWithLimit.test.ts` (new) | rejects oversized body at the stream level | `ok: false, reason: "too_large"` |
| T3 | `__tests__/imageValidation.test.ts` (new) | PNG magic bytes pass | `true` |
| T4 | `__tests__/imageValidation.test.ts` (new) | JPEG bytes declared as PNG fail | `false` |
| T5 | `__tests__/uploadRoute.test.ts` (new) | POST init happy path in local mode | 200, response matches `UploadInitResponseBody`, `uploadUrl` contains `?key=` |
| T6 | `__tests__/uploadRoute.test.ts` (new) | PUT happy path in local mode | 204, file is reachable via `LocalStorage.load(key)` |
| T7 | `__tests__/uploadRoute.test.ts` (new) | PUT rejects mismatched magic bytes | 400, `INVALID_BRIEF` |

**Intentionally NOT testing** (scope creep, interview tomorrow):
- S3 mode init path (requires mocking `@aws-sdk/s3-request-presigner`)
- Browser-side `BriefForm` upload flow (no React component test harness in the codebase)
- CORS preflight on the bucket (bucket config, not application code)

These gaps are documented in the SPIKE-003 §Success criteria as "S3 mode (optional, D1.b only)."

---

## ⚠️ Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **The key the frontend stores differs from what the pipeline reads** (the `key` vs `uploadUrl` correctness bug the reviewer flagged) | Medium | High — reuse branch silently fails; pipeline calls DALL-E anyway | Integration test T6 asserts `storage.load(key)` returns the uploaded buffer; dry-run checklist in Block F explicitly verifies `sourceType: "reused"` on the uploaded product |
| **Magic-byte sniffer over-rejects a valid WebP** (VP8L vs VP8 lossless variants have different byte patterns) | Low | Medium — legitimate uploads fail | RIFF + WEBP bytes at offsets 0 and 8 are STABLE across all WebP variants; verified against the WebP spec. Test T4 covers. |
| **`watch("campaign.id")` fires before the user has typed the campaign ID** | High | Low — server falls back to `"adhoc"` namespace, upload still works | Already handled — `buildAssetKey` defaults `safeCampaignId` to `"adhoc"` when `campaignId` is empty |
| **Vercel function 4.5 MB body cap in local-mode PUT** | Medium | Medium — local-mode upload fails silently for > 4.5 MB files | `MAX_UPLOAD_BYTES = 10 MB` — tighten to 4 MB for Vercel safety, document the limit in README |
| **Bucket CORS doesn't permit PUT from browser origin** | High (if user chooses D1.b) | High — S3 upload fails in browser with CORS error | Docs-only for D1.a; if D1.b, Block F includes a bucket CORS update step |
| **Concurrent uploads of the same filename collide** | Low | Low — second upload overwrites first | `buildAssetKey` prepends `Date.now()` to the basename. Collision requires two uploads in the same millisecond. Acceptable. |
| **Path traversal via `?key=../../../../etc/passwd`** | Low | High — would write outside `baseDir` | `LocalStorage.save()` already calls `safePath()` which enforces the traversal guard (inherited from Block B). Verified by the existing `localStorage.test.ts:traversal guard` test |
| **Disk fills with orphaned uploads** | Low (local only) | Low | `./output/assets/` is under the same gitignored tree as `./output/<campaignId>/`. Reviewers cleaning up run `rm -rf output/` — no surprise. Post-MVP: add a background sweep that evicts uploads older than 24h |
| **Pre-signed URL expiry too short for slow connections** | Low | Low | 300s = 5 min. At 1 Mbps upload, a 5 MB file takes 40s. 5 min is 7.5× that budget — ample margin |

---

## 🔄 Rollback strategy

**If the implementation breaks the working `/api/generate` flow:**
1. Revert the entire upload commit: `git revert <sha>`.
2. The stub route.ts comes back. `coastal-sun-protection` demo via the "Load example" button still works (Block B + C + D are unchanged).

**If local mode works but S3 mode is broken (D1.b only):**
1. Set `STORAGE_MODE=local` in Vercel env vars.
2. Hosted deployment falls back to local mode on Vercel — which writes to the ephemeral `/tmp` filesystem, so generated creatives are visible within one request but not across function invocations. For a single-session demo this is acceptable; for persistence S3 mode must be fixed.

**If the frontend wires `uploadUrl` instead of `key` into the brief (the one-line correctness bug):**
1. Symptom: uploads succeed (201/204) but the pipeline still calls DALL-E for the uploaded product. `sourceType: "generated"` on every creative.
2. Fix: one-line change in `BriefForm.tsx` — `setValue('products.${i}.existingAsset', result.key)` instead of `result.uploadUrl`.
3. The test plan catches this at T6 — if that test is passing and the UI still calls DALL-E, the bug is NOT in T6's scope (which tests the API round trip, not the form). A manual dry-run in Block F is the final guard.

---

## 📅 Migration path from D1.a (local-only) to D1.b (local + S3)

After the interview, if S3 parity is pursued:

1. **Bucket CORS update.** Add `"PUT"` to `AllowedMethods` in the AdSpark S3 bucket CORS rule. Add `http://localhost:3000` + `https://<vercel-preview>.vercel.app` to `AllowedOrigins`. Add `"Content-Type"` to `AllowedHeaders`.
2. **Implement the S3 branch of the POST handler.** The external patch already has this — copy it verbatim (`S3Client` + `getSignedUrl(PutObjectCommand)` with 5-minute expiry).
3. **Test S3 init.** Set `STORAGE_MODE=s3` locally, hit `/api/upload` with curl, confirm you get back a `uploadUrl` containing `s3.amazonaws.com` and a signature query string.
4. **Test S3 PUT from browser.** Open the dashboard in a browser against the S3-mode backend, upload a file via BriefForm, open DevTools → Network → verify the PUT request goes to `s3.amazonaws.com` (NOT `/api/upload`) and returns 200.
5. **Smoke-test the end-to-end reuse.** Upload an image, submit the brief, confirm the pipeline logs `assetResolver.reused: 1` and the gallery shows a "Reused" badge.
6. **Add S3 mode test cases** (T5S + T6S). Mock the `@aws-sdk/s3-request-presigner` `getSignedUrl` call. Asserting the bucket CORS is out of scope for unit tests — add a README note.

**Estimate:** ~60 minutes additional work, contingent on the bucket CORS change succeeding on the first try.

---

## 🎤 Interview narrative hook

If this ships (either D1.a or D1.b), the narrative beat is:

> *"The assignment's Data Sources bullet says 'assets uploaded manually'. My first implementation had `/api/upload` as a stub — I hadn't wired the asset library UI into BriefForm yet, and was using committed seed assets for the reuse demo. When I audited against the assignment text I wrote SPIKE-003 and INVESTIGATION-003 to document the gap and the fix, then implemented a two-step init-plus-PUT flow with storage-mode parity. In local mode the PUT hits the Next.js route and writes via LocalStorage.save. In S3 mode the init returns a pre-signed PUT URL and the browser uploads directly to S3, bypassing the Vercel function entirely — which matters because Vercel charges for function bandwidth and caps the request body at 4.5 MB.*
>
> *The one correctness bit I had to get right: the frontend stores the returned STORAGE KEY in `product.existingAsset`, not the signed URL. Signed URLs expire; the asset-resolver expects a key. Missing that is the 'silent reuse failure' bug — upload succeeds, brief submits, pipeline still calls DALL-E because the resolver can't find the asset. I have an integration test that asserts `storage.load(key)` returns the uploaded buffer to catch that regression at CI time."*

If this is deferred (docs-only land):

> *"I audited the upload flow against the assignment text and documented the gap in SPIKE-003 and INVESTIGATION-003 — full implementation plan, file-by-file diffs, adjustment list against an external code review, test plan, risk register, migration path. I chose to ship the docs rather than land code on the interview eve because the test surface for upload is non-trivial and I wanted my live demo path to stay pristine. For production I'd land it in a 2-hour follow-up — local mode first, then bucket CORS update for S3 parity. Happy to walk you through the spike if you want to see the planning artifact."*

---

## 🔗 References

- [SPIKE-003 — Asset upload flow (parent ticket)](../spikes/SPIKE-003-asset-upload-flow.md)
- External review file: `c:\Users\dougi\Downloads\route.ts.fixed`
- External patch file: `c:\Users\dougi\Downloads\adspark-upload-route.patch`
- [INVESTIGATION-001 — Vercel S3 signature mismatch](INVESTIGATION-001-vercel-s3-signature-mismatch.md) — historical context for S3 pre-signed URL debugging in this codebase
- [SPIKE-002 — Pipeline latency audit](../spikes/SPIKE-002-pipeline-latency-audit.md) — the Vercel timeout cascade story that motivates WHY upload shouldn't flow through the function in S3 mode
- [`lib/pipeline/assetResolver.ts`](../../lib/pipeline/assetResolver.ts) — the reuse consumer
- [`lib/storage/localStorage.ts`](../../lib/storage/localStorage.ts) — `save()`, `safePathAgainst`, seed-dir fallback (Block B)
- [`lib/storage/s3Storage.ts`](../../lib/storage/s3Storage.ts) — existing `save`/`getUrl`; future home of `getSignedUploadUrl` (Adjustment 5)
- [`app/api/generate/route.ts`](../../app/api/generate/route.ts) — gold-standard route conventions (RequestContext, readBodyWithLimit, buildApiError satisfies)
- [`components/BriefForm.tsx`](../../components/BriefForm.tsx) — the form that currently hides `existingAsset`
- [ADR-002 — Direct SDK over MCP](../adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md) — the integration philosophy this upload flow follows
- [ADR-006 — API wire format parallel shapes](../adr/ADR-006-api-wire-format-parallel-shapes.md) — why `UploadInitResponseBody` is an API-layer type, not a domain projection
