# /adspark — Project Entrypoint

You are resuming work on the **AdSpark** project — Creative Automation for Social Ad Campaigns (Adobe FDE take-home assessment).

## On Start

1. Read `ACTION-TRACKER.md` to understand current state
2. Read `knowledge-base/03-status/CURRENT-STATUS.md` for project phase
3. Run `git status` and `git log --oneline -5` to check code state
4. Check for any open PRs: `gh pr list --state open --limit 5`

## Present to User

Display a brief status summary:

```
AdSpark — Creative Automation for Social Ad Campaigns
Phase: [current phase]
Branch: [current branch]
Last commit: [hash + message]

Active tasks:
  [list from ACTION-TRACKER]

Blocked:
  [list blocked items]

Next action: [from ACTION-TRACKER]
```

Then ask: "What would you like to work on?"

## Context Awareness

- **Deadline:** 2026-04-11 (Saturday EOD) — prioritize ruthlessly
- **Assessment focus:** Clean code, AI integration, system design, demo-ability
- **Review pipeline:** Available via `/review` — use it before submission
- **Key files:** CLAUDE.md (rules), ACTION-TRACKER.md (state), knowledge-base/HOME.md (context)
