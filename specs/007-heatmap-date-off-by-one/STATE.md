# STATE: 007-heatmap-date-off-by-one

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** none
- **Last updated:** 2026-07-14

## Original request
> @web/src/app/shared/heatmap/  I studied today july 13th, the headmap is showing that I studied for tomorrow.  This is happening
>   consistently, why does this keep happening? I want it to display for the date on which studying took place

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] Reviewed & verified (drift audit: PASS WITH NOTES, 0 blockers)

## Tasks
- [x] T001 (low): Pure `heatDateKey` calendar-date helper (core/heatmap.ts + spec)
- [x] T002 (medium): Rewrite `buildHeatGrid` to key by calendar date — KEY TASK, addresses carried WARN (core/heatmap.ts + spec)
- [x] T003 (low): Add `heatTimestamps` signals to Stats + Dashboard, keep `reviewDays`, no template edits (features/stats/, features/deck-list/)
- [x] T004 (low): Atomically rename Heatmap input `reviewDays`→`reviewTimestamps` and rewire both templates (shared/heatmap/ + spec, stats.html, deck-list.html)

## Decisions log
- New signal is the raw `reviewedAt` epoch-ms array (`heatTimestamps`), distinct
  from `reviewDays` (unchanged, R4). `buildHeatGrid` now takes timestamps and
  buckets them by local calendar date via `heatDateKey(ms, dayCutoffHour)`
  (= local date of `ms − cutoff·3600000`, Anki pre-cutoff convention).
- Grid cells key by `heatDateKey(local-noon of cell date)` so the internal
  grid-walk shares the review keying — resolves the carried WARN (no more
  `todayNumber`/`startDay`/`endDay`/`yearlyHeat` inside `buildHeatGrid`).
- Tests build timestamps with local `Date(y,m,d,…)` so host TZ cancels — no TZ
  mocking (open Q2 resolved local-only).
- `yearlyHeat` left in `core/stats.ts` (unused by heatmap now but keeps its own
  tests green); removal out of scope.

## Discovered
- Root cause (reproduced numerically): `todayNumber()` in `web/src/app/core/collection.store.ts`
  anchors the daily rollover to `collection.created`'s time-of-day plus `dayCutoffHour`.
  With `created` = 2026-06-24 10:20:35 local and `dayCutoffHour` = 4, the effective day
  boundary is ~14:20 local, NOT 4am. A review at 2026-07-13 16:02 -> todayNumber = 19.
  The heatmap (`core/heatmap.ts`) maps each calendar cell via local-midnight + cutoffMs
  (-> 04:00), giving the July 13 cell day-number 18 and July 14 cell day-number 19, so the
  review lands on the July 14 ("tomorrow") cell.
- Blast-radius note: `todayNumber` also drives review-card due days, daily new/review limits,
  streaks, studiedToday. Those are internally consistent (all use the same function), so the
  visible desync is only where a calendar date is mapped to a day-number - i.e. the heatmap.
- Deferred (open Q1): broader `todayNumber` `created`-anchoring fix — NOT in scope here.

## Next action
Feature complete. Drift-audit critic (mode=drift) returned PASS WITH NOTES, 0 blockers:
R1-R5 all genuinely satisfied (verified against the actual diff, not just claims);
`reviewDays` confirmed byte-for-byte unchanged and still exclusively feeds
dayStreak/bestStreak/studiedTodayCount/pace; no `todayNumber`/`yearlyHeat` reference
remains in `core/heatmap.ts`; no `reviewDays` input/binding remains on `<app-heatmap>`;
diff matches PLAN.md's file list exactly. One WARN (stale doc comment in deck-list.ts
claiming `<app-heatmap [reviewDays]>`) was fixed directly post-audit; re-ran
`npm run test -w web` — 177/177 still green. `yearlyHeat` in core/stats.ts is now dead
for the heatmap but its removal remains explicitly out of scope (still used by its own
tests). Nothing further required for this feature; user may still want to run
/code-review and /verify manually per usual practice.

## Blockers
(none)
