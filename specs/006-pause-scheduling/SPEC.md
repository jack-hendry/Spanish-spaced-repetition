# SPEC: Pause scheduling

## Problem

A user who steps away from studying for days or weeks returns to a flood of
overdue cards: everything paused-through-time has piled up on the same due day,
and FSRS treats the whole gap as forgotten time. There is no way to say "I'm
away — don't count these days against me." Anki solves this with per-deck due-
date shifting; this app has nothing.

## Goal

A single **global** pause toggle. While paused, no cards are served for study
from any deck (learning, review, and new-card introduction all halt) and all
due counts read zero, but browsing/editing/adding notes is unaffected. On
resume, every eligible card's `due` shifts forward by exactly the paused
duration, so studying resumes as if no time passed while paused.

## Architecture invariant (must not be violated)

The server never computes scheduling. All due-shift math lives in
`web/src/app/core/`. The new resume endpoint writes only the absolute `due`
values the client hands it — it performs **no** date arithmetic. Files under
`web/src/app/core/scheduling/` (`sm2.ts`, `fsrs.ts`, `scheduler-factory.ts`,
`types.ts`), plus `todayNumber()` and `ReviewContext`, are **not** modified.

## Non-goals (out of scope)

- Timezone/DST-aware (e.g. America/Toronto midnight) day-cutoff logic. Use the
  existing fixed-offset `dayCutoffHour` math in `todayNumber()` unchanged.
- Per-deck pausing. Pause is one global flag.
- Modifying `revlog.ndjson`, `card.interval`, `card.stability`,
  `card.difficulty`, `card.type`, or `card.queue` during resume — only `due`
  changes. Revlog stays on real wall-clock time.
- Any new bulk-write endpoint beyond the one resume endpoint below.
- Auto-pause, scheduled pauses, or pause history/audit.

## Data model change

R1. Add exactly one field to `Collection` in **both** `server/src/models/index.ts`
    and `web/src/app/core/models/index.ts`, hand-mirrored identically:
    `pausedAt: number | null`. Non-null = paused; holds the epoch-ms the pause
    began.
R2. `buildSeedCollection()` in `server/src/store/seed.ts` sets `pausedAt: null`.

## Pause / resume state transitions

R3. **Pause** is a single `patchCollection({ pausedAt: Date.now() })` via the
    existing `PATCH /api/collection` route. No new route for pausing.
R4. Pausing while already paused (`pausedAt` non-null) is a **no-op**: do not
    overwrite an existing `pausedAt`. The toggle only issues the patch when
    currently unpaused.
R5. Add one new server endpoint `POST /api/collection/resume` accepting
    `{ expectedPausedAt: number; cardUpdates: { id: string; due: number }[] }`.
    If `collection.pausedAt !== expectedPausedAt` (or is already null), the
    endpoint is a no-op and returns success (R11b). Otherwise it writes in this
    **exact, mandatory order**: (a) persist all `cardUpdates` into the card store
    (`cards.json`); (b) only after (a) succeeds, set `collection.pausedAt = null`
    and persist `collection.json`. The reverse order is **forbidden**.
R6. The endpoint applies each `{id, due}` by id, leaving every other card field
    untouched, then persists. Re-applying the same payload twice converges to
    the same state (absolute `due`, not deltas), so duplicate/concurrent resume
    requests are safe.

## Due-shift calculation (client, pure function)

The client computes `cardUpdates` before calling resume. Given `pausedAt`
(from the collection) and `resumedAt = Date.now()`:

R7. Compute two deltas: **day delta** =
    `todayNumber(coll, resumedAt) - todayNumber(coll, pausedAt)`; **ms delta** =
    `resumedAt - pausedAt`.
R8. For each card, select the rule by **`card.type`** (never `card.queue`):
    - `type === 'review'`: `due += dayDelta` (day-number arithmetic).
    - `type === 'learning'` or `type === 'relearning'`: `due += msDelta`,
      added directly with **no** unit conversion (both are epoch ms).
    - `type === 'new'`: never shifted, never included in the payload.
R9. The same delta is added to every affected card of a given representation
    (preserving relative spacing) — cards are not snapped to the resume day.
R10. If either delta is `<= 0` (same-day pause/resume or clock skew), that
     representation is a no-op: never decrease any card's `due`. A payload may
     be empty.
R11. **Crash-safe resume via a client-persisted payload snapshot.** The shift is
     computed **exactly once** per pause episode, the first time the user clicks
     Resume, from the cards' current stored `due` (which equal their at-pause
     values, since the queue is gated and no reviews occur while paused). Because
     a crash between R5(a) and R5(b) leaves cards already shifted while
     `pausedAt` stays non-null, the recompute-from-current-`due` mechanism the
     original request assumed is **impossible** to make idempotent: after such a
     crash, current `due` is the *shifted* value and `pausedAt != null` cannot be
     distinguished from a normal never-resumed pause. The resolution instead
     guarantees idempotency by **never recomputing on retry** and relying on
     **absolute-value writes**:

     - Before issuing the `POST /api/collection/resume`, the client persists the
       fully-computed payload to `localStorage` under a key derived from the
       current `pausedAt` value (e.g. `resume-pending:<pausedAt>`).
     - On success (both R5 writes committed, `pausedAt` cleared), the client
       removes that `localStorage` entry.
     - **Retry / recovery is always a re-send of the saved absolute payload, never
       a recompute.** Re-applying absolute `due` targets any number of times
       converges to the same state (R6), so an interrupted resume that already
       shifted the cards is completed — not double-shifted — by re-sending the
       identical targets.

R11a. **Recovery on load.** When the app loads (or the deck-list route
     initialises) and finds `collection.pausedAt !== null`:
     - If a `localStorage` payload exists for that exact `pausedAt`, a resume was
       interrupted → automatically re-send that saved payload to
       `POST /api/collection/resume` (absolute writes → safe whether or not the
       cards were already shifted), then clear the entry. This is the only
       automatic resume.
     - If no saved payload exists, this is a normal pause (no resume was ever
       attempted for this `pausedAt`) → remain paused, show the paused UI, and
       wait for an explicit Resume click. Because no prior attempt exists, the
       cards are guaranteed unshifted, so the first Resume click computes
       correctly.
     - Residual risk (documented, accepted for a local single-user app): if the
       user manually clears `localStorage` *after* a resume crashed mid-write but
       *before* the next load, the saved payload is lost and the cards may already
       be shifted; a subsequent Resume click would recompute from shifted `due`
       and over-shift. This is the single uncovered edge and is deemed acceptable;
       no server-side or per-card state is added to close it.

R11b. **Server guard (defence in depth).** The resume request also carries the
     `pausedAt` value the payload was computed against (`expectedPausedAt`). The
     server applies the update only if `collection.pausedAt === expectedPausedAt`;
     if it no longer matches (already resumed by another request), the endpoint is
     a no-op success. This prevents a stale saved payload from applying after a
     later, unrelated pause episode.

## Study-queue gating (client)

R12. In `study-queue.service.ts`, `next(ctx)` returns `null` immediately when
     `collection.pausedAt !== null`, before any of the 4 selection tiers.
R13. Same gate in `counts(ctx)`: returns `{new:0, learning:0, review:0}` while
     paused.
R14. In `collection.store.ts`, the `ownCounts` computed, while paused, iterates
     the **deck list** (`this.decks()`, not `this.cards()`) so every deck —
     including decks with zero cards — gets an entry forced to
     `{new:0, learning:0, review:0}`. The `deckTree` rollup inherits this, so
     the sidebar and "Study all due" total read zero.

## UI

R15. Deck-list route `/` (`features/deck-list/`): add a **new header element** at
     the top of `deck-list.html` (the route currently has no header) hosting a
     "Pause scheduling" / "Resume scheduling" toggle button. This is the **only**
     control that mutates pause state. Resume triggers the R7–R11 compute +
     `POST /api/collection/resume`; the button is disabled while the request is in
     flight.
R16. App shell (`web/src/app/app.html` / `app.ts`, the root component wrapping
     `<router-outlet>`): a persistent, **read-only** "Scheduling paused" banner
     visible on every route while `pausedAt !== null`. The banner does not
     toggle state.
R17. Review empty state (`features/review/review.ts` + `review.html`): show a
     distinct "Scheduling is paused" message instead of the existing
     "All done / No more cards due" block when paused.

## Streak behaviour

R18. Confirm (via test) that the existing streak logic in `web/src/app/core/stats.ts`
     (`dayStreak`) breaks on any zero-review day, since revlog is untouched by
     pause/resume and a paused period produces a zero-review gap. Do **not**
     modify `dayStreak` unless the test shows it incorrectly bridges gaps.

## Documentation fix

R19. Fix `.claude/skills/scheduling-domain/SKILL.md`: change **every** stale
     "epoch seconds" description of learning-queue `due` to "epoch milliseconds"
     (grep the file for "epoch"; there are two occurrences, ~line 27 and ~line 51
     — do not rely on a fixed line range). Verified against code: `fsrs.ts` sets
     `due = ctx.now + delayMin * 60_000`, `study-queue.service.ts` uses
     `c.due <= ctx.now`, and `ctx.now = Date.now()`. **Scope:** fix only
     `SKILL.md`. Do **not** touch the stale `Card.due` doc comment in
     `server/src/models/index.ts` — that is a separate data-model-contract file,
     left alone to avoid scope creep (see Decisions D1).

## Tests (acceptance checklist)

Colocated `*.spec.ts`, following repo conventions (pure-function/queue specs run
without a server or browser; server tests use vitest with temp-dir isolation).

- T1. Worked example: card reviewed day 95, interval 5, `due = 100`; pause day
  100, resume day 130 → new `due = 130`; next FSRS review sees
  `lastReviewDay = 125`, `elapsed = 5`.
- T2. Learning card due 10 min after pause shifts by the exact ms delta — a test
  that would fail if `due` were treated as epoch seconds (÷/×1000).
- T3. Relative spacing between two shifted cards is preserved.
- T4. Suspended review card (`type: review`, `queue: suspended`) shifts
  identically to a non-suspended review card.
- T5. `new`-type cards never appear in the resume payload.
- T6. Same-day pause/resume (delta ≤ 0) leaves every `due` unchanged.
- T7. Simulated crash between R5(a) and R5(b): `pausedAt` stays non-null with
  cards already shifted; the saved-payload re-send (R11/R11a) applied a second
  time leaves `due` unchanged (absolute-write idempotency — no double-shift).
- T7a. Recovery-on-load dispatch (R11a): with `pausedAt` set and a saved payload
  present, the client re-sends the saved payload; with `pausedAt` set and no saved
  payload, no automatic resume is issued (stays paused).
- T7b. Server guard (R11b): a resume request whose `expectedPausedAt` does not
  match `collection.pausedAt` is a no-op and does not alter any card.
- T8. Gap > 1 paused day breaks the study streak.
- T9. Pausing while already paused does not change `pausedAt`.
- T10. Study-queue pause gate: `next()` and `counts()` return null / zeros while
  paused.

## Decisions (resolved)

- D1 (was Q1). **Do not** fix the stale `Card.due` doc comment in
  `server/src/models/index.ts`. R19 fixes only `SKILL.md`. Rationale: avoid scope
  creep on the data-model-contract file; the SKILL.md fix was the only doc change
  the request scoped.
- D2 (was Q2). The toggle button lives in a **new header element** added at the
  top of the `/` deck-list route (`deck-list.html`), not in the app-shell sidebar.
  See R15.
- D3 (was Q3 + the BLOCKER). Crash-recovery is **not** a blind recompute-and-retry.
  The shift is computed once and its absolute-`due` payload is snapshotted to
  `localStorage` keyed by `pausedAt`; retry/recovery re-sends that saved payload
  (absolute writes → idempotent), and recovery-on-load auto-resumes **only** when
  such a saved payload exists (otherwise it stays paused pending an explicit
  click). A server-side `expectedPausedAt` guard rejects stale payloads. This
  replaces the original (unsatisfiable) "recompute from current `due`" idempotency
  claim. See R11 / R11a / R11b. One residual edge (user manually clears
  `localStorage` mid-crash) is documented and accepted; no data-model or per-card
  state is added.
