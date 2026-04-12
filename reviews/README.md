# Review History — AdSpark

> Every code review run is preserved here. Comparing runs on the same ticket
> shows iterative improvement and agent learning over time.

## Directory Convention

```
reviews/
  {ticket-id}/
    run-{NNN}_{YYYY-MM-DDTHH-MM}/
      manifest.json              # Machine-readable metadata
      architecture.md            # Agent findings
      code-quality.md
      pipeline-ai.md
      orchestrator-synthesis.md  # Cross-agent dedup + verdict
```

- **ticket-id**: `ADS-000` for scaffold, `ADS-001`+ for features
- **run-NNN**: Zero-padded sequential per ticket. `run-001` = first, `run-002` = after fixes
- **timestamp**: ISO date with hyphens (path-safe, no colons)

## How Agents Use This

- `/review` pipeline writes reports here after each run
- Agents read `manifest.json` to compare finding counts across runs
- `orchestrator-synthesis.md` captures cross-agent consensus + lessons learned
- Git history on this directory = the full audit trail

## Progression Tracking

Watch for across runs:
1. **C/W/S trend**: Finding counts should decrease. If they increase, the fix broke something.
2. **Cross-agent consensus**: Same issue from 2+ agents = highest signal. Should disappear after fix.
3. **Verdict arc**: REQUEST_CHANGES → NEEDS_DISCUSSION → APPROVE is healthy.
4. **New findings**: Run-002 should have *different* findings (not the same ones unfixed).

---

## Review Log

### ADS-000 — Project Scaffold

| Run | Date | Agents | Verdict | C | H | M | L | Delta |
|-----|------|:------:|---------|:-:|:-:|:-:|:-:|-------|
| [run-001](ADS-000-scaffold/run-001_2026-04-11T15-30/) | 2026-04-11 | Arch, Pipeline, CodeQuality | REQUEST_CHANGES | 5 | 7 | 10 | 7 | baseline |
| [run-002](ADS-000-scaffold/run-002_2026-04-11T18-30/) | 2026-04-11 | Arch, Pipeline, CodeQuality | **APPROVE** (92%) | 0 | 0 | 0 | 3 | **-26 findings (90% reduction)** |
