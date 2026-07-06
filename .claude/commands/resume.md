---
description: Resume the SDD pipeline from persisted state
---
1. List specs/ and find features where STATE.md phase != done
   (if multiple, ask which one; if $ARGUMENTS names one, use it)
2. Read that feature's STATE.md, SPEC.md, and PLAN.md if present
3. Report current phase and the "Next action" line
4. Execute the next action, following the phase rules in CLAUDE.md