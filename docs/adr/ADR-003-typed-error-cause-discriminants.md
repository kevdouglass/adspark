# ADR-003: Typed Error Cause Discriminants for Pipeline Errors

**Status:** Accepted (implemented in PR #43)
**Date:** 2026-04-12
**Decision Makers:** Kevin Douglass
**Origin:** PR #43 Code Quality review finding — string-matching error classifier is brittle

## Decision

Extend `PipelineError` with an optional **typed `cause` discriminant field** that classifies the underlying failure into a stable, exhaustive union. The API route's error mapping table then switches on `{ stage, cause }` with a compile-time exhaustiveness check (`satisfies never`) instead of matching on `error.message` substrings.

```typescript
export type PipelineErrorCause =
  | "content_policy"      // 400 from DALL-E — prompt rejected, non-retryable
  | "rate_limited"        // 429 from any upstream
  | "upstream_timeout"    // AbortSignal fired (client timeout)
  | "upstream_error"      // 5xx from any upstream
  | "invalid_input"       // Zod validation failure or malformed brief
  | "storage_error"       // Storage provider failure (S3, filesystem)
  | "processing_error"    // Sharp / @napi-rs/canvas failure
  | "unknown";

export interface PipelineError {
  product?: string;
  aspectRatio?: AspectRatio;
  stage: PipelineStage;
  cause: PipelineErrorCause;  // NEW — required, defaults to "unknown"
  message: string;
  retryable: boolean;
}
```

## Context

During PR #43 review, the Code Quality Agent flagged the `mapPipelineErrorToApiError()` function in `lib/api/errors.ts` for using brittle string matching to classify errors:

```typescript
// BEFORE — fragile
if (pipelineError.stage === "generating") {
  if (message.includes("content policy")) return { status: 422, ... };
  if (message.includes("rate limit") || message.includes("429")) return { status: 503, ... };
  return { status: 502, ... };
}
```

**Why this is bad:**

1. **Silent drift** — If OpenAI renames "content policy" to "safety guideline" tomorrow, our error mapping silently falls through to generic `UPSTREAM_ERROR` (502) instead of the correct `CONTENT_POLICY_VIOLATION` (422). No test fails. No compiler warning.

2. **Localization risk** — Error messages may be translated in different runtime environments. String matching on English-only keywords breaks in non-US deployments.

3. **Not exhaustive** — TypeScript can't verify that every possible error class is handled. A new error category (e.g., "model_not_found") requires adding a new `if` branch but nothing forces the developer to do so.

4. **Test brittleness** — Tests must construct errors with specific message substrings to exercise code paths, coupling test fixtures to implementation details.

## Options Considered

### Option A: Add `cause` Discriminant Field (Selected)

**How it works:** The pipeline layer (image generator, text overlay, etc.) classifies errors at the point they occur, attaching a typed `cause` to each `PipelineError`. The API route's mapping table switches on `cause` via exhaustive union checks.

- **Pros:**
  - Compile-time exhaustiveness — adding a new `PipelineErrorCause` variant forces every consumer to handle it or TypeScript errors
  - No string matching anywhere in the error pipeline
  - Errors classified where they happen (closest to the domain knowledge)
  - Tests construct errors with typed causes, not message substrings
  - Localization-safe — message strings can change freely without breaking classification
- **Cons:**
  - Requires updates to every place that constructs a `PipelineError` (image generator, text overlay, output organizer, orchestrator, route handler)
  - Slight repetition — the pipeline must know about API concerns (error classification)
  - New required field — not strictly a breaking change for existing callers but all construction sites must be updated

### Option B: Error Class Hierarchy (instanceof)

**How it works:** Create a class hierarchy: `PipelineError` as base, with subclasses like `ContentPolicyError`, `RateLimitError`, `TimeoutError`. Mapping uses `instanceof` checks.

- **Pros:**
  - Very JavaScript-idiomatic
  - Works with the existing error chaining (`cause` property)
- **Cons:**
  - `instanceof` breaks across Realm/iframe boundaries and in some serverless environments
  - Error classes don't serialize well to JSON (class identity lost) — we serialize errors for the API response, manifest.json, and logs
  - TypeScript's narrowing with `instanceof` is less ergonomic than discriminated unions for exhaustive checks
  - Adding a new error type requires extending the class hierarchy — more ceremony than adding a string variant

### Option C: Error Code Enum Only

**How it works:** Add a string enum but without tying it to the `stage` field. Mapping switches on cause alone.

- **Pros:**
  - Simpler than Option A
- **Cons:**
  - Loses the stage context — two errors with `cause: "rate_limited"` might come from different stages and warrant different HTTP responses
  - Less information for debugging

### Option D: Status Quo (String Matching)

- **Pros:** Zero code change
- **Cons:** Every con listed in the Context section above

## Decision Criteria

| Criteria | Option A (Selected) | Option B | Option C | Option D |
|----------|:-------------------:|:--------:|:--------:|:--------:|
| Compile-time exhaustiveness | ✅ | ⚠️ (possible) | ✅ | ❌ |
| Serialization-friendly | ✅ | ❌ | ✅ | ✅ |
| Classification at source | ✅ | ✅ | ✅ | ❌ |
| Localization-safe | ✅ | ✅ | ✅ | ❌ |
| Implementation effort | Medium | Medium | Low | Zero |
| Debuggability | High | High | Medium | Low |

## Implementation Notes

### Where Errors Are Classified

The pipeline knows the most about what went wrong. Classification happens at the error-producing site:

**`lib/pipeline/imageGenerator.ts`:**
```typescript
errors.push({
  product: task.product.slug,
  aspectRatio: task.aspectRatio,
  stage: "generating",
  cause: classifyOpenAIError(reason),  // NEW
  message: reason instanceof Error ? reason.message : "Unknown generation error",
  retryable: isRetryable,
});

function classifyOpenAIError(error: unknown): PipelineErrorCause {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 400) return "content_policy";
    if (error.status === 429) return "rate_limited";
    if (error.status >= 500) return "upstream_error";
  }
  if (error instanceof Error && error.name === "AbortError") return "upstream_timeout";
  return "unknown";
}
```

### Exhaustive Mapping via `satisfies never`

**`lib/api/errors.ts`:**
```typescript
function assertExhaustive(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

export function mapPipelineErrorToApiError(
  pipelineError: PipelineError,
  requestId: string
): { status: number; body: ApiError } {
  const { cause } = pipelineError;

  switch (cause) {
    case "content_policy":    return { status: 422, body: { code: "CONTENT_POLICY_VIOLATION", ... } };
    case "rate_limited":      return { status: 503, body: { code: "UPSTREAM_RATE_LIMITED", ... } };
    case "upstream_timeout":  return { status: 504, body: { code: "UPSTREAM_TIMEOUT", ... } };
    case "upstream_error":    return { status: 502, body: { code: "UPSTREAM_ERROR", ... } };
    case "invalid_input":     return { status: 400, body: { code: "INVALID_BRIEF", ... } };
    case "storage_error":     return { status: 500, body: { code: "STORAGE_ERROR", ... } };
    case "processing_error":  return { status: 500, body: { code: "PROCESSING_ERROR", ... } };
    case "unknown":           return { status: 500, body: { code: "INTERNAL_ERROR", ... } };
    default:                  return assertExhaustive(cause);
  }
}
```

If a new `PipelineErrorCause` variant is added in the future but not handled in this switch, TypeScript fails at compile time with:

```
Argument of type '"new_cause"' is not assignable to parameter of type 'never'.
```

## Consequences

### Positive
- Type safety across error handling — compile-time exhaustiveness
- No string matching anywhere in production code
- Clear separation of concerns: pipeline classifies, API maps to HTTP
- Tests use typed fixtures, not message substrings
- Future contributors see the enum and know all possible error categories at a glance

### Negative
- Every `PipelineError` construction site must be updated (breaking change for internal callers)
- Adds a required field to `PipelineError` — interface change
- Slight coupling: pipeline layer now has domain knowledge of error classification (acceptable — it's the layer with the most context)

### Risks
- If classification at the pipeline layer gets inaccurate (e.g., we classify a 429 as `upstream_error`), the API returns the wrong HTTP status. **Mitigation:** Unit tests on `classifyOpenAIError()` and similar classifiers, covering every known error type.

## References

- PR #43 review finding #5 (Code Quality Agent): "String-matching error classifier is brittle"
- `lib/pipeline/types.ts` — PipelineError interface
- `lib/api/errors.ts` — Error mapping table
- TypeScript exhaustiveness checking: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking
