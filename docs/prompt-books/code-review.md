# Code Review — Systematic Review Workflow

**Persona:** Staff Engineer
**Purpose:** Structured PR review across 6 dimensions with severity taxonomy.

## Review Dimensions

### Dim 1: Architecture
- Clean architecture layer boundaries respected
- Dependency direction correct (UI -> Presentation -> Domain <- Data)
- No business logic in UI components
- Proper separation of concerns

### Dim 2: SOLID Principles
- **S**ingle Responsibility — each module/function has one reason to change
- **O**pen/Closed — extensible without modification
- **L**iskov Substitution — subtypes honor parent contracts
- **I**nterface Segregation — no forced dependencies on unused interfaces
- **D**ependency Inversion — depend on abstractions, not concretions

### Dim 3: Code Quality
- TypeScript idioms (generics, utility types, discriminated unions)
- Error handling (typed errors, no swallowed exceptions)
- Naming (descriptive, consistent, conventional)
- Complexity (cyclomatic complexity, nesting depth, function length)

### Dim 4: Performance
- Unnecessary re-renders (React.memo, useMemo, useCallback)
- Bundle size impact
- Async patterns (loading states, error states, race conditions)
- Memory leaks (cleanup in useEffect, event listener removal)

### Dim 5: Security
- Input validation at boundaries
- XSS prevention
- No secrets in code
- No PII in logs
- CORS and CSP considerations

### Dim 6: Accessibility
- ARIA labels on interactive elements
- Keyboard navigation (tab order, focus management)
- Color contrast (WCAG AA: 4.5:1)
- Screen reader compatibility
- Responsive design

## Severity Taxonomy

| Severity | Icon | Definition | Action |
|----------|------|------------|--------|
| **Critical** | :red_circle: | Bug, security hole, architecture violation, data loss risk | Must fix before merge |
| **Warning** | :yellow_circle: | Performance issue, missing edge case, code smell, weak typing | Should fix, discuss if disagree |
| **Suggestion** | :blue_circle: | Style preference, minor optimization, alternative approach | Nice to have, author decides |

## Finding Format

Every finding MUST include:
1. **Severity** + **Confidence** (percentage)
2. **File:Line** — exact location
3. **Description** — what's wrong and WHY (cite principle)
4. **Current Code** — the exact snippet with the issue
5. **Expected Code** — the corrected version (real, runnable code)
6. **Dimension** — which review dimension

## Positive Findings

Every review MUST include a "What's Good" section with 2-3 specific positive callouts showing well-written patterns.
