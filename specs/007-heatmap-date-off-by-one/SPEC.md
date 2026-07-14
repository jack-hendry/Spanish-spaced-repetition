# SPEC: Heatmap date off-by-one

## Problem

The activity heatmap (`web/src/app/shared/heatmap/`) consistently renders each
study session on the calendar cell **one day after** the date the studying
actually happened. A user who studied on July 13th sees the contribution on
the July 14th ("tomorrow") cell. This is reproducible, not intermittent.

Root cause (numerically confirmed):

- `todayNumber(collection, now)` (`web/src/app/core/collection.store.ts:35-38`)
  computes a day-number as
  `floor((now - collection.created - dayCutoffHour*3600000) / 86400000)`. It
  subtracts the raw `collection.created` epoch (an arbitrary wall-clock
  instant), so the *effective daily rollover* is anchored to `created`'s
  time-of-day plus `dayCutoffHour`, not to the intended local `dayCutoffHour`
  (4am) wall-clock time. In the live store, `created` = 2026-06-24 10:20:35
  local and `dayCutoffHour` = 4, so the effective boundary is ~14:20 local
  each day. A real review at 2026-07-13 16:02 maps to day-number 19.
- `reviewDays` — the data actually fed into the heatmap — is built by mapping
  every `RevlogEntry.reviewedAt` through this same `todayNumber`
  (`web/src/app/features/stats/stats.ts:91-95`,
  `web/src/app/features/deck-list/deck-list.ts:85-88`). By the time
  `buildHeatGrid` (`web/src/app/core/heatmap.ts`) receives `reviewDays`, the
  timestamps have already been collapsed into `todayNumber`-based day-numbers
  whose rollover is ~14:20, not 4am — and each such day-number spans two
  calendar dates (e.g. day 19 covers July 13 14:20 through July 14 14:20).
- Consequently **no fix confined to `heatmap.ts`'s cell-to-day-number mapping
  can be correct**: the calendar-date information a review belongs to is
  already lost upstream, before `buildHeatGrid` ever sees it. A prior draft of
  this spec proposed exactly such a heatmap-only remap and was rejected in
  review for this reason — it cannot recover the true calendar date, and it
  cannot honestly claim a 4am rollover when the diagnosed boundary is ~14:20.

The fix must therefore change what is passed *into* the heatmap: review
timestamps need to be bucketed by local calendar date (honouring
`dayCutoffHour` as a real wall-clock cutoff) independently of the
`created`-anchored `todayNumber` scheme, rather than being pre-collapsed by it.

## Goals

- The heatmap renders each study session on the calendar date on which it
  took place, as the user perceives dates, in the browser's local timezone.
- The `dayCutoffHour` (4am default) rollover is honoured for heatmap bucketing
  the way Anki treats "day start": a review before the cutoff on a given
  calendar date counts toward the *previous* calendar day's cell.
- The bucketing is correct regardless of `collection.created`'s arbitrary
  time-of-day — it must not reproduce the anchoring flaw described above.
- The fix is deterministic and stable in the user's local timezone (not flaky
  across renders or sessions).

## Non-goals (out of scope)

- Redesigning heatmap visuals, layout, colours, or grid/month-label logic.
- Changing `todayNumber` itself, or anything that consumes it for purposes
  other than the heatmap: review-card `due` scheduling, daily new/review
  limits, `dayStreak`/`bestStreak`, and `studiedToday` all keep using the
  existing `created`-anchored `todayNumber` scheme, unchanged. This bug fix
  does not touch scheduling correctness or streak/study-count semantics, even
  though `todayNumber` has the same underlying anchoring quirk elsewhere —
  that is a separate, deferred concern (see Open questions).
- Altering stored card `due` values, `revlog.ndjson` format/contents, or any
  scheduling algorithm (SM-2, FSRS).
- Reworking timezone/DST handling generally — assume the browser's local
  timezone is authoritative, consistent with the rest of the app.
- Changing the server (`server/`) in any way — this is a `web/`-only fix per
  the scheduling-lives-in-frontend architecture; no on-disk shape changes.
- Migrating or backfilling historical data — the fix only changes how
  existing `revlog` timestamps are bucketed for display, not any stored value.

## Requirements (numbered, testable)

R1. The heatmap MUST render a review that occurred on local calendar date D on
    the grid cell for date D — never D-1 or D+1 — for any `collection.created`
    time-of-day, including one well after both midnight and `dayCutoffHour`
    (the exact condition that exposes the current bug, e.g. `created` at
    10:20 local with `dayCutoffHour` = 4).

R2. A review whose local wall-clock time falls before `dayCutoffHour` on a
    given calendar date (e.g. 03:30 with a 4am cutoff) MUST count toward the
    *previous* calendar day's heatmap cell, matching Anki's "day starts at the
    cutoff hour" convention.

R3. The calendar-date bucketing used for the heatmap MUST NOT depend on
    `collection.created`'s time-of-day or epoch value — it must produce
    correct results for any `created` timestamp, not just the specific
    reproduction case.

R4. This fix MUST NOT change `todayNumber`'s behavior, stored card `due`
    values, `revlog.ndjson` contents, or any value seen by other consumers of
    `todayNumber` (review-card scheduling, daily new/review limits,
    `dayStreak`, `bestStreak`, `studiedToday`). Those must be bit-for-bit
    unaffected by this change — verified by their existing tests continuing
    to pass unmodified. Concretely: `reviewDays` (`stats.ts:91-95`,
    `deck-list.ts:85-88`) is the exact signal already shared with
    `dayStreak`/`bestStreak`/`studiedToday`/pace calculations, so it MUST NOT
    be redefined or repurposed. The heatmap MUST instead be fed a distinct,
    separately-computed value derived from calendar-date bucketing of
    `reviewedAt` — `reviewDays` itself stays exactly as it is today.

R5. The heatmap's date bucketing MUST be a pure function of
    (`reviewedAt` timestamps, `dayCutoffHour`, local timezone) — deterministic
    regardless of when or how many times the grid is rendered, and
    independent of `collection.created`.

## Data-flow constraint (binding on the plan)

The correction must happen at or before the point where per-review timestamps
are collapsed into day-buckets for heatmap purposes — i.e., it must change
what `web/src/app/features/stats/stats.ts` and
`web/src/app/features/deck-list/deck-list.ts` compute and pass into
`<app-heatmap>`, and/or what `web/src/app/core/heatmap.ts`'s grid-building
function accepts as input, so that calendar-date cells are keyed from
`RevlogEntry.reviewedAt` via local-calendar-date bucketing — not via
`todayNumber`-derived day-numbers. A change confined to remapping cells
inside `heatmap.ts` alone, without changing what upstream code supplies it,
does not satisfy R1–R3 and must not be treated as a complete fix.

This new calendar-date-bucketed value MUST be a separate signal/property from
`reviewDays`, computed alongside it (not derived from it, since `reviewDays`
has already lost the calendar-date information — see Problem). `reviewDays`
continues to feed `dayStreak`/`bestStreak`/`studiedToday`/pace exactly as
today; only the new signal feeds `<app-heatmap>`. This is required by R4.

## Testing expectations

- `web/src/app/core/heatmap.spec.ts` and/or
  `web/src/app/shared/heatmap/heatmap.spec.ts` must gain a regression test
  that pins a review timestamp to its correct calendar-date cell using a
  `collection.created` whose time-of-day is well after midnight and well
  after `dayCutoffHour` (e.g. 10:20 local, cutoff 4am) — the precise condition
  that exposed this bug. A heatmap-only fix must fail this test; the adopted
  fix must pass it.
- A companion test must cover the pre-cutoff case (R2): a review shortly
  before `dayCutoffHour` lands on the previous calendar day's cell.
- Existing tests for `todayNumber`, streaks, `studiedToday`, and daily limits
  must continue to pass unmodified, demonstrating R4.
- Web tests run via `npm run test -w web`.

## Open questions

1. `todayNumber`'s `created`-anchoring flaw is the true underlying cause and
   also affects streaks/`studiedToday`/scheduling day-numbers in principle,
   not just the heatmap. Fixing that more broadly is a bigger, riskier change
   (it could shift live review-card `due` day-numbers and streak history) and
   is explicitly deferred — left for a future human/plan decision, not this
   fix.
2. Should the new regression tests assert against a fixed/mocked timezone to
   avoid CI-host timezone flakiness, or is local-timezone-only acceptable
   given the app is single-user/local? Left to the planner.
