# ADR-014: Separate Session State from Generation State

## Status
Proposed

## Context
The existing UI already has pipeline-progress state. Adding session selection, session hydration, and run history directly into the same state container would create a high-risk, overloaded UI state model.

## Decision
Keep two distinct state domains:
- session state: list, selection, session detail, run history
- generation state: in-flight request lifecycle, current progress, transient generation UI

## Consequences
### Positive
- clearer responsibilities
- easier testing
- easier recovery from partial UI failures

### Negative
- more hooks and coordination points
- slightly more boilerplate

## Mitigation
Keep session hooks small and purpose-specific.
