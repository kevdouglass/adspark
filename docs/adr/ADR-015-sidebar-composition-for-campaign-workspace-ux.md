# ADR-015: Sidebar Composition for Campaign Workspace UX

## Status
Proposed

## Context
The existing dashboard sidebar is dedicated to the brief form. Session navigation must be added without disrupting the single-screen workflow that currently works well for authoring and generation.

## Decision
Use the left sidebar for both:
- recent campaign session navigation
- brief editing for the currently selected session

The main canvas remains focused on progress, outputs, and run history.

## Consequences
### Positive
- preserves the current single-screen generation workflow
- avoids introducing a separate route or full-screen session browser
- keeps authoring and navigation close together

### Negative
- sidebar density increases
- requires careful visual hierarchy to avoid crowding

## Mitigation
Keep session list compact and visually secondary to the brief editor.
