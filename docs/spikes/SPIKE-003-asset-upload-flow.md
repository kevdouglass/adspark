# SPIKE-003 — Manual Asset Upload Flow (local + optional S3 parity)

| | |
|---|---|
| **Status** | 📝 Planned — investigation complete, implementation pending owner approval |
| **Owner** | Kevin Douglass |
| **Created** | 2026-04-14 |
| **Estimate** | Local-only path: ~2.0 h (incl. tests). Local + S3 parity: ~3.0 h. Docs-only (ship SPIKE + INVESTIGATION without any code change): ~0.5 h |
| **Blocked on** | Interview-prep branch (`feat/interview-prep`) — must not destabilize the live demo path |
| **Severity** | 🟡 Medium — partially misaligned with the assignment's "Data Sources" requirement; the reuse code path already works, but there is no UI entry point for manually uploading an asset |
| **Related** | [INVESTIGATION-003 — Upload route stub to two-step flow audit & plan](../investigations/INVESTIGATION-003-upload-route-two-step-flow.md), [SPIKE-002 — Pipeline latency audit](SPIKE-002-pipeline-latency-audit.md), [INVESTIGATION-001 — Vercel S3 signature mismatch](../investigations/INVESTIGATION-001-vercel-s3-signature-mismatch.md), [`app/api/upload/route.ts`](../../app/api/upload/route.ts), [`lib/storage/`](../../lib/storage/), [`lib/pipeline/assetResolver.ts`](../../lib/pipeline/assetResolver.ts), [`components/BriefForm.tsx`](../../components/BriefForm.tsx), external review files: `c:\Users\dougi\Downloads\adspark-upload-route.patch`, `c:\Users\dougi\Downloads\route.ts.fixed` |

---

## 🎯 Investigation Scope

The Adobe take-home assignment explicitly lists **three** data sources the pipeline must accept:

> **Data Sources**
> - **User inputs:** Campaign briefs and **assets uploaded manually**.
> - **Storage:** Storage to save generated or transient assets (Can be Azure, AWS or Dropbox).
> - **GenAI:** Best-fit APIs available for generating hero images, resized and localized variations.

AdSpark's current state (post-Block B + C + D of the interview-prep branch):

| Data source | Status | Evidence |
|---|---|---|
| Campaign briefs | ✅ **Aligned** — three input paths: JSON body POST `/api/generate`, natural-language via `BriefGeneratorAI` → `/api/orchestrate-brief`, structured form via `BriefForm` | `app/api/generate/route.ts`, `app/api/orchestrate-brief/route.ts`, `components/BriefForm.tsx`, `components/BriefGeneratorAI.tsx` |
| Assets uploaded manually | ❌ **NOT aligned** — see §Current state below | `app/api/upload/route.ts` (stub, returns 501); `components/BriefForm.tsx:805-810` (`existingAsset` registered as hidden input) |
| Storage (AWS) | ✅ **Aligned** — pluggable `StorageProvider` interface with AWS S3 and local filesystem implementations, switched via `STORAGE_MODE` env + `createStorage()` factory | `lib/storage/index.ts`, `lib/storage/s3Storage.ts`, `lib/storage/localStorage.ts` |
| GenAI (hero + resized) | ✅ **Aligned** — DALL-E 3 via OpenAI SDK + Sharp cover+center resize | `lib/pipeline/imageGenerator.ts`, `lib/pipeline/textOverlay.ts` |
| GenAI (localized variations) | ⚠️ **Partial** — `campaign.targetRegion` + `campaign.targetAudience` + `campaign.tone` flow into the prompt templates, but there is no translation, no RTL text support, and no region-specific visual adaptation. English-only. Honestly disclosed in README "Known limitations" | `lib/pipeline/promptBuilder.ts`, `README.md` |

**This spike's mission:** close the "assets uploaded manually" gap with a minimum viable, demo-safe implementation that works identically in local-filesystem mode (the primary demo target for the interview tomorrow) and optionally in S3 mode (the hosted Vercel target), without destabilizing the core `coastal-sun-protection` reuse demo that Block B + C + D already wired up.

---

## 📋 Why this is partially misaligned today

### Current state (fresh audit 2026-04-14)

**1. `app/api/upload/route.ts` is a stub.**

```ts
// Current implementation — app/api/upload/route.ts
export async function POST(_request: Request) {
  // TODO: Checkpoint 2 — pre-signed S3 URL generation
  return NextResponse.json(
    { error: "Not implemented — Checkpoint 2" },
    { status: 501 }
  );
}
```

Any client that POSTs to `/api/upload` gets a literal 501. The README's architecture section advertises *"POST — pre-signed S3 URL for asset upload"* — an architecture-vs-implementation mismatch a reviewer can find by grep.

**2. `existingAsset` is a hidden field in the BriefForm.**

```tsx
// components/BriefForm.tsx:805
{/* existingAsset is part of the schema but hidden in the UI —
    ADS-013 (pre-signed S3 uploads) will add the real upload control */}
<input
  type="hidden"
  {...register(`products.${index}.existingAsset`)}
/>
```

The field exists in the `campaignBriefSchema` Zod schema, in `react-hook-form` state, and in the wire format, but there is **no user-facing control**. A reviewer filling in the structured form can never exercise the reuse branch through the UI.

**3. The reuse branch IS fully wired end-to-end** (as of Block B of the interview-prep branch):
- `examples/seed-assets/spf-50-sunscreen.webp` + `after-sun-aloe-gel.webp` are committed
- `LocalStorage.readOnlySeedDirs` fallback (lib/storage/localStorage.ts:30) finds them by key name
- `assetResolver.resolveOne` calls `storage.exists(product.existingAsset)` + `storage.load(...)` and short-circuits DALL-E generation
- `sourceType: "reused"` propagates through `Creative` → `CreativeOutput` → wire mapper → `ApiCreativeOutput` → UI badge + `RunSummaryPanel` (Block C)
- `examples/campaigns/coastal-sun-protection/brief.json` is the canonical demo that exercises it

**So the gap is small and well-scoped:** the *read* path of the reuse branch works perfectly through committed seed assets + the "Load example" button in `BriefGeneratorAI`. The *write* path — actually uploading a new asset from the user's filesystem — is missing.

---

## 🗂️ Approaches considered

### Approach A — Do nothing (narrative-only disclosure) ❌ rejected

**Shape:** leave the stub, soften the README, cover the gap verbally in the interview narrative.

**Pros:** zero code risk, zero time cost.

**Rejected because:** The assignment text says **"assets uploaded manually"**. A strict reviewer reads this as "I must be able to pick a file from my computer and attach it to a product." Honest narrative disclosure is not the same as literal alignment. Interview scrutiny cost is higher than the implementation cost.

### Approach B — Reveal `existingAsset` as a visible text input ⚠️ partial

**Shape:** unhide the field in `BriefForm`, render a labeled text control. Reviewer types a filename from `examples/seed-assets/` (e.g., `spf-50-sunscreen.webp`) or leaves it blank.

**Pros:** ~25 min work, zero schema change, zero wire-format change, zero new failure modes. Reviewer can type into an existing committed seed asset and demo the reuse path via the structured form path (not just the "Load example" button).

**Rejected as the primary solution because:** "typing a filename of a seed asset" is not the same as "uploading a file". It's closer to alignment than Approach A, but the assignment says *uploaded manually*, not *reference a pre-baked library asset by name*. Still a weaker answer than a real file picker.

**Kept as a fallback** if Approach C is too risky to finish before the interview. This is the "graceful degradation" path — ship the hidden field reveal even if the full upload flow doesn't land.

### Approach C — Single-step raw binary POST (PocketDev pattern) ⚠️ local-only, Vercel-fragile

**Shape:** `POST /api/upload` with `Content-Type: image/png` + raw ArrayBuffer + `X-File-Name` header. Server reads the body stream, validates, calls `LocalStorage.save()`. Matches the pattern in `apps/api/src/routes/uploadRoutes.js` from the PocketDev project (see user's external review).

**Pros:** simplest possible server logic — one route handler, no pre-signed URL dance, no round trip. The browser sends the bytes in one request. Matches an already-working pattern from another of the user's projects.

**Rejected because:**
1. **Vercel function bandwidth costs.** Every byte uploaded by the browser flows through the Vercel serverless function. A 10 MB upload burns 10 MB of Vercel bandwidth and sits in the function's memory. Vercel's 4.5 MB request body limit on Hobby tier would also kill this outright — a 5 MB PNG cannot even reach the handler.
2. **No S3 parity.** Forces a split implementation: local mode uses binary POST, S3 mode needs a pre-signed URL flow (per INVESTIGATION-001's demonstrated pattern). The frontend then has two different upload flows, one per storage mode. Complexity bloom.
3. **Tied to a single storage target.** Doesn't use the `StorageProvider` abstraction the codebase already has.

### Approach D — Two-step init + PUT with signed URL parity ⭐ RECOMMENDED

**Shape** (from external review, adapted to AdSpark conventions — see INVESTIGATION-003 for the detailed alignment):

```
Browser                         Next.js /api/upload              Storage
──────                          ────────────────────             ───────
1. POST /api/upload (JSON)  ──► validateInitBody
   {filename, contentType,      buildAssetKey
    campaignId}                 switch (STORAGE_MODE)
                                  ├─ "s3" → getSignedUrl(PUT)
                                  └─ "local" → `${origin}/api/upload?key=...`
                                ◄── {uploadUrl, key, method, headers, assetUrl}

2. PUT uploadUrl (bytes) ─────► S3 (directly, bypassing Next.js function)
                                 OR
                                 Next.js /api/upload?key=... (local only)
                                 ◄── 204 No Content

3. Frontend sets product.existingAsset = key (NOT uploadUrl)
4. Submit brief to /api/generate as usual
5. assetResolver.resolveOne(product.existingAsset) → HIT → skip DALL-E
```

**Pros:**
1. **S3 parity.** In S3 mode the browser uploads directly to S3 via a pre-signed URL — zero bandwidth through Vercel. This is the canonical AWS pattern and matches AdSpark's existing `S3Storage.getUrl()` design philosophy (mint pre-signed URLs, keep the bucket private).
2. **Local parity.** In local mode the same two-step flow works — the init returns a URL pointing back at the same route with a `?key=` query param; the PUT handler accepts the binary body and writes via `LocalStorage.save()`. Frontend code is identical across modes.
3. **Respects the `StorageProvider` abstraction.** The brief references assets by storage KEY, not by URL or file path. `assetResolver.resolveOne` continues to work unchanged.
4. **Key-based, not URL-based.** Frontend stores `product.existingAsset = uploadResult.key`, not the signed URL — signed URLs expire, keys don't. This is the critical correctness bit the external reviewer flagged as "the one thing to double-check first."

**Cons / risks:**
1. **Two HTTP round trips instead of one.** Negligible cost — init returns in <100 ms.
2. **S3 bucket CORS requirements** — the bucket must permit browser `PUT` from the page origin. AdSpark's current bucket CORS permits GET + HEAD (for downloading creatives); it does NOT permit PUT. Adding PUT to the CORS rule is a one-time bucket configuration change.
3. **Pre-signed URL expiry** — 5 minutes is the proposed default. Long enough for a browser to upload a 10 MB file on any realistic connection, short enough that a leaked URL is harmless.

**Why this is the right approach:** it matches AdSpark's existing `StorageProvider` design, it solves both local and S3 in one flow, it bypasses Vercel function bandwidth for the large-body path, and it's the pattern the external reviewer independently recommended after reading the AdSpark codebase fresh.

### Approach E — Reuse the `coastal-sun-protection` demo as the only reuse entry point ❌ rejected

**Shape:** don't add any upload UI; rely entirely on the committed seed-asset demo for the reuse story.

**Rejected because:** this is what the current branch already does (post-Block B). It's the interview-safety baseline. This spike exists BECAUSE that baseline is not enough — the assignment asks for manual upload, not pre-baked demo campaigns.

---

## 🏛️ Decision points needing owner input

Before implementation, the following must be decided:

### D1 — Scope: local-only vs local + S3

**Option D1.a — Local-only (safe for interview tomorrow).** Ship the full two-step flow but only implement the local-mode branch. S3 mode returns a clear `NOT_IMPLEMENTED` response pointing at this spike. Documented as follow-up.

**Option D1.b — Local + S3 (complete the parity story).** Ship both branches. Requires: bucket CORS update to add PUT; `S3Client` construction in the upload init handler; `getSignedUrl(PutObjectCommand, ...)` call; credentials validation.

**Recommendation:** **D1.a for tomorrow**, convert to D1.b after the interview. Reasoning: S3 mode adds a test surface (bucket CORS mutation, signed URL lifetime, credential validation in a new code path) that is not the interview demo target. The live demo will run in local mode via `npm run dev` on `feat/interview-prep`. S3 parity is a "strong interview talking point" when asked *"how would this work in production?"* — pointing at this spike is a stronger answer than half-shipping it.

### D2 — Asset storage key namespace

The external patch uses `assets/<campaignId>/<timestamp>-<filename>`. Implications:

- Uploaded assets live under `./output/assets/<campaignId>/...` in local mode
- They are NOT in the committed seed-asset directory
- `LocalStorage`'s primary read path (`./output/`) finds them via `assetResolver`
- The seed-dir fallback (`./examples/seed-assets/`) is unchanged and still services filename-only keys
- No namespace collision

**Recommendation:** accept the external patch's key layout. It's consistent with the existing `outputOrganizer` folder structure (`./output/<campaignId>/<productSlug>/<ratio>/...`) and separates uploads (`assets/...`) from generated creatives (`<campaignId>/...`) at the root level of `./output/`.

### D3 — Does the patched route need modifications before landing?

The external patch (`route.ts.fixed`) is directionally correct but needs ~6 adjustments to align with AdSpark's conventions (RequestContext, structured logging, StorageProvider abstraction, Content-Type parsing, body byte cap, filename strict regex). INVESTIGATION-003 has the full list.

**Recommendation:** land the patch **with the INVESTIGATION-003 adjustments applied**, not as-is. Ship time is ~2 hours instead of ~1 hour, but the result actually uses AdSpark's shared utilities instead of duplicating them.

### D4 — Frontend UX shape for the BriefForm upload control

Two options for the per-product control:

**D4.a — Inline file picker in BriefForm.** Each product row gets a small `<label><input type="file"/></label>` control. File pick triggers the two-step upload; on success, the returned `key` auto-populates `existingAsset` via `react-hook-form`'s `setValue`. Simple, no separate modal, matches the existing form layout.

**D4.b — Dedicated asset library panel.** A separate component showing available seed assets + an upload slot; user picks from a gallery. More "product-like" but significantly more work (~45 min for the gallery UI).

**Recommendation:** **D4.a** — inline per-product picker. Matches the existing BriefForm's dense form layout and keeps Block E's README screenshots simple.

### D5 — Magic-byte validation vs Content-Type trust

The external patch trusts the declared `Content-Type` header and only checks the file extension + MIME string. A Content-Type spoofing attack is possible (rename `secrets.env` → `secret.png`, set `Content-Type: image/png`).

**Recommendation:** add a 15-line magic-byte sniffer (`lib/pipeline/imageValidation.ts`) that rejects bodies whose first 4–12 bytes don't match the declared MIME. PNG = `89 50 4E 47`, JPEG = `FF D8 FF`, WebP = `RIFF ???? WEBP`. Cheap to implement, hard to bypass, and shows sound defensive thinking during the interview walkthrough. Added to the INVESTIGATION-003 plan.

---

## 🎯 Success criteria

For this spike to be considered complete, the following must all be true after implementation:

1. **Local mode:** A reviewer running `npm run dev` can pick a PNG/WebP/JPEG file in the `BriefForm` for any product, watch it upload, see `existingAsset` auto-populate, submit the brief, and observe:
   - The pipeline logs `dalle.start` for products WITHOUT an uploaded asset
   - The pipeline does NOT log `dalle.start` for products WITH an uploaded asset (reuse branch fires)
   - `RunSummaryPanel` shows `reusedAssets: N > 0`
   - `CreativeGallery` renders a green "Reused" badge on the uploaded product's creatives
2. **Security floor:**
   - Oversized uploads (> 10 MB) return 413 with `REQUEST_TOO_LARGE`
   - Non-image Content-Types return 400 with `INVALID_BRIEF`
   - Path-traversal keys (`../etc/passwd`) are rejected by `safePath` / `LocalStorage.safePathAgainst`
   - Magic-byte mismatches are rejected (see D5)
3. **Observability:**
   - Every upload request gets a unique `requestId` (same pattern as `/api/generate`)
   - Every failure emits a structured log event via `ctx.log(LogEvents.X, ...)` (not ad-hoc `console.error`)
4. **Regression safety:**
   - All existing tests pass unchanged
   - The `coastal-sun-protection` committed-seed-asset demo still fires through the reuse branch
   - `npm run type-check && npm run test:run && npm run lint` is green
5. **S3 mode (optional, D1.b only):**
   - Init returns a pre-signed PUT URL with 5-minute expiry
   - Browser can PUT a file directly to the returned URL (bucket CORS permits it)
   - `assetResolver.resolveOne` finds the uploaded key via `S3Storage.exists()` + `S3Storage.load()`
6. **Documentation:**
   - SPIKE-003 and INVESTIGATION-003 committed
   - README architecture section updated (remove the stale "POST /api/upload — pre-signed S3 URL" line; replace with the real two-step description)
7. **Interview narrative impact:**
   - The "where would you build upload UI next?" talking point becomes *"already built — here's the commit"*
   - The assignment's "assets uploaded manually" bullet is literally satisfied, not honestly disclosed

---

## 🔗 Implementation plan

The full file-by-file implementation plan lives in **[INVESTIGATION-003 — Upload route stub to two-step flow audit & plan](../investigations/INVESTIGATION-003-upload-route-two-step-flow.md)**.

That document covers:
- The external review verbatim (for provenance)
- A deep audit of every current AdSpark file the upload flow touches
- Gap analysis: external patch vs AdSpark conventions (6 required adjustments)
- File-by-file diff plan (`app/api/upload/route.ts`, `lib/api/types.ts`, `lib/api/client.ts`, `components/BriefForm.tsx`, `lib/pipeline/imageValidation.ts`, `README.md`)
- Test plan (7 unit/integration tests to add)
- Risk register + rollback strategy
- Migration path from D1.a (local-only) to D1.b (local + S3)
- Interview narrative script for the upload flow

---

## 🧭 Relation to the interview-prep plan

This spike was opened in the middle of the Block B → E → F interview-prep sequence (see parent plan in the agent conversation log). As of this writing:

| Block | Status |
|---|---|
| **A** — branch setup + baseline smoke test | ✅ done |
| **B** — seed reuse-demo assets + `LocalStorage` read-through | ✅ done |
| **C** — `sourceType` plumbing + `RunSummaryPanel` + badges | ✅ done |
| **D** — D3 timing chart | ✅ done |
| **SPIKE-003** (this doc) | 📝 written, implementation pending owner approval |
| **E** — README + interview narrative cheat-sheet | ⏳ pending |
| **F** — dry-run + prebaked demo snapshot | ⏳ pending |

**If approved for implementation, SPIKE-003's code work slots in as Block B+ (between C/D and E).** Block E's narrative cheat-sheet then gains a whole new paragraph: *"and here's the `BriefForm` upload control we wired in specifically for the data-source alignment requirement."*

**If deferred (docs-only land):** Block E's narrative gains the paragraph *"here's the SPIKE-003 + INVESTIGATION-003 plan I wrote for this gap; pointing at it in the interview shows I audited the alignment deliberately and chose a time-safe response."* That is the graceful-degradation interview story.
