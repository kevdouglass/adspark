#!/usr/bin/env bash
# stop-summary.sh — Stop hook
# Reminds the agent to update ACTION-TRACKER.md at session end.

echo "SESSION_END: Remember to update ACTION-TRACKER.md with current state."
echo "  - Mark completed tasks as Done"
echo "  - Update 'Next action' line"
echo "  - Note any blocked items"
exit 0
