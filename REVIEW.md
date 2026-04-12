# Code Review Rules — AdSpark

These rules are enforced by Claude Code during code reviews.
Violations are flagged with severity levels.

## CRITICAL (Must Fix)

- **Domain layer imports framework code** — Domain must be pure business logic with zero framework dependencies
- **Business logic in UI components** — Extract to hooks/services
- **Untyped data crossing boundaries** — All API responses and user inputs must be validated/typed
- **Secrets in source code** — API keys, tokens must use environment variables
- **XSS vectors** — No `dangerouslySetInnerHTML` without sanitization, no unsanitized user input in DOM
- **Missing error handling on async operations** — Every Promise/async must handle rejection

## WARNING (Should Fix)

- **`any` type without justification** — Use `unknown` + type guards instead
- **Missing loading/error states** — Every async UI operation needs loading, success, and error states
- **Unnecessary re-renders** — Components receiving unstable references (new objects/arrays/functions on each render)
- **Missing accessibility** — Interactive elements without ARIA labels, keyboard handlers, or focus management
- **Generic error messages** — Users deserve helpful error messages, not "Something went wrong"
- **Missing cleanup in useEffect** — Subscriptions, timers, event listeners must be cleaned up

## SUGGESTION (Nice to Have)

- **Could use a more specific type** — `string` where a union type would be more precise
- **Long function** — Functions over 40 lines should be considered for extraction
- **Missing test** — New logic without corresponding test coverage
- **Magic numbers** — Use named constants
- **Deep nesting** — More than 3 levels of nesting; consider early returns or extraction
