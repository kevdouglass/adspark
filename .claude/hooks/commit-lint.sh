#!/usr/bin/env bash
# commit-lint.sh — Pre-Bash hook
# Validates conventional commit messages before git commit runs.
# Only intercepts "git commit" commands; passes everything else through.

COMMAND="$CLAUDE_BASH_COMMAND"

# Only lint git commit commands
if [[ "$COMMAND" != *"git commit"* ]]; then
  exit 0
fi

# Extract commit message from -m flag
MSG=$(echo "$COMMAND" | grep -oP '(?<=-m\s["\x27])[^"\x27]+')

if [[ -z "$MSG" ]]; then
  # Might be using heredoc or other format — let it through
  exit 0
fi

# Validate conventional commit format
PATTERN='^(feat|fix|refactor|perf|test|docs|build|ci|chore)(\([a-zA-Z0-9._-]+\))?: .{1,72}'

if ! echo "$MSG" | head -1 | grep -qP "$PATTERN"; then
  echo "COMMIT_LINT: Message does not match conventional commits format."
  echo "Expected: <type>(<scope>): <summary>"
  echo "Types: feat, fix, refactor, perf, test, docs, build, ci, chore"
  echo "Got: $MSG"
  exit 1
fi

exit 0
