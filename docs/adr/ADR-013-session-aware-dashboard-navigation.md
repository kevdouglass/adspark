# ADR-013: Session-Aware Dashboard Navigation

## Status
Proposed

## Context
The current dashboard behaves like a single transient generation workspace. Users can generate creatives, but they cannot browse or reopen previous campaign sessions from the presentation layer.

## Decision
Adopt a session-aware dashboard model:
- left sidebar lists recent campaign sessions
- one selected session is active at a time
- the selected session hydrates the brief editor and output canvas
- generation occurs in the context of the selected session

## Consequences
### Positive
- makes the product feel like a reusable workspace instead of a one-shot generator
- aligns better with real campaign iteration workflows
- creates a clear home for session persistence and run history

### Negative
- adds navigation and state complexity
- can distract from Adobe take-home MVP if over-emphasized

## Mitigation
Present this as a post-MVP product evolution, not a core assignment requirement.
