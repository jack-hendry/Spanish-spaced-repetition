# STATE — run marker

**Project memory lives in [`specs/STATE.md`](specs/STATE.md)** — decisions
(`AD-NNN`), blockers (`B-NNN`), lessons (`L-NNN`), quick tasks and phase
status. Put entries there, not here (AD-008).

This file exists for one thing: `.claude/hooks/enforce-haiku-tasks-pretooluse.sh`
greps the **repo root** `STATE.md` for a line of the form

```
  ## Executing: <spec-dir-name>
```

(The example above is **indented by two spaces on purpose.** The hook does
`grep -m1 -E '^## Executing: '` — first match wins — so an unindented example
here shadows every real marker below it: the hook resolves the spec name to the
literal `<spec-dir-name>`, finds no such directory, and exits dormant. That is
what it did in habit_tracker, where this hook was written, from the day the doc
was written until the `habit-detail` run — which is why that repo's B-002
exists. Keep the indent, or the guard silently protects nothing.)

Add that line when starting a `tasks.md` run, and delete it when the run
finishes. Without the marker the hook stays dormant and top-level edits are not
blocked; with a stale marker every direct edit is blocked.

## Current work

`specs/013-server-hardening/` and `specs/014-spec-continuity/` are both
**finished and archived** (`specs/archive/2026-08-27-013-server-hardening/`,
`specs/archive/2026-08-27-014-spec-continuity/`).

`specs/010-day-rollover-anchoring/` is next in line: has `Analyst.md` +
`CriticReview.md`, awaiting `tasks.md`.

Format while a run is in progress: `<spec> — step N of M` (see
`specs/TEMPLATE.md`'s `Status:` field convention, AD-016).

## Executing: 017-lint-phase1-web

Phase 1 of the TypeScript lint rollout — step 6 of 14. Remove this line when
the run finishes.

## Current work

`specs/016-lint-audit/` — Phase 0 of the TypeScript lint rollout — is
**finished**, all 12 steps plus a mid-run Step 4b. Not yet archived. Baseline
recorded in `specs/015-typescript-lint-rollout/INVENTORY.md`; see AD-018,
AD-019, L-011, L-012.

`specs/010-day-rollover-anchoring/` remains next in line.
