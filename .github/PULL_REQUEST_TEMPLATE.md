## What
<!-- 1-3 sentences: what does this PR do and why? -->


## How
<!-- Technical approach: what changed, trade-offs, alternatives considered. -->
<!-- For multi-file changes, group by layer: Domain -> Data -> Presentation -> UI -->


## Breaking Changes
<!-- Delete this section if N/A. -->
- **Breaking:** No

## PR Checklist

### Code Quality
- [ ] Self-reviewed the diff — no debug code, no commented-out blocks, no `TODO` without reference
- [ ] TypeScript strict mode — no `any` escape hatches without comment
- [ ] Clean architecture layers respected (domain has zero framework imports)
- [ ] Linter passes (`npm run lint`)
- [ ] Type check passes (`npm run type-check`)

### Testing
- [ ] Tests added/updated for changed logic
- [ ] `npm run test` passes locally
- [ ] Edge cases covered (null, empty, boundary values, error paths)

### UI / Accessibility *(delete if no UI changes)*
- [ ] Keyboard navigation works for all interactive elements
- [ ] Screen reader tested (or ARIA labels verified)
- [ ] Responsive across viewport sizes (mobile, tablet, desktop)
- [ ] Color contrast meets WCAG AA (4.5:1 for text)
- [ ] No hardcoded colors/fonts — uses design tokens
- [ ] Before/After screenshots attached

### Performance
- [ ] No unnecessary re-renders (React DevTools profiler checked)
- [ ] Images optimized (WebP, lazy loading where appropriate)
- [ ] No blocking operations on the main thread
- [ ] Bundle size impact checked

### Security
- [ ] No API keys, tokens, or secrets in committed code
- [ ] No PII logged to console
- [ ] Input validation at system boundaries
- [ ] XSS prevention (no `dangerouslySetInnerHTML` without sanitization)

## Media
<!-- Required for UI changes. Before/After screenshots or recordings. -->

| Before | After |
|:------:|:-----:|
| <!-- screenshot --> | <!-- screenshot --> |

## Test Plan
<!-- Steps a reviewer can follow to verify the change. -->

```bash
npm run test
```
