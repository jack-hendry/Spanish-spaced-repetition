#!/bin/bash
# Blocks stopping if source files changed but no STATE.md was touched.

# Only enforce when a feature is actively in flight
active=$(grep -rl "Phase:\s*\(plan\|implement\)" specs/*/STATE.md 2>/dev/null)
[ -z "$active" ] && exit 0

changed=$(git status --porcelain 2>/dev/null | awk '{print $2}')
[ -z "$changed" ] && exit 0

code_changed=$(echo "$changed" | grep -v "^specs/" | grep -v "STATE.md")
state_changed=$(echo "$changed" | grep "STATE.md")

if [ -n "$code_changed" ] && [ -z "$state_changed" ]; then
  echo '{"decision": "block", "reason": "Source files changed but no STATE.md was updated. Update the active feature'\''s STATE.md (check off tasks, set next action) before finishing."}'
  exit 0
fi
exit 0