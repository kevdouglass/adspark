# Review Toolkit — Quick Setup

## What This Is

A portable, local-first multi-agent code review pipeline powered by Claude Code. Run `/review` in any project to get expert-level code reviews posted as GitHub PR comments with full HTML reports.

## Prerequisites

- **Claude Code** CLI installed and authenticated
- **GitHub CLI** (`gh`) authenticated with repo access
- **Python 3.10+** (for the learning loop scripts)
- A GitHub repository with at least one open PR

## Installation

### 1. Copy files into your project

```bash
# From your project root:
cp -r /path/to/review-toolkit/.claude .
cp -r /path/to/review-toolkit/.review-prompts .
cp -r /path/to/review-toolkit/.review-reports .
cp -r /path/to/review-toolkit/scripts .
cp /path/to/review-toolkit/review-config.yml .
```

Or copy the entire toolkit and remove what you don't need:
```bash
cp -r /path/to/review-toolkit/* /path/to/review-toolkit/.* your-project/
```

### 2. Customize your agent team

Edit `review-config.yml` to define your agents. Each agent maps to a prompt file in `.review-prompts/{name}.md`.

**Example: Adding a React UI agent**

```yaml
# review-config.yml
agents:
  architecture:
    activation: always
  code-quality:
    activation: always
  ui:
    activation: auto
    description: "React components, hooks, accessibility, state management"
    file_patterns:
      - "src/components/**"
      - "**/*.tsx"
      - "**/*.css"
```

Then create `.review-prompts/ui.md`:
```markdown
# UI Agent

You are the **UI Agent** — a senior React/frontend engineer reviewing this PR.

## Focus Areas
1. Component design and composition
2. Hook correctness (rules of hooks, dependency arrays)
3. Accessibility (ARIA, keyboard navigation, screen readers)
4. State management (unnecessary re-renders, prop drilling)
5. CSS/styling consistency
```

### 3. Update .gitignore

Add to your project's `.gitignore`:
```
.review-reports/PR-*.html
.review-reports/pr-findings/pr-*.json
.review-reports/agent-metrics.json
```

**Keep committed**: `.review-reports/review-knowledge.json` (the learning state).

### 4. Run your first review

```bash
claude
# Then type: /review
```

## File Structure

```
your-project/
├── .claude/commands/review.md     # /review slash command
├── .review-prompts/
│   ├── _personality.md            # Shared personality (all agents)
│   ├── _output-format.md          # Shared output format (all agents)
│   ├── architecture.md            # Architecture agent prompt
│   ├── code-quality.md            # Code quality agent prompt
│   ├── orchestrator.md            # Synthesis agent prompt
│   └── {your-agents}.md           # Add your own agents here
├── .review-reports/
│   ├── review-knowledge.json      # Persistent knowledge graph (committed)
│   ├── agent-metrics.json         # Per-agent quality metrics
│   ├── pr-findings/               # Per-PR findings ledgers
│   └── PR-*-*.html                # Generated HTML reports (gitignored)
├── scripts/review-feedback/
│   ├── reconcile_pr_feedback.py   # Reconcile PR outcomes
│   └── promote_lessons.py         # Promote lessons to knowledge graph
└── review-config.yml              # Agent team, models, thresholds
```

## The Learning Loop

The pipeline learns from past reviews:

1. **During review**: Agents produce findings + proposed lessons
2. **After PR merge**: Run reconciliation to track which findings were fixed
3. **Promotion**: Validated lessons are promoted into the knowledge graph
4. **Next review**: The knowledge graph is injected into agent prompts

### Manual reconciliation (local)

```bash
# After a PR is merged:
PR_NUMBER=5 GITHUB_REPOSITORY=owner/repo python scripts/review-feedback/reconcile_pr_feedback.py
PR_NUMBER=5 python scripts/review-feedback/promote_lessons.py
```

The `/review` command also updates the knowledge graph inline after each review.

## Modes

| Mode | What it does |
|------|-------------|
| **Full Review** | Fetch PR, run all agents, post to GitHub, generate HTML, open browser |
| **Respond** | Read developer replies on PR, route to the right agent, post responses |
| **Status** | Show open/resolved threads and overall verdict |
