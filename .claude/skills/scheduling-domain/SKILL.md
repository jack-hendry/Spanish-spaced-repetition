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

## Recipe: deck-pinned templates & reaching live installs

Pattern from feature 008 (Listening cards): adding a new card **template** to
an existing note type, where the new card must live in its own dedicated deck
instead of the note's own deck (e.g. "give every note in deck X a second,
audio-only card that lives in a separate top-level deck Y"). Reuse this shape
rather than re-deriving it — several of these steps are easy to skip and only
fail on a *live* store, not a fresh one.

**The mechanism:** `CardTemplate` has an optional `deckId?: string`
(`server/src/models/index.ts`, mirrored in `web/src/app/core/models/`) meaning
"cards generated from this template always live in this fixed deck, regardless
of the note's own deck." Every producer of cards resolves the effective deck
as `template.deckId ?? primaryDeckId` — keep the special-case in this one
place, not scattered `ord === N` checks.

**Four traps, in the order they bite:**

1. **`notetypes.json` seeds only when the whole file is absent**
   (`FileStore.init`, `server/src/store/file-store.ts`). Editing
   `buildSeedNoteTypes()` in `seed.ts` only reaches *fresh* installs. Any live
   store needs a **startup migration** (`server/src/store/migrations.ts`
   pattern: `migrateAdd*Template`) that (a) appends the template if the note
   type lacks it, (b) creates the dedicated deck if missing, (c) relocates any
   card of the new ord that was already created in the *wrong* deck (e.g. from
   before the dedicated-deck decision existed), and (d) calls
   `reconcileNoteCards` per note to backfill the new card. Gate every step on
   "is this already true?" so re-running is a no-op — `FileStore.init` runs it
   on every boot.

2. **New-card queue positions must not collide.** Compute
   `basePosition = max(due where queue === 'new') + 1` once, then advance it
   past each card the migration creates — don't call `reconcileNoteCards` per
   note with a stale `basePosition`.

3. **`reconcileNoteCards` must re-apply the pinned deck on every call**, not
   just at creation, so a card that ever drifted to the wrong deck self-heals
   on the next edit/migration. Never zero out or skip scheduling fields when
   correcting `deckId` — only `deckId`/`modified` change.

4. **The importer (`server/src/import/transform.ts`) replaces `decks.json`
   wholesale** (`transformBooks` returns the full deck set, `store.replaceAll`
   consumes it). A dedicated deck that isn't derived from any book's menu tree
   is invisible to that logic and gets **silently dropped on the next
   `npm run import`** unless explicitly carried through from `existing.decks`.
   Same wholesale-replace trap applies to any per-ord deck resolution in the
   importer's card-building loop — it must resolve `template.deckId ??
   bookDeckId` too, or re-import resets the pinned deck back to the book deck.

**Done-when checklist:** fresh install seeds correctly; migration on a
pre-existing store adds the template + deck + backfills cards without
touching surviving cards' scheduling; migration is idempotent (second run
changes nothing); re-running `npm run import` does not move the pinned deck's
cards back or drop the deck. See `server/src/store/migrations.test.ts`,
`server/src/store/file-store.migration.test.ts`, `server/src/cards/generate.test.ts`,
and `server/src/import/transform.test.ts` for the concrete test shapes.

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

## Lessons (auto-appended)

Dated entries for domain gotchas that belong next to the rules above, added
during the archive ritual in `specs/STATE.md` (step 2) by whoever closes the
feature. Append-only; humans prune. If a lesson contradicts the body above,
trust the code, then fix both.

Project and process lessons go to `specs/STATE.md` + `specs/LESSONS.md` as
`L-NNN` instead -- that pair is what the pre-push gate enforces (AD-009).

### 2026-08-26 — A persisted card field and the currently-configured deck options can disagree, and the gap is silent

(`specs/012-clamp-learning-steps-nan-due`, from audit finding B1)

`card.left` (steps *remaining*) is persisted on the card. The steps array it
counts against — `opts.new.steps` / `opts.lapse.steps` /
`opts.fsrs.learningSteps` / `opts.fsrs.relearningSteps` — lives in deck options
the user can edit at any moment. Shorten a steps array while a card is
mid-learning and `card.left > steps.length`, which drove `steps[nextStep]` out
of bounds in the `good` branch of all four `previewLearning` /
`previewRelearning` functions: `undefined * 60_000` is `NaN`, so `due` came back
`NaN`. The `hard` branch had always clamped its index (`Math.max(0, …)`); `good`
never did.

The general rule: **whenever a card field indexes into something owned by deck
options, treat the two as able to disagree.** The card outlives any particular
options value. Validate at the point where the persisted field is first read,
not at each place it is used — `clampLeft(left, stepCount)` in
`core/scheduling/learning-steps.ts` is that point for `left` (see AD-010), and
clamping into `[1, stepCount]` is what makes every downstream `steps[...]` index
valid *by construction*.

Two specifics worth keeping:

- **`clampLeft` requires `stepCount >= 1`.** Every call site already guards the
  array first (`steps.length ? steps : [1]` / `[10]`), so it is never called
  with `0` — but `clampLeft(x, 0)` would return `0` and re-open the
  out-of-bounds read. If you move the helper or add a fifth call site, carry the
  guard with it.
- **A `NaN` `due` is not fully invisible to the study queue.** It fails the
  due-comparison branches in `StudyQueueService.next()` (`c.due <= ctx.now` is
  always false for `NaN`), but branch 4 — the "learning cards due later today"
  fallback — filters on `queue === 'learning'` with *no* `due` comparison, so it
  still hands the card back. The card is therefore not literally unreachable; it
  is served but can never become *due*, and `JSON.stringify` writes the `NaN` to
  `cards.json` as `null` on the next debounced save. The audit's "silently
  disappears from the queue forever" is the right severity for the wrong reason
  — check the fallback branch before repeating that claim.

### 2026-08-31 — Heatmap buckets key by calendar date shifted by `dayCutoffHour`, not by `todayNumber`

(`specs/018-lint-phase2-scheduling`, D7 review pass finding, specs/archive/2026-07-14-007-heatmap-date-off-by-one)

The guidance in this skill's main section says: "Any 'per day' feature (limits, unburying, heatmap buckets, forecast) must go through `todayNumber`, never through calendar dates." The live heatmap implementation (`core/heatmap.ts`, `heatDateKey`/`buildHeatGrid`) deliberately does the opposite: it keys buckets by **local calendar date** shifted by `dayCutoffHour`, *not* by `todayNumber`. That is correct and is exactly what spec 007 fixed — `heatmap.spec.ts`'s regression test states it: "Calendar-date keying must not depend on `created` at all."

The trap: `todayNumber` anchors on `collection.created`'s time-of-day, which pushed a same-day review made just after midnight into the next cell when the cutoff hour was 4am. The heatmap deliberately avoids that anchor, shifting only by the cutoff hour, not by the creation timestamp.

**Corrected rule:** use day numbers (via `todayNumber`) for scheduling mechanics (limits, due comparisons, forecast); use calendar dates (shifted by `dayCutoffHour`) for the heatmap's visual calendar cells. The distinction is mechanical: `todayNumber` is for comparisons that must respect creation time; calendar date is for a user-facing grid that must respect their local clock.
