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

`specs/010-day-rollover-anchoring/` — the only live spec. Converted to the
Analyst/tasks/CriticReview shape during the harness migration (AD-009); it has
`Analyst.md` + `CriticReview.md` and is awaiting `tasks.md`.
