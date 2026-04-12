# ADR Creation — Architecture Decision Record Workflow

**Persona:** Staff Engineer
**Purpose:** Document significant architectural decisions with context, alternatives, and consequences.

## When to Create an ADR

- Choosing a framework, library, or tool
- Defining a data model or API contract
- Selecting an architectural pattern
- Making a trade-off that future developers need to understand
- Any decision that took more than 15 minutes of deliberation

## Template

Save to `docs/adr/ADR-NNN-short-title.md`:

```markdown
# ADR-NNN: Short Title

**Status:** Accepted | Proposed | Deprecated | Superseded by ADR-XXX
**Date:** YYYY-MM-DD
**Decision Makers:** [names]

## Decision

[1-2 sentences: what we decided. Put this FIRST — busy readers get the answer immediately.]

## Context

[What problem are we solving? What constraints exist? What triggered this decision?]

## Options Considered

### Option A: [Name]
- **Pros:** ...
- **Cons:** ...

### Option B: [Name]
- **Pros:** ...
- **Cons:** ...

### Option C: [Name] (if applicable)
- **Pros:** ...
- **Cons:** ...

## Consequences

### Positive
- ...

### Negative
- ...

### Risks
- ...

## References
- [links to docs, discussions, benchmarks]
```

## Numbering

- Sequential: ADR-001, ADR-002, etc.
- Never reuse numbers, even for deprecated ADRs
