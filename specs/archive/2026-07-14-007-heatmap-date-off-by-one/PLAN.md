# PLAN: Heatmap date off-by-one

## Approach

The heatmap renders each review one calendar day late because review timestamps
are collapsed into `todayNumber`-based day-numbers upstream (`stats.ts`,
`deck-list.ts`) before `buildHeatGrid` ever sees them. `todayNumber` anchors its
daily rollover to `collection.created`'s time-of-day (~14:20 in live data), not
to a 4am wall-clock cutoff, so a review's true calendar date is already lost. No
remap confined to `heatmap.ts`'s cell indexing can recover it (spec Problem).

The fix introduces a **new, distinct signal** — the raw `RevlogEntry.reviewedAt`
epoch-ms values — fed into a rewritten `buildHeatGrid` that buckets them by
**local calendar date honouring `dayCutoffHour` as a real wall-clock cutoff**.
A single pure helper `heatDateKey(ms, dayCutoffHour)` returns the `YYYY-MM-DD`
local-date string of `(ms − dayCutoffHour·3600000)`: a review before the cutoff
shifts back onto the previous calendar day (Anki convention, R2), and the result
never depends on `collection.created` (R3, R5). `buildHeatGrid` builds a count
map keyed by `heatDateKey` over the timestamps, then walks its grid cells and
keys each cell by `heatDateKey` of that cell date's **local noon** (noon − 4h
stays the same date), so the grid-walk and the review buckets share one keying
domain — resolving CRITIQUE.md's carried WARN that the internal
`startDay`/`endDay`/`todayNumber` scan (`heatmap.ts:58-59`) must move off
day-numbers too, not just the inputs.

Key constraint: `reviewDays` (the `todayNumber`-mapped array) stays bit-for-bit
unchanged in both feature components because `dayStreak`/`bestStreak`/
`studiedToday`/pace/`countInRange` all consume it (R4). The heatmap gets a
*separate* `heatTimestamps` signal computed alongside it, not derived from it.
`todayNumber` itself and all its non-heatmap consumers are untouched. Tests build
timestamps with local `Date(y, m, d, …)` constructors so the host timezone
cancels out on both sides of the comparison (open question Q2 — no TZ mocking
needed). Server, stored `due`, `revlog.ndjson`, and schedulers are untouched.
`yearlyHeat` in `core/stats.ts` becomes unused by the heatmap but is left in
place (its own `stats.spec.ts` tests keep passing) — removing it is out of scope.

## Files affected

- `web/src/app/core/heatmap.ts` — add exported pure `heatDateKey` helper (T001);
  rewrite `buildHeatGrid` to take `reviewTimestamps: number[]` and key cells +
  buckets by calendar date, dropping `todayNumber`/`yearlyHeat`/`startDay`/
  `endDay` (T002).
- `web/src/app/core/heatmap.spec.ts` — unit tests for `heatDateKey` (T001);
  rewrite grid tests to pass timestamps, add R1 regression + R2 pre-cutoff (T002).
- `web/src/app/features/stats/stats.ts` — add `heatTimestamps` computed
  (`revlog().map(e => e.reviewedAt)`); leave `reviewDays` unchanged (T003).
- `web/src/app/features/deck-list/deck-list.ts` — add `heatTimestamps` computed;
  leave `reviewDays` unchanged (T003).
- `web/src/app/shared/heatmap/heatmap.ts` — rename input `reviewDays` →
  `reviewTimestamps`, update the `grid` computed's `buildHeatGrid` call (T004).
- `web/src/app/shared/heatmap/heatmap.spec.ts` — update `setInput` name (T004).
- `web/src/app/features/stats/stats.html` — rebind `[reviewTimestamps]="heatTimestamps()"` (T004).
- `web/src/app/features/deck-list/deck-list.html` — rebind `[reviewTimestamps]="heatTimestamps()"` (T004).

## Tasks

### T001 — Pure `heatDateKey` calendar-date helper
Add and export in `core/heatmap.ts`:
`heatDateKey(ms: number, dayCutoffHour: number): string` = the local calendar
date of `new Date(ms - dayCutoffHour * 3600_000)`, formatted `YYYY-MM-DD` with
zero-padded month/day (via `getFullYear`/`getMonth`+1/`getDate`). No use of
`collection`/`todayNumber`/`Date.UTC`. In `heatmap.spec.ts` add a `describe`
with cases (all local-time constructed): a mid-afternoon review
(`new Date(2024,6,13,16,2)`, cutoff 4) → `"2024-07-13"`; a pre-cutoff review
(`new Date(2024,6,13,3,30)`, cutoff 4) → `"2024-07-12"`; a review exactly at
cutoff (`new Date(2024,6,13,4,0)`, cutoff 4) → `"2024-07-13"`; and that
`dayCutoffHour: 0` bucketing equals the plain local date.
Done when: `npm run test -w web` passes with the new `heatDateKey` cases green.
Skills: scheduling-domain, angular-conventions, testing-playbook
Complexity: low

### T002 — Rewrite `buildHeatGrid` to key by calendar date (KEY TASK — addresses carried WARN)
Change signature to `buildHeatGrid(reviewTimestamps: number[], collection, year)`.
Build `counts = Map<string, number>` by calling `heatDateKey(t, collection.dayCutoffHour)`
for each `t`. Remove the `todayNumber`/`cutoffMs`/`startDay`/`endDay`/`yearlyHeat`/
`byDay` block entirely. Walk cells with the existing `cursor` Date from
`gridStart` while `cursor <= gridEnd`; for each cell compute
`key = heatDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 12).getTime(), collection.dayCutoffHour)`
and `count = counts.get(key) ?? 0`. Keep `heatLevel`, `inYear`, week-chunking,
and month-label logic exactly as-is. Drop the now-unused `todayNumber`/`yearlyHeat`
imports. In `heatmap.spec.ts`: update the "maps review days into cell counts"
test to pass `Array(12).fill(new Date(2024,0,1,12).getTime())` and assert the
Jan 1 cell count 12 / level 2. Replace the old regression test with two:
(R1) `collection({ created: new Date(2026,5,24,10,20).getTime(), dayCutoffHour: 4 })`,
a review at `new Date(2024,6,8,15)` → Jul 8 cell count 1, Jul 9 cell count 0
(the old todayNumber-based code fails this because `created`'s 10:20 anchor
pushes it to Jul 9); (R2) a review at `new Date(2024,6,8,3,30)`, cutoff 4 →
Jul 7 cell count 1, Jul 8 cell count 0. Empty-grid/padding/month-count tests keep
passing unchanged (they pass `[]`).
Done when: `npm run test -w web` passes including both new grid tests; no
reference to `todayNumber` or `yearlyHeat` remains in `heatmap.ts`.
Skills: scheduling-domain, angular-conventions, testing-playbook
Complexity: medium

### T003 — Add `heatTimestamps` signals to both feature components (keep `reviewDays` intact)
Pure additions — no template edits in this task, so the app keeps compiling
against the still-named `[reviewDays]` binding. In `features/stats/stats.ts` add
`readonly heatTimestamps = computed<number[]>(() => this.revlog().map((e) => e.reviewedAt))`;
in `features/deck-list/deck-list.ts` add the identical computed. Do NOT change
`reviewDays`, `today`, `dayTimes`, or any streak/count/pace computed in either
file. Both `.html` templates are left untouched (still binding `[reviewDays]`)
until T004.
Done when: `npm run test -w web` passes; both components compile; `reviewDays`
computeds are byte-for-byte unchanged (diff shows only the two added signals).
Skills: angular-conventions, testing-playbook
Complexity: low

### T004 — Atomically rename the Heatmap input and rewire both consumers
This single task changes the component input and BOTH template bindings together,
so the templates never reference a stale input name (avoids an NG8002 mid-task
compile break). In `shared/heatmap/heatmap.ts` rename
`reviewDays = input.required<number[]>()` to
`reviewTimestamps = input.required<number[]>()` and update the `grid` computed to
call `buildHeatGrid(this.reviewTimestamps(), this.collection(), this.year())`
(tooltip/legend/month rendering untouched). In `heatmap.spec.ts` change
`setInput('reviewDays', …)` to `setInput('reviewTimestamps', …)`; existing render
assertions stay as-is. In `stats.html` rebind the heatmap tag to
`<app-heatmap [reviewTimestamps]="heatTimestamps()" [collection]="collection()" [year]="year" />`,
and in `deck-list.html` to
`<app-heatmap [reviewTimestamps]="heatTimestamps()" [collection]="collection()" [year]="selectedYear()" />`.
Done when: `npm run test -w web` passes; Heatmap, Stats, and Dashboard all
compile with the renamed input and the new bindings; no `[reviewDays]` binding or
`reviewDays` input remains on `<app-heatmap>`.
Skills: angular-conventions, testing-playbook
Complexity: low

## Testing strategy

- **R1** (review on date D renders on D for any `created` time-of-day): T002's
  R1 regression test — `created` at 10:20 local, cutoff 4, review Jul 8 3pm lands
  on Jul 8, not Jul 9. Fails against a heatmap-only remap; passes with the fix.
- **R2** (pre-cutoff → previous day): T002's R2 test — review at 03:30 with 4am
  cutoff lands on the previous calendar cell; plus T001's `heatDateKey` pre-cutoff
  and at-cutoff unit cases.
- **R3 / R5** (independent of `created`, deterministic pure function): T001
  proves `heatDateKey` takes no collection/`created` and no `Date.now`; T002
  proves `buildHeatGrid` no longer references `todayNumber`/`created`.
- **R4** (`todayNumber`, streaks, `studiedToday`, `due`, revlog unchanged): T004
  and T005 add a parallel signal and leave `reviewDays` untouched; existing
  `collection.store`/`stats` (`dayStreak`, `bestStreak`, `studiedToday`,
  `yearlyHeat`) specs continue to pass **unmodified**, which is the evidence.
- All verification via `npm run test -w web`. Tests use local `Date(y,m,d,…)`
  constructors so host timezone cancels on both sides (open question Q2 resolved:
  local-timezone-only, no mocking).

## Open questions
- None blocking. Q1 (broader `todayNumber` `created`-anchoring flaw affecting
  streaks/scheduling) remains explicitly deferred per spec — not touched here.
