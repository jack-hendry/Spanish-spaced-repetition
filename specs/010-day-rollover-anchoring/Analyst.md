# Analyst: Day-rollover anchoring in `todayNumber`

**Size:** Large — it changes `todayNumber`, which every `card.due` review
comparison and every per-day limit is measured against (`CLAUDE.md` sizing
rule: anything touching scheduling or `card.due` is at least Large).

> Rewritten 2026-09-01 against the current tree, replacing the 2026-08-26
> conversion of the original `SPEC.md`. Every number below was re-measured
> against today's `data/spanish/`; the previous version's figures (day 51,
> 2026-08-15) are stale. The nine findings in the 2026-08-15 `CriticReview.md`
> are folded in.

## Problem

The daily study allowance does not renew on a calendar-day boundary. It renews
at whatever local wall-clock time the collection happened to be created, plus
`dayCutoffHour`.

`todayNumber(collection, now)` (`web/src/app/core/collection.store.ts:28`) is

```
floor((now − collection.created − dayCutoffHour*3600_000) / 86_400_000)
```

Subtracting the raw `created` **epoch instant** anchors the rollover to
`created`'s time-of-day, not to a fixed local wall-clock hour.

Re-measured live, 2026-09-01 10:30 local (host TZ `America/Toronto`):

- `collection.created` = 1782310835661 = 2026-06-24 **10:20:35** local;
  `dayCutoffHour` = 4. Effective rollover is **14:20:35 local every day**, not
  04:00. Day 68 runs 2026-08-31 14:20:35 → 2026-09-01 14:20:35.
- `data/spanish/decks.json`: deck `dec724d1698056083` holds
  `daily {day: 68, newStudied: 20, reviewStudied: 50}` against
  `opts-default new.perDay = 20`. Deck `dec-listening` holds
  `daily {day: 62, …}` (already stale, so unaffected).
- `collection.lastUnburyDay` = 68.
- The most recent study session ran 2026-09-01 07:15:42 → 08:24:17 local
  (117 revlog entries, 65 of `type: "learn"` over 26 distinct cards). Because
  that is inside day 68's 14:20:35→14:20:35 window, and it is still day 68 at
  10:30, the tally reads as spent. The reported symptom is the same window
  seen from the other side: study after 14:20:35 and return the next morning,
  and `dailyForToday` (`core/daily-limits.ts:13`) still matches the previous
  calendar day's tally, so zero new cards are offered.

Intended behaviour (`CLAUDE.md`, and real Anki) is a rollover at a fixed local
wall-clock hour — `dayCutoffHour`:00 local — independent of when the collection
was created.

This is the work explicitly deferred by **007-heatmap-date-off-by-one** (its
Open question 1 and its non-goal "changing `todayNumber` itself"). 010 reverses
that boundary: this is the one feature permitted to change `todayNumber`. 007's
blast-radius note still holds — every consumer is internally consistent today
*because they all share the same wrong function*, which is why the flaw
surfaced first as a heatmap date error and now as a stuck daily cap.

## Goals (in scope)

- `todayNumber` rolls over at `dayCutoffHour`:00 local wall-clock time on every
  local calendar day, for any `collection.created` time-of-day.
- The daily new/review allowance renews once per local calendar day.
- Every consumer inherits the fix through the one shared function; none grows
  its own date logic.
- Persisted day numbers on disk are left untouched, with the one-time
  transition effect bounded, measured, and stated up front.
- `.claude/skills/scheduling-domain/SKILL.md` is corrected in this feature —
  its "Day numbers" section quotes the old formula verbatim
  (`SKILL.md:36-43`) and its 2026-08-31 auto-appended lesson explains the
  heatmap/`todayNumber` split with a rationale ("comparisons that must respect
  creation time") that this change makes wrong.

## Non-goals (out of scope)

- Rewriting, migrating or backfilling any persisted value: `card.due`,
  `deck.daily`, `collection.lastUnburyDay`, `collection.created`,
  `revlog.ndjson`. No data migration, no schema bump.
- Any change to `server/`. No on-disk shape change, so
  `server/src/models/index.ts` and its `web/src/app/core/models/` mirror stay
  identical. Scheduling stays frontend-only.
- Changing `heatDateKey` / `buildHeatGrid` / the heatmap's inputs. The heatmap
  is already correct and already independent of `todayNumber`; it stays that
  way. Consolidating the two now-parallel day-bucketing schemes into one shared
  helper is deferred (see Discovered).
- Changing SM-2/FSRS math, interval units, `card.due` overloading by queue,
  queue ordering, or per-day limit *policy*. Only which integer counts as
  "today" changes.
- Making `dayCutoffHour` user-configurable, non-integer or per-deck.
- General timezone/DST reform, TZ-mocking infrastructure, or a
  UTC-authoritative mode. The browser's local timezone stays authoritative
  (007's precedent).
- Any user-facing notice about the one-time transition.

## Requirements

R1. `todayNumber(collection, now)` MUST increment exactly at
    `dayCutoffHour`:00:00 local time on each local calendar day. With
    `created` = 2026-06-24 10:20 local and `dayCutoffHour` = 4, the value at
    2026-09-01 03:59 local MUST be one less than at 04:01, and MUST be equal
    at 04:01 and at 14:30.

R2. The result MUST NOT depend on `created`'s time-of-day: two collections
    whose `created` fall on the same study day but at different clock times
    MUST return the same `todayNumber` for every `now`.

R3. The origin MUST be pinned: `todayNumber(coll, t) === 0` for every `t` in
    the study day that contains `coll.created`, and the value MUST be the
    signed count of local study days from that day. (Without this, only R8's
    "differs by at most 1" bound constrains the absolute integer — and that
    integer is compared against every persisted review `card.due`.)

R4. A `created` whose time-of-day is *before* `dayCutoffHour` MUST resolve to
    the **previous** calendar day as day 0. With `created` = 2026-06-24 02:00
    local and `dayCutoffHour` = 4, day 0 is 2026-06-23 04:00 → 2026-06-24
    04:00. (This is not hypothetical: existing specs use `created: 0`, which
    is 1970-01-01 00:00 on a UTC runner — exactly this case.)

R5. Day numbers MUST map one-to-one onto local calendar days: for any run of
    consecutive local calendar dates, `todayNumber` evaluated at the same
    local wall-clock time after the cutoff on each date MUST increase by
    exactly 1 per date, with no skip and no repeat. The test for this MUST
    walk at least a full year of consecutive dates so that on a host with DST
    it genuinely crosses both transitions, and so that on a UTC host it still
    asserts the one-to-one property rather than passing vacuously.

R6. `todayNumber` MUST keep its current signature, purity and integer return
    type, and MUST remain the single source of day numbers. No consumer may
    grow competing date logic. The consumers are exactly these files, and
    `grep -rn 'todayNumber' web/src` is the executable form of this
    requirement: `core/collection.store.ts`, `core/study-queue.service.ts`,
    `core/pause-shift.ts`, `features/options/options.ts`,
    `features/browser/browser.ts`, `features/deck-list/deck-list.ts`,
    `features/review/review.ts`, `features/stats/stats.ts`.
    (`core/daily-limits.ts` and `core/stats.ts` are **not** callers — both take
    `today: number` as a parameter; `core/stats.ts`'s only mention is a
    comment.)

R7. Loading the app and rendering it, with no user action, MUST NOT write,
    rewrite or shift any persisted value. Concretely: no review `card.due`
    integer changes, `collection.created` is untouched, and `revlog.ndjson`
    gains no entry. Two carve-outs, both pre-existing self-healing paths:
    `deck.daily` (stale-tally reset in `dailyForToday`) and
    `collection.lastUnburyDay` (`unburyForNewDay`'s checkpoint advance). The
    resume path (`computeResumeCardUpdates`) legitimately rewrites review
    `card.due`; that is a user action and is governed by R11, not by this
    requirement.

R8. The one-time transition is accepted, not migrated, and MUST be bounded:
    for any instant the new day number differs from the old by at most 1.
    **The two schemes differ only inside a daily window** running from
    `dayCutoffHour`:00 local to `created`'s local time-of-day — here
    04:00:00 → 14:20:35. Inside it the new number is old + 1; outside it the
    two are equal. So the whole transition is a no-op unless the app is first
    loaded inside that window on the day the fix lands, and a verifier who
    opens it at 16:00 will correctly observe nothing. At 2026-09-01 10:30
    local the live collection goes **68 → 69**. Consequences that MUST be
    true and acceptable, all of them once and only inside the window:
    (a) the `deck.daily.day = 68` tally is discarded, restoring the new-card
        allowance — the user-visible fix, and, on this transition day only,
        granting a second 20-card allowance to a user who already studied 20
        this morning;
    (b) at most one extra day's new/review allowance is granted;
    (c) review cards whose stored `due` equals the new today surface early —
        measured on the live store, **84 of 611** review cards (`due <= 68`
        → 86, `due <= 69` → 170). "Early" is bounded by the window width:
        at most 10 h 20 m, and less the later in the window the app is
        opened;
    (d) one extra `unburyForNewDay` pass runs (`lastUnburyDay` 68 < 69).
        `isBuried` (`core/lifecycle.ts:10`) matches `schedBuried` and
        `userBuried`, and the live store holds **78 `schedBuried` cards**, so
        that pass restores 78 cards to their active queues one day early and
        PATCHes 78 cards plus the collection.
    No card's stored `due` integer changes and no review is lost.

R9. Historical day numbers MUST stay contiguous and monotonic. Streaks,
    `studiedToday`, `reviewsByDay`, `countInRange` and the FSRS optimizer
    histories all re-derive day numbers from raw `reviewedAt` epoch-ms at
    render time, so an unbroken study history MUST NOT gain a gap or a
    duplicate day in `dayStreak`/`bestStreak` after the fix.

R10. `todayNumber` and `heatDateKey(ms, dayCutoffHour)` MUST agree on every
     non-DST-transition day: `todayNumber(coll, t)` increments exactly when
     `heatDateKey(t, coll.dayCutoffHour)` changes date. On the two DST
     transition days per year they may place the boundary up to an hour apart
     — `heatDateKey` subtracts `cutoff` *absolute* hours, `todayNumber` will
     shift by *wall-clock* hours. That divergence is accepted and MUST be
     documented; `heatDateKey` MUST NOT change, and 007's tests
     (`core/heatmap.spec.ts`, `shared/heatmap/heatmap.spec.ts`) MUST stay
     green **unmodified**.

R11. `pause-shift.ts`'s `dayDelta` MUST remain a difference of two
     same-scheme `todayNumber` calls, so a pause begun before the fix and
     resumed after it still shifts review `due` by a correct, non-negative
     whole-day delta.

## Binding constraint

Day numbers live in two places with different lifetimes: **derived at render
time** from epoch-ms (streaks, forecasts, heat, optimizer histories — these
self-correct) and **persisted on disk** (review `card.due`, `deck.daily.day`,
`collection.lastUnburyDay` — these do not). The correction is achieved *solely*
by moving where the boundaries fall; the resulting ≤1-day reinterpretation of
persisted values is the accepted cost (R8). Equally, no artificial origin
offset may be added to keep today's integer at 68 — that would preserve the
stale `deck.daily.day` match and leave the reported bug unfixed.

## How we know it is done

- New cases in `web/src/app/core/collection.store.spec.ts` pinning R1–R5,
  built from local `new Date(y, m, d, h, …)` values so the host TZ cancels (no
  TZ mocking — 007's precedent). R1's and R2's cases must fail against the
  current implementation; verify that by stashing the fix, not by assuming it.
- A regression test for the reported symptom: a deck whose
  `daily = {day: D, newStudied: 20}` was written at 17:55 on calendar day D
  reports a full `newRemaining` when queried at 10:30 the next calendar day
  (`core/daily-limits.ts` + `todayNumber` together).
- An R10 consistency test asserting `todayNumber` boundaries coincide with
  `heatDateKey` date changes on ordinary days.
- Blast radius — reviewed, not blindly re-baselined. Specs that build a
  `Collection`: `core/collection.store.spec.ts`, `core/study-queue.service.spec.ts`,
  `core/pause-shift.spec.ts`, `core/pause.service.spec.ts`,
  `core/daily-limits.spec.ts`, `core/stats.spec.ts`, `core/search.spec.ts`,
  `core/heatmap.spec.ts`, `shared/heatmap/heatmap.spec.ts`,
  `features/deck-list/deck-list.spec.ts`, `features/review/review.spec.ts`,
  `app.spec.ts`. The two heatmap specs and `daily-limits`/`stats`/`search`
  (which pass `today` as a plain number) are expected to be untouched — saying
  so explicitly is what makes R10's "unmodified" claim checkable. Any test
  asserting an *absolute* day number derived from `created: 0` must be
  rewritten to construct a local date or to assert a delta.
- `npm run test` green from the repo root: **209 web tests** (current
  baseline) plus the new ones, and the server suite unchanged — no `server/`
  test may need editing, which is the proof of the web-only, no-schema-change
  scope.
- `npm run build` clean and `npm run lint:ci` clean.
- `.claude/skills/scheduling-domain/SKILL.md` no longer quotes the old formula,
  and its 2026-08-31 lesson's rationale is corrected.
- `git status` clean under `data/spanish/` before the closing commit (L-002).

## Open questions

(none — the three the 2026-08-15 review left open are resolved above: DST-exact
`todayNumber` with a documented divergence from `heatDateKey` (R10); the live
reclassification count measured up front rather than deferred to a pre-merge
step (R8c); and the skill correction brought into this feature's scope, since
the critic's end-of-feature pass is append-only and cannot correct a skill body.)

## Discovered

- `specs/STATE.md` lists **L-017 twice** in its `## Lessons` section. Not
  fixed here — scope discipline; belongs in a Quick Task.
- The two day-bucketing schemes (`todayNumber`'s wall-clock shift and
  `heatDateKey`'s absolute-ms shift) will differ by an hour on DST-transition
  days once this lands. Consolidating them behind one helper is a separate,
  Medium task and is deliberately not done here (it would put 007's green
  tests at risk inside a feature whose whole point is elsewhere).

## Retrospective

**Did Analyst.md catch anything not thought about up front?**

Three things, all from the harden rounds rather than the first draft.

1. **The origin was never pinned by a requirement.** The first draft constrained
   only where the day boundaries fell. Which integer is day 0 is compared
   against every persisted review `card.due`, so it is the single degree of
   freedom where a wrong choice silently reinterprets the whole store — and
   nothing in the spec fixed it. It became R3.
2. **The transition only happens inside a window.** Old and new day numbers
   differ *only* between `dayCutoffHour`:00 and `created`'s time-of-day
   (04:00:00–14:20:35 here). Outside it they are equal. Without that stated,
   a verifier opening the app at 16:00 would see none of R8's effects and
   conclude the fix had not landed.
3. **A stated number was simply false.** The draft said the extra
   `unburyForNewDay` pass would restore nothing, from a query written against
   queue names (`buriedSibling`/`buriedUser`) that do not exist in this model.
   `isBuried` matches `schedBuried`, of which the live store holds 78. The
   conclusion survived; the number did not.

**Did anything in tasks.md turn out to be wrong during coding?**

Nothing during coding — because the plan was executed once during planning and
reverted, which is what moved the errors earlier. That trial run is where the
plan's four real defects surfaced: Step 5's `Do` still contained a
self-correction in the prose ("— no, that would discard Step 1"); two steps used
a bare `git diff --name-only` as an acceptance check, which was guaranteed to
fail because it also lists the spec docs the orchestrating session edits
concurrently; and a `grep -c` expected 1 where the new doc-comment made it 2.

The one finding that changed how the feature is understood: **all 209 existing
web tests passed unchanged under both the old and the new formula.** The suite
had no purchase at all on a defect in the primitive nearly every scheduling
behaviour is measured against. Under the old formula 6 of the 7 new tests go
red — but the seventh, the 400-day one-to-one walk, stays green, because a fixed
86.4M-ms grid also advances once per calendar day when sampled at local noon.
Keeping it (as a regression guard) while saying plainly that it discriminates
nothing about *this* change is the honest version, and is what `tasks.md` says.
That became **L-018**.

One process note: `CriticReview.md` round 1 found five faults in an `Analyst.md`
the same session had just written. Reviewing your own spec is worth doing, but
only if the review re-derives against the code and the live data instead of
re-reading the prose — every one of the five came from running something, not
from thinking harder.
