---
name: scheduling-domain
description: Domain invariants for this repo's spaced-repetition scheduling — card.due overloading, day numbers, permille ease, dual SM-2/FSRS state, card generation ord rules, persistence quirks. Read before any task touching scheduling, the study queue, card generation, or the card data model.
---

# Scheduling domain invariants

Verified against source 2026-07-07. If code and this file disagree, trust the
code and update this file.

## The prime directive

**The server never computes scheduling.** All SM-2/FSRS math, queue ordering,
daily limits, and bury/lapse logic live in `web/src/app/core/`. The server owns
card *structure* (which cards exist — `server/src/cards/generate.ts`) and
persistence only. A scheduling change that touches `server/` is almost
certainly wrong unless the on-disk shape itself changes
(`server/src/models/index.ts`, mirrored in `web/src/app/core/models/`— keep in sync).

## `card.due` is overloaded by queue

(`server/src/models/index.ts` `Card`)

| queue      | `due` means                          |
|------------|--------------------------------------|
| `new`      | position in the new-card ordering    |
| `learning` | **epoch milliseconds** the step comes due |
| `review`   | **day number** it comes due          |

Never compare `due` values across queues, and never compare learning `due`
(epoch ms) against `ctx.today` (a day number) or review `due` against `ctx.now`
(epoch ms). The study queue does it correctly in
`web/src/app/core/study-queue.service.ts` `next()`: learning uses
`c.due <= ctx.now`, review uses `c.due <= ctx.today`.

## Day numbers

`todayNumber(collection, now)` in `web/src/app/core/collection.store.ts`:
`floor((now - collection.created - dayCutoffHour*3600_000) / 86_400_000)` —
days since collection creation, with the study day rolling over at
`collection.dayCutoffHour` (default 4am, like Anki), NOT midnight. Any
"per day" feature (limits, unburying, heatmap buckets, forecast) must go
through `todayNumber`, never through calendar dates.

## Units are non-obvious

- `card.ease` is **permille**: 2500 = 250%. Default starting ease 2500.
- `card.interval` is whole **days**; learning steps in `DeckOptions` are **minutes**.
- `SchedulingResult.intervalDays` may be fractional (sub-day learning steps).
- Timestamps (`created`, `modified`, `lastReviewed`, `ReviewContext.now`) are epoch **ms**;
  learning-queue `due` is also epoch **ms** (same unit, do not divide/multiply by 1000).

## Dual scheduler state

Every card carries BOTH SM-2 state (`ease`, `interval`) and FSRS state
(`stability`/`difficulty`, `null` until FSRS first schedules it), so a deck can
switch algorithms without migration. When writing scheduler code, preserve the
other algorithm's fields — never zero them out. `SchedulerFactory.for(opts)`
(`web/src/app/core/scheduling/scheduler-factory.ts`) picks `Sm2Scheduler` or
`FsrsScheduler` from `opts.scheduler`; both implement `Scheduler` in
`scheduling/types.ts` (`preview` must not mutate; `answer` returns
`{ card, revlog }` — the SPA POSTs both to `/api/review` in one round-trip).

## Study queue ordering

`StudyQueueService.next()`: (1) learning due now → (2) review due today, within
daily limit → (3) new, within daily limit → (4) soonest not-yet-due learning
card so a session can finish. Review filter is `queue === 'review' &&
type === 'review'` — a relearning card sits in the `learning` queue. Daily
limits persist across reloads via `Deck.daily` (`DeckDaily` tally, reset when
`day` falls behind); seeding happens in `remainingLimits` (`core/daily-limits.ts`).

## Card generation (server-side structure)

`reconcileNoteCards` in `server/src/cards/generate.ts`, run on every note
create/edit:

- standard note type → one card per template, `ord` = template ord
- cloze note type → one card per distinct `{{cN::…}}` across ALL fields, at
  `ord = N - 1`; a cloze note with no valid deletions still gets ord 0
- surviving ords **keep their scheduling state**; new ords become fresh `new`
  cards; vanished ords are deleted. Card ids are deterministic:
  `c{note.guid||note.id}-{ord}` — this is what makes re-import preserve
  scheduling.

## Persistence quirks

(`server/src/store/file-store.ts`)

- `cards.json` writes are debounced (~400ms, `saveCardsSoon`) so review bursts
  coalesce; `revlog.ndjson` is append-only; `flushAll()` runs on
  SIGINT/SIGTERM. Consequence: with the dev server running, `data/spanish/`
  files change on disk constantly — never treat them as hand-editable while
  the server is up, and don't be surprised by dirty git state there.
- All writes are atomic (temp file + rename).

## Where the tests live

Pure logic has colocated `*.spec.ts` (e.g. `scheduling/sm2.spec.ts`,
`scheduling/fsrs.spec.ts`, `core/daily-limits.spec.ts`, `core/lifecycle.spec.ts`).
Scheduling changes should extend these — they run without a browser or server.
