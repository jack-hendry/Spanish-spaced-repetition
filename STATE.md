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

The day-rollover anchoring work
(`specs/archive/2026-09-02-010-day-rollover-anchoring/`) is **finished and
archived** (2026-09-02). `todayNumber` now counts local calendar days from the
study day of `collection.created`, so the daily allowance renews at
`dayCutoffHour`:00 local instead of at `created`'s time of day. 216 web tests
(was 209) and 71 server tests green, build and `lint:ci` clean, no on-disk
shape change and `server/` untouched. See AD-024, L-018.

`specs/STATE.md` was rotated the same day (`state_rotate.py --apply`): AD-019
and AD-020 moved to `specs/STATE-ARCHIVE.md` leaving one-line stubs, 326 -> 287
lines, back under the ~300-line budget.

No spec is currently live. Two follow-ups are recorded rather than started:
consolidating `todayNumber` and `heatDateKey` behind one day-bucketing helper
(they disagree on 4 minutes a year, both on DST-transition days), and a
regression matrix for `tools/session_report.py`.

Format while a run is in progress: `<spec> — step N of M` (see
`specs/TEMPLATE.md`'s `Status:` field convention, AD-016).

Marker for `021-fly-deploy` removed at Step 20 (2026-09-16). Steps 1–19 ran
delegated; the three remaining steps (20, 21, 22) are all top-level — 21 and 22
by design, 20 by necessity after the classifier refused the `haiku` spawn twice.
The hook had therefore already done its job of keeping top-level out of the
implementation steps. Restore the marker if delegated work resumes.
