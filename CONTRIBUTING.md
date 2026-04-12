# Contributing to AdSpark

## Prerequisites

- Node.js 20+ (LTS)
- npm or pnpm
- Git
- GitHub CLI (`gh`) authenticated
- Claude Code CLI (for `/review` and agent workflows)

## Development Workflow

### 1. Branch

```bash
git checkout -b feat/<description>
```

Branch types: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`

### 2. Develop

```bash
npm run dev          # Start dev server
npm run test         # Run tests
npm run lint         # Run linter
npm run type-check   # TypeScript strict mode check
```

### 3. Commit (Conventional Commits)

```
feat(generator): add AI prompt builder for ad copy

Implements the prompt construction pipeline that takes campaign
briefs and generates structured prompts for the AI model.
```

**Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`
**Scope:** feature or module name
**Header:** max 72 chars, imperative present tense, lowercase, no period

### 4. Push & PR

```bash
git push -u origin feat/<description>
gh pr create --title "feat(generator): add AI prompt builder" --body "..."
```

Use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.

### 5. Review

```bash
claude
# Type: /review
```

The multi-agent review pipeline will analyze the PR and post findings as GitHub comments.

### 6. Merge

Squash merge to `main` after review approval.

## Code Standards

### TypeScript
- Strict mode enabled — no `any` without justification
- Prefer `interface` over `type` for object shapes
- Use `const` by default, `let` only when mutation is needed
- Explicit return types on exported functions
- No barrel exports (`index.ts` re-exports) — import directly

### Components
- Functional components only
- Props interfaces named `{ComponentName}Props`
- Use composition over inheritance
- Extract logic into custom hooks
- Accessible by default (ARIA labels, keyboard navigation)

### Testing
- Co-locate test files: `Component.test.tsx` next to `Component.tsx`
- Given/When/Then structure
- Test behavior, not implementation
- Mock at boundaries (API calls, external services)

### Error Handling
- Never swallow errors silently
- Use typed error classes for domain errors
- Display user-friendly messages, log technical details
- Validate at system boundaries (user input, API responses)

## Architecture Rules

- Domain layer has zero framework dependencies
- Data layer implements domain interfaces
- UI components never contain business logic
- State management sits in the presentation layer
- Keep components small and focused (< 150 lines)
