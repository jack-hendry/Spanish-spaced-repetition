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

The TypeScript lint rollout (`specs/archive/2026-08-31-015-typescript-lint-rollout/`)
is **finished, all four phases (016 audit, 017 web, 018 scheduling, 019
server, 020 full gate) landed and archived** (2026-08-31). Repo-wide
violations 254 → 0; `lint:ci` gates the full repo (`eslint .`). See AD-018
through AD-023, L-011 through L-016.

`specs/010-day-rollover-anchoring/` is **code-complete, not yet archived**
(2026-09-01). `Analyst.md` was rewritten against the current tree, hardened in
two rounds recorded in `CriticReview.md`, and all 8 `tasks.md` steps are done.
`todayNumber` now counts local calendar days from the study day of
`collection.created`; 216 web tests (was 209) and 71 server tests green, build
and `lint:ci` clean, `data/spanish/` and `server/` untouched. See AD-024, L-018.

`specs/STATE.md` was rotated on 2026-09-02 (`state_rotate.py --apply`): AD-019
and AD-020 moved to `specs/STATE-ARCHIVE.md` leaving one-line stubs, 326 -> 287
lines, back under the ~300-line budget.

One thing left: the spec is **not yet archived** — ritual steps 3+4
(`python3 tools/archive_spec.py specs/010-day-rollover-anchoring --apply`)
still to run, together with a `specs/STATE.md` change in the same push.

Format while a run is in progress: `<spec> — step N of M` (see
`specs/TEMPLATE.md`'s `Status:` field convention, AD-016).
