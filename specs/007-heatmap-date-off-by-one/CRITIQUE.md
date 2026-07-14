# CRITIQUE: 007-heatmap-date-off-by-one
- **Mode:** drift
- **Date:** 2026-07-14
- **Verdict:** PASS WITH NOTES

## Findings

1. **[WARN]** Stale doc comment left behind after T004's rename: `web/src/app/features/deck-list/deck-list.ts:84` still reads
   `/** Public: fed directly into \`<app-heatmap [reviewDays]>\`. */` above the `reviewDays` computed — the binding it describes
   was renamed to `[reviewTimestamps]` in `deck-list.html` (which now feeds `heatTimestamps`, not `reviewDays`). The comment is
   factually wrong post-fix and will mislead the next reader into thinking `reviewDays` still drives the heatmap. `stats.ts` has
   no equivalent comment, so this is an inconsistency introduced by an incomplete rename, not a pre-existing convention. Doc-only
   risk, but worth fixing before merge.

2. **[NIT]** `core/stats.ts`'s `yearlyHeat` is confirmed unused by the heatmap post-fix (no reference to it or `todayNumber`
   remains in `core/heatmap.ts`), matching STATE.md's Decisions log claim that its removal was deliberately deferred as
   out of scope — consistent with PLAN.md, not a problem.

## Verification performed

- `git diff main --stat`: exactly the 8 files PLAN.md's "Files affected" list named — no untouched planned files, no
  out-of-plan files touched.
- `heatDateKey` (T001) and rewritten `buildHeatGrid` (T002) in `core/heatmap.ts`: confirmed pure, no `Collection`-anchored
  `todayNumber`/`yearlyHeat`/`startDay`/`endDay` references remain (only `heatLevel` imported from `stats.ts`). Grid-cell keying
  uses local-noon-of-cell-date shifted by `dayCutoffHour`, sharing the same `heatDateKey` keying domain as the review buckets —
  matches the plan's stated fix for the carried WARN.
- R4 verified byte-for-byte: `stats.ts`'s and `deck-list.ts`'s `reviewDays` computeds are untouched (`todayNumber(coll,
  e.reviewedAt)` mapping unchanged) and still exclusively drive `dayStreak`, `bestStreak`, `studiedTodayCount`, `pace`,
  `countInRange`, `reviewsByDay`, `displayStreak` — none of those consume the new `heatTimestamps`. Only a new `heatTimestamps`
  computed (`revlog().map(e => e.reviewedAt)`) was added alongside, per R4/T003.
- Grepped the whole `web/` tree: no remaining `reviewDays` input/binding on `<app-heatmap>`; `heatmap.ts`/`heatmap.spec.ts`
  (shared component) fully renamed to `reviewTimestamps`; both `stats.html` and `deck-list.html` rebound in the same commit
  (T004), avoiding the mid-task NG8002 break that the plan-phase CRITIQUE (previously overwritten by this one) had flagged as
  a BLOCKER on an earlier draft plan — the final 4-task plan resolved it by making the rename and both template edits one
  atomic task, and the diff confirms that's exactly what was implemented.
- Independently ran `npm run test -w web`: **177/177 passed (20 files)**, confirming STATE.md's claimed result.
- Read `core/heatmap.spec.ts` in full: the R1 regression test genuinely exercises the bug condition (`created` at 10:20 local,
  `dayCutoffHour` 4, review at 3pm on Jul 8) and asserts Jul 8 gets the count while Jul 9 doesn't — this would fail against the
  old `todayNumber`-based code and against a heatmap-only remap, as intended. The R2 pre-cutoff test (3:30am review, 4am cutoff,
  lands on Jul 7 not Jul 8) is likewise a real behavioural assertion, not a superficial pass-through. `heatDateKey`'s own unit
  tests cover mid-afternoon, pre-cutoff, at-cutoff, and cutoff=0 cases.
- STATE.md's Decisions log and Discovered section accurately describe what happened; no Discovered item was silently dropped —
  Q1 (broader `todayNumber` anchoring fix) is explicitly and consistently deferred in both SPEC.md and STATE.md, not fixed
  inline anywhere in the diff.
- No leftover TODO/FIXME markers in any of the four touched implementation files.

No BLOCKER findings — all five requirements (R1-R5) are satisfied by the diff itself, not just asserted in STATE.md.
