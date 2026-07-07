#!/bin/bash
# Blocks stopping if source files changed but no STATE.md was touched.

# Don't re-block if we already blocked this stop (prevents infinite loops).
input=$(cat)
echo "$input" | grep -q '"stop_hook_active": *true' && exit 0

# Only enforce when a feature is actively in flight
active=$(grep -rlE '\*\*Phase:\*\* *(plan|implement)' specs/*/STATE.md 2>/dev/null)
[ -z "$active" ] && exit 0

# -uall lists untracked files individually (never a collapsed "?? specs/")
changed=$(git status --porcelain -uall 2>/dev/null | cut -c4-)
[ -z "$changed" ] && exit 0

# Harness config (specs/, .claude/, CLAUDE.md) doesn't count as source code,
# nor does the live data store (data/spanish/) the running server writes to.
code_changed=$(echo "$changed" | grep -v '^specs/' | grep -v '^\.claude/' | grep -v '^CLAUDE\.md$' | grep -v '^data/spanish/' | grep -v 'STATE\.md')
state_changed=$(echo "$changed" | grep '^specs/.*STATE\.md')

if [ -n "$code_changed" ] && [ -z "$state_changed" ]; then
  echo '{"decision": "block", "reason": "Source files changed but no STATE.md was updated. Update the active feature'\''s STATE.md (check off tasks, set next action) before finishing."}'
fi
exit 0
