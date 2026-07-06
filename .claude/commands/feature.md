---
description: Start a new feature through the SDD pipeline
---
Start the SDD pipeline for: $ARGUMENTS

1. Create specs/{NNN}-{slugified-name}/ (next available number)
2. Initialize STATE.md from the template with phase=specify
3. Delegate to the spec-writer subagent to produce SPEC.md
4. When SPEC.md is done, update STATE.md (spec complete, phase=plan,
   next action: "review spec, then run planner")
5. STOP and ask the user to review SPEC.md before continuing