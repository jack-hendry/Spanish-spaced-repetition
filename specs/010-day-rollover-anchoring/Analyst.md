# SPEC: Day-rollover anchoring in `todayNumber`

## Problem

The daily study allowance does not renew on a calendar-day boundary. The user
studied 20 new cards on 2026-08-14 at 17:55–17:57 local, returned on
2026-08-15 at 10:30 local, and was offered **zero** new cards.

Root cause (numerically confirmed against the live store):

- `todayNumber(collection, now)` (`web/src/app/core/collection.store.ts:35-38`)
  computes `floor((now − collection.created − dayCutoffHour*3600000) / 86400000)`.
  Subtracting the raw `created` **epoch instant** anchors the daily rollover to
  `created`'s time-of-day plus `dayCutoffHour`, not to a fixed local wall-clock
  hour.
- Live values: `collection.created` = 1782310835661 = 2026-06-24 **10:20:35**
  local; `dayCutoffHour` = 4. Effective rollover is therefore **14:20:35 local
  every day**, not 04:00. Confirmed boundaries: day 50 starts 2026-08-13
  14:20:35, day 51 starts 2026-08-14 14:20:35, day 52 starts 2026-08-15 14:20:35.
- The 20 `type: "learn"` revlog entries at 2026-08-14 17:55 fall after that
  day's 14:20:35 boundary, so they tallied into **day 51**. At 2026-08-15 10:30
  `todayNumber` still returns **51**, so `dailyForToday` (`core/daily-limits.ts:13`)
  sees `deck.daily.day === 51 === today` and reports the cap spent.
  `data/spanish/decks.json` confirms both active decks hold
  `daily: {day: 51, newStudied: 20, …}` against `new.perDay = 20`.

Intended behaviour (CLAUDE.md, and real Anki) is a rollover at a fixed local
wall-clock hour — always `dayCutoffHour`:00 local — independent of when the
collection happened to be created.

This is the work explicitly deferred by feature **007-heatmap-date-off-by-one**
(its Open question 1 and its non-goal "changing `todayNumber` itself"). 010
reverses that boundary: this is the one feature permitted to change
`todayNumber`. 007's blast-radius note still holds — every `todayNumber`
consumer is *internally consistent today because they all share the same wrong
function*, which is why the flaw surfaced first as a heatmap date error and now
as a stuck daily cap.

## Goals

- `todayNumber` rolls over at `dayCutoffHour`:00 local wall-clock time on every
  calendar day, for any `collection.created` time-of-day.
- The user's daily new/review allowance renews once per local calendar day.
- Every consumer (study queue, daily limits, unbury, pause-shift, stats,
  streaks, browse due strings, FSRS optimizer histories) inherits the fix
  through the one shared function; none needs its own date logic.
- Already-persisted day numbers on disk are left untouched, with the one-time
  transition effect bounded, understood, and stated up front.

## Non-goals (out of scope)

- Rewriting, migrating, or backfilling any persisted value: `card.due` in
  `cards.json`, `deck.daily` in `decks.json`, `collection.lastUnburyDay`,
  `collection.created`, or `revlog.ndjson`. No data migration, no schema bump.
- Any change to `server/` — no on-disk shape change, so
  `server/src/models/index.ts` and its `web/src/app/core/models/` mirror stay
  identical. Scheduling stays frontend-only.
- Undoing, refactoring, or re-plumbing 007's heatmap work (`heatDateKey`,
  `buildHeatGrid`, the `heatTimestamps` signal, the `reviewTimestamps` input).
  The heatmap is already correct and already independent of `todayNumber`; it
  stays that way. Consolidating the two now-parallel schemes into one helper is
  explicitly deferred.
- Changing SM-2/FSRS math, interval units, `card.due` overloading by queue,
  queue ordering, or per-day limit *policy* (only which integer counts as
  "today" changes).
- Making `dayCutoffHour` user-configurable, non-integer, or per-deck.
- General timezone/DST reform, TZ mocking infrastructure, or a UTC-authoritative
  mode. The browser's local timezone stays authoritative (007's precedent).
- Any user-facing notice/dialog about the one-time transition.

## Requirements (numbered, testable)

R1. `todayNumber(collection, now)` MUST increment exactly at
    `dayCutoffHour`:00:00 local time on each local calendar day. Given
    `created` = 2026-06-24 10:20:35 local and `dayCutoffHour` = 4, the value at
    2026-08-15 03:59 local MUST differ by one from the value at 04:01 local,
    and MUST be equal at 04:01 and at 14:30 local.

R2. `todayNumber`'s result MUST NOT depend on `collection.created`'s
    time-of-day: for two collections whose `created` differ only in time-of-day
    within the same study day, `todayNumber` MUST return the same value for any
    given `now`.

R3. `todayNumber` MUST keep its current signature, purity, and integer
    day-number return type, and MUST remain the single source of day numbers.
    No consumer (`collection.store.ts`, `study-queue.service.ts`,
    `daily-limits.ts`, `pause-shift.ts`, `stats.ts`, `features/stats/stats.ts`,
    `features/deck-list/deck-list.ts`, `features/review/review.ts`,
    `features/browser/browser.ts`, `features/options/options.ts`) may grow its
    own competing date logic.

R4. Day numbers MUST map one-to-one onto local calendar days: across a DST
    transition no day number may be skipped or emitted twice, and every local
    calendar date MUST have exactly one day number. Preferred direction:
    define the day number as a **count of local calendar days** from the study
    date of `created`, not as a fixed 86400000 ms grid.

R5. The fix MUST NOT write to, rewrite, or shift any persisted value.
    Concretely, applying it and loading the app MUST leave `card.due`,
    `collection.created`, and `revlog.ndjson` byte-identical (aside from writes
    caused by the user actually studying). `deck.daily` and
    `collection.lastUnburyDay` may be updated only by their existing
    self-healing paths (stale tally reset; new-day unbury).

R6. The one-time transition is accepted, not migrated, and MUST be bounded as
    follows: for any instant, the new day number differs from the old by at
    most 1. For the live collection at 2026-08-15 10:30 local the value goes
    **51 → 52**. Consequences that MUST be true and acceptable: (a) the stale
    `deck.daily.day = 51` tally is discarded, immediately restoring the new-card
    allowance — the user-visible fix; (b) at most one extra day's worth of
    new/review allowance may be granted on the transition day; (c) review cards
    whose stored `due` equals the new today become available up to 24 h earlier
    than the old boundary would have surfaced them (here ~10 h 20 m earlier,
    once); (d) at most one extra `unburyForNewDay` pass runs. No card's stored
    `due` integer changes, and no review is lost.

R7. Historical day numbers MUST stay coherent: since streaks, `studiedToday`,
    `reviewsByDay`, `countInRange`, and FSRS optimizer histories all re-derive
    day numbers from raw `reviewedAt` epoch-ms at render time, they MUST remain
    contiguous and monotonic after the fix (no gaps or duplicate days
    introduced into `dayStreak`/`bestStreak` for an unbroken study history).

R8. After the fix, `todayNumber` and 007's `heatDateKey(ms, dayCutoffHour)`
    MUST partition the timeline into the same buckets on non-DST-transition
    days: for any timestamp `t`, `todayNumber(coll, t)` increments exactly when
    `heatDateKey(t, coll.dayCutoffHour)` changes date. The heatmap's own inputs
    and behaviour MUST NOT change (007's tests stay green, unmodified).

R9. `pause-shift.ts`'s `dayDelta` MUST remain a difference of two same-scheme
    `todayNumber` calls, so a pause begun before the fix and resumed after it
    still shifts review `due` values by a correct, non-negative whole-day delta.

## Binding constraint (on the plan)

Day numbers exist in two places with different lifetimes: **derived at render
time** from epoch-ms (streaks, forecasts, heat, optimizer histories — these
self-correct) and **persisted on disk** (`card.due` for review cards,
`deck.daily.day`, `collection.lastUnburyDay` — these do not). The plan MUST NOT
introduce any step that rewrites the persisted set to "re-base" them; the
correction is achieved solely by changing where the boundaries fall, and the
resulting ≤1-day reinterpretation of persisted values is the accepted cost
(R6). Equally, the plan MUST NOT add an artificial origin offset to keep
today's integer at 51 — that would preserve the stale `deck.daily.day` match
and leave the reported bug unfixed.

## Testing expectations

- New `web/src/app/core/collection.store.spec.ts` cases pinning R1 and R2,
  built from local `new Date(y, m, d, h, …)` values (host TZ cancels; no TZ
  mocking, per 007's precedent), using the reproduction shape `created` =
  2026-06-24 10:20 local with `dayCutoffHour` = 4. These must fail against the
  current implementation.
- A regression test for the reported symptom: a deck with
  `daily = {day: D, newStudied: 20}` written at 17:55 on calendar day D must
  report a full `newRemaining` when queried at 10:30 the next calendar day
  (`core/daily-limits.ts` + `todayNumber` together).
- An R8 consistency test asserting `todayNumber` boundaries coincide with
  `heatDateKey` date changes.
- Specs that hard-code `created: 0` or `created: Date.now() − 30*86400000` are
  the likely blast radius and must be reviewed, not blindly re-baselined:
  `core/pause-shift.spec.ts` (deltas only — expected to stay green),
  `core/pause.service.spec.ts`, `core/collection.store.spec.ts`,
  `core/study-queue.service.spec.ts`, `features/deck-list/deck-list.spec.ts`,
  `app.spec.ts`, `features/review/review.spec.ts`. Note `created: 0` becomes
  host-TZ-sensitive under calendar-day counting — any test that asserts an
  absolute day number from `created: 0` must be rewritten to use local-date
  construction or to assert a delta.
- Full root `npm run test` green; no `server/` test may need changing (proof
  of the web-only, no-schema-change scope).

## Open questions

1. On DST-transition days, `heatDateKey`'s "subtract `cutoff` absolute hours,
   read local date" convention puts its boundary at local 03:00 or 05:00 rather
   than 04:00. Should `todayNumber` match that quirk exactly (share one helper),
   or be DST-exact at 04:00 and accept a twice-yearly ±1 h divergence from the
   heatmap? Preferred: DST-exact `todayNumber`; document the divergence; do not
   modify `heatDateKey`. Planner to confirm.
2. Should the plan include a one-off verification step that runs the new and old
   formulas over the live `data/spanish/` store and reports the exact per-card
   `due`-vs-today reclassification count before merge, or is R6's bound
   sufficient assurance?
3. Should `scheduling-domain` SKILL.md's "Day numbers" section (which documents
   the current formula verbatim) be updated as part of this feature, or left to
   the critic's end-of-feature lesson pass?
