---
description: Resume the SDD pipeline from persisted state
argument-hint: [feature-name (optional)]
---

## Step 1: Locate the active feature

If $ARGUMENTS names a feature, use specs/{that-feature}/.

Otherwise:
- Glob specs/*/STATE.md
- Read the "Phase" line of each
- If exactly one has phase != done, use it
- If multiple are in flight, list them (name, phase, current task) and
  ask the user which to resume — do not guess
- If none are in flight, tell the user there's nothing to resume and
  suggest /feature to start one

## Step 2: Load context

Read, in this order:
1. specs/{feature}/STATE.md
2. specs/{feature}/SPEC.md
3. specs/{feature}/PLAN.md (if it exists)

Report back to the user in 2-3 lines: feature name, current phase,
current task, and the "Next action" line verbatim from STATE.md.
Do not proceed past this report if STATE.md is missing, contradictory,
or the "Next action" line is empty — surface that as a blocker instead
of guessing what to do.

## Step 3: Route by phase

- **phase = specify** → guard first: if SPEC.md already exists and is
  non-empty, the spec was written but the phase was never advanced.
  Do NOT overwrite it — set phase=plan, check off "Spec written",
  report the inconsistency, and STOP for human review of the existing
  spec. Only when no spec exists, delegate to spec-writer subagent.
  On completion: update STATE.md (phase=plan, check off "Spec written",
  next action: "review SPEC.md, then /resume to run planner").
  STOP for human review.

- **phase = plan** → the human running /resume past the spec gate IS
  the approval: check off "Spec approved (human)" in STATE.md, then
  delegate to planner subagent.
  On completion: update STATE.md (phase=implement, next action:
  "review PLAN.md, then /resume to start T001"). STOP for human review.

- **phase = implement** → if "Plan approved (human)" is unchecked,
  check it off now (running /resume past the plan gate is the
  approval). Then delegate to implementer subagent for exactly
  ONE task (the first unchecked T00X in STATE.md). Never batch tasks
  in a single /resume call.
  On completion:
    - If tasks remain: report progress, update "Next action" to name
      the next task, and ask the user whether to continue or stop here.
    - If all tasks are checked: set phase=done, write a short summary
      of what was built into STATE.md, and tell the user the feature
      is complete.

- **phase = done** → report that this feature is already complete;
  ask if the user wants to start a new one with /feature.

## Step 4: Always re-verify state before finishing

Before ending the turn, confirm STATE.md reflects whatever just
happened. This is enforced by the check-state-updated hook, but treat
it as your own responsibility, not just something the hook catches.