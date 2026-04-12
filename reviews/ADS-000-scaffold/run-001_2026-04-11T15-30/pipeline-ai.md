# Pipeline & AI Agent — ADS-000 Scaffold | Run 001
**Verdict:** REQUEST_CHANGES (3 Critical found)

## What's Good
1. **promptBuilder.ts is interview-ready** — five-layer construction, auditable, Quinn Frampton quote in JSDoc.
2. **Discriminated union** `BriefParseResult` forces both-path handling.
3. **StorageProvider abstraction** — minimal interface, zero-credential local dev.

## Findings (12 total: 3C, 5W, 4S)

### CRITICAL — Fixed
- **C-1** `promptBuilder.ts` — `product.color` never in prompt → **Fixed**: Layer 1 brand color
- **C-2** `promptBuilder.ts` — `campaign.targetRegion` never used → **Fixed**: Layer 2 context
- **C-3** `types.ts` — State machine ≠ orchestration.md spec → **Deferred** to Checkpoint 1

### WARNING — Fixed
- **W-1** `promptBuilder.ts:133` — "No human faces" kills lifestyle ads → **Fixed**: category-aware
- **W-2** `assetResolver.ts:33` — `Promise.all` no partial failure → **Fixed**: `Promise.allSettled`
- **W-3** `briefParser.ts:15` — No message max length → **Fixed**: Zod `.max(140)`
- **W-4** `promptBuilder.ts:80` — Season type `string` → **Fixed**: typed enum
- **W-5** Stubs throw not mock → Acceptable pre-implementation

### SUGGESTION — Noted
- **S-1** Features join unordered → Brief should order by visual priority
- **S-2** Prompt single-space join → Acceptable for DALL-E 3
- **S-3** Asset resolver per-product not per-ratio → Design constraint documented
- **S-4** Colon in path names → **Fixed**: `ASPECT_RATIO_FOLDER` mapping

## Prompt Layer Audit (Post-Fix)
| Layer | Brief Fields Used | Status |
|-------|-------------------|:------:|
| 1. Subject | name, description, keyFeatures, **color** | ✓ |
| 2. Context | targetAudience, **targetRegion**, tone, season | ✓ |
| 3. Composition | aspectRatio (per-ratio guidance) | ✓ |
| 4. Style | (consistent across all) | ✓ |
| 5. Exclusions | no text/logos, **category-aware faces** | ✓ |
