# PLAN: Pause scheduling

## Approach

One global `pausedAt: number | null` on `Collection` (epoch-ms the pause began,
`null` = running) drives everything. Pausing is the existing
`PATCH /api/collection`; the client only issues it when currently unpaused, so
an existing timestamp is never overwritten (R3/R4). All due-shift math stays in
`web/src/app/core/` — a new pure `pause-shift.ts` computes the absolute `due`
targets, and the server's one new endpoint (`POST /api/collection/resume`)
writes exactly those values with **no** date arithmetic, honouring the
mandatory (a) cards-then-(b) collection write order (R5). The invariant files
(`core/scheduling/*`, `todayNumber()`, `ReviewContext`) are untouched: shifting
`due` forward by the pause delta makes FSRS elapsed-time math come out right
automatically.

The subtle part is crash-safe idempotency (D3/R11). We do **not** recompute on
retry. The client computes the shift once (first Resume click, from the cards'
current stored `due`, which equal their at-pause values because the queue is
gated), snapshots the absolute payload to `localStorage` keyed by `pausedAt`,
then POSTs. On success it clears the key. On load, if `pausedAt !== null` and a
saved payload exists, a resume was interrupted → auto re-send the saved payload
(absolute writes are a no-op on already-shifted cards); if no payload exists it
is a normal pause → stay paused. The server double-guards with
`expectedPausedAt` so a stale payload can't apply to a later pause episode.

Gating is three client-side edits: `study-queue.service.ts` `next()`/`counts()`
short-circuit while paused, and `collection.store.ts` `ownCounts` iterates the
deck list forcing zeros so every deck (even empty ones) and the rollup read
zero. UI adds a toggle (deck-list header), a read-only app-shell banner, and a
distinct review empty state. Streak is left as-is (revlog untouched); a test
proves a paused gap breaks it. A docs-only SKILL.md unit fix closes R19.

## Files affected

- `server/src/models/index.ts` — add `pausedAt` to `Collection` (R1).
- `web/src/app/core/models/index.ts` — hand-mirror the same field (R1).
- `server/src/store/seed.ts` — `buildSeedCollection` sets `pausedAt: null` (R2).
- `server/src/routes/index.ts` — new `POST /collection/resume` (R5/R6/R11b).
- `server/src/store/file-store.ts` — awaited cards persistence for ordered write.
- `web/src/app/core/pause-shift.ts` — **new** pure due-shift function (R7–R10).
- `web/src/app/core/pause.service.ts` — **new** pause/resume/recover orchestration
  + localStorage snapshot (R3/R4/R11/R11a).
- `web/src/app/core/api.service.ts` — `resume()` wrapper for the new endpoint.
- `web/src/app/core/study-queue.service.ts` — pause gate in `next()`/`counts()` (R12/R13).
- `web/src/app/core/collection.store.ts` — `ownCounts` deck-list gate while paused (R14).
- `web/src/app/features/deck-list/deck-list.{ts,html,scss}` — header toggle (R15).
- `web/src/app/app.{ts,html}` — read-only banner + recovery-on-load call (R16/R11a).
- `web/src/app/features/review/review.{ts,html}` — paused empty state (R17).
- `.claude/skills/scheduling-domain/SKILL.md` — epoch seconds → milliseconds (R19).
- `*.spec.ts` colocated per task below.

## Tasks

### T001 — Add `pausedAt` to the data model + seed
Add `pausedAt: number | null` to `Collection` in **both** `server/src/models/index.ts`
and `web/src/app/core/models/index.ts` (identical shape, hand-mirrored, place it
next to `lastUnburyDay`). Set `pausedAt: null` in `buildSeedCollection()` in
`server/src/store/seed.ts`. Satisfies R1, R2.
- **Done when:** `npm run build` type-checks both workspaces and a fresh-seed
  server test asserts `collection.pausedAt === null`.
- Skills: scheduling-domain, angular-conventions, testing-playbook
- Complexity: low

### T002 — Pure due-shift function + spec
Create `web/src/app/core/pause-shift.ts` exporting
`computeResumeCardUpdates(coll: Collection, cards: Card[], resumedAt: number):
{ id: string; due: number }[]`. Compute `dayDelta = todayNumber(coll, resumedAt)
- todayNumber(coll, coll.pausedAt!)` and `msDelta = resumedAt - coll.pausedAt!`.
Select the rule by **`card.type`** (never `card.queue`): `review` →
`due += dayDelta`; `learning`/`relearning` → `due += msDelta` (no unit
conversion); `new` → never included. If a representation's delta is `<= 0`,
those cards are omitted (never decrease `due`); payload may be empty. Same delta
added to every affected card (preserve relative spacing). Import `todayNumber`
from `collection.store` — do **not** modify it. Colocated `pause-shift.spec.ts`
covers: T1 (day 95/ivl 5/due 100, pause 100 resume 130 → due 130, and assert the
implied `lastReviewDay = due - interval = 125`), T2 (learning card due
`pausedAt + 10*60_000` shifts by exact ms — assert a value that fails if treated
as epoch seconds), T3 (two review cards keep their day gap), T4 (a
`type:'review', queue:'suspended'` card shifts identically to a non-suspended
one), T5 (`type:'new'` never in payload), T6 (same-day: `dayDelta`/`msDelta` ≤ 0
→ no ids emitted). Satisfies R7–R10; tests T1–T6.
- **Done when:** `npm run test -w web` passes the new spec (all of T1–T6).
- Skills: scheduling-domain, angular-conventions, testing-playbook
- Complexity: medium

### T003 — Study-queue pause gate + spec
In `web/src/app/core/study-queue.service.ts`: at the top of `next(ctx)` return
`null` when `this.store.collection()?.pausedAt != null` (before the 4 tiers); in
`counts(ctx)` return `{ new: 0, learning: 0, review: 0 }` under the same
condition. Colocated spec (T10): with a session started and `pausedAt` set,
`next()` returns null and `counts()` returns all-zero; with `pausedAt` null the
existing behaviour is unchanged. Satisfies R12, R13; test T10.
- **Done when:** `npm run test -w web` passes the gate spec.
- Skills: scheduling-domain, angular-conventions, testing-playbook
- Complexity: medium

### T004 — Collection-store `ownCounts` gate while paused
In `web/src/app/core/collection.store.ts`, `ownCounts`: when
`coll.pausedAt != null`, build the map by iterating `this.decks()` (not
`this.cards()`), giving **every** deck an entry of `{ new: 0, learning: 0,
review: 0 }`, then return early. Unpaused path unchanged so `deckTree` rollup,
sidebar totals, and "Study all due" all read zero while paused. Add/extend a
store spec asserting all deck counts are zero while paused including a zero-card
deck. Satisfies R14.
- **Done when:** `npm run test -w web` passes; a paused fixture yields zero
  totals for a deck that has cards and for a deck with none.
- Skills: scheduling-domain, angular-conventions, testing-playbook
- Complexity: medium

### T005 — Server resume endpoint + spec
Add `POST /api/collection/resume` to `server/src/routes/index.ts` accepting
`{ expectedPausedAt: number; cardUpdates: { id: string; due: number }[] }`. If
`collection.pausedAt !== expectedPausedAt` **or** is already `null`, respond 200
no-op (R11b). Otherwise, in this **exact order**: (a) apply each `{id, due}` by
id (leave all other card fields untouched; unknown ids skipped) and persist
cards to disk **awaited** — add an awaited `saveCards()` to
`server/src/store/file-store.ts` (`await this.flush('cards')`) rather than the
debounced `saveCardsSoon()`; (b) only after (a) resolves, set
`collection.pausedAt = null` and `await store.saveCollection()`. Re-applying the
same payload converges (absolute writes). Server does **no** date arithmetic.
Vitest spec with temp-dir isolation covers: T7 (apply payload once, then again —
`due` unchanged the second time, no double-shift; simulate the crash by leaving
`pausedAt` set + cards pre-shifted and re-sending), T7b (mismatched
`expectedPausedAt` → no card altered, `pausedAt` unchanged). Satisfies R5, R6,
R11b; tests T7, T7b.
- **Done when:** `npm run test -w server` passes; ordering verified (cards on
  disk before `pausedAt` cleared) and both idempotency cases green.
- Skills: scheduling-domain, testing-playbook
- Complexity: high

### T006 — Pause service (compute + snapshot + recover) + spec
Create `web/src/app/core/pause.service.ts` (`providedIn: 'root'`) and add
`resume(payload)` → `POST /api/collection/resume` to `api.service.ts`. Methods:
- `pause()`: only if `collection().pausedAt == null`, call
  `api.patchCollection({ pausedAt: Date.now() })`, update the store signal (R3/R4).
- `resume()`: read `pausedAt`; compute `cardUpdates` via
  `computeResumeCardUpdates` (T002); write `localStorage['resume-pending:'+pausedAt]`
  = JSON `{ expectedPausedAt: pausedAt, cardUpdates }`; POST it; on success set
  `pausedAt: null` in the store, apply shifted `due` to cached cards, remove the
  localStorage key (R11).
- `recoverOnLoad()`: when `collection().pausedAt != null` and a saved payload for
  that exact `pausedAt` exists, re-send it then clear the key (the only automatic
  resume); if no payload, do nothing (stay paused). Stale keys are ignored, not
  pruned (R11a).
Colocated spec (T7a, T9): mock api — `pause()` while already paused issues no
patch (T9); `recoverOnLoad()` with `pausedAt` set + payload present re-sends the
saved payload, with `pausedAt` set + no payload issues no resume (T7a).
Satisfies R3, R4, R11, R11a; tests T7a, T9.
- **Done when:** `npm run test -w web` passes the pause-service spec.
- Skills: scheduling-domain, angular-conventions, testing-playbook
- Complexity: high

### T007 — Deck-list header toggle
Add a **new header element** at the top of
`web/src/app/features/deck-list/deck-list.html` hosting a button that reads
"Pause scheduling" when running and "Resume scheduling" when
`collection()?.pausedAt != null`. Wire click to `PauseService.pause()` /
`resume()`; disable it while a resume request is in flight (local `busy`
signal). This is the only pause-mutating control. Add matching styles in
`deck-list.scss`. Satisfies R15.
- **Done when:** `npm run test -w web` builds; toggling the button flips label
  and (in a component test or manual dev run) issues the correct call.
- Skills: angular-conventions, scheduling-domain, testing-playbook
- Complexity: medium

### T008 — App-shell banner + recovery-on-load wiring
In `web/src/app/app.ts`/`app.html`: add a persistent, read-only "Scheduling
paused" banner shown on every route while `collection()?.pausedAt != null` (not
clickable, does not toggle). Call `PauseService.recoverOnLoad()` after the
collection has loaded (in the existing load flow / constructor). Satisfies R16,
R11a wiring.
- **Done when:** `npm run test -w web` builds; banner renders when paused and is
  absent when running; `recoverOnLoad()` is invoked once after load.
- Skills: angular-conventions, scheduling-domain, testing-playbook
- Complexity: medium

### T009 — Review paused empty state
In `web/src/app/features/review/review.{ts,html}`: when
`store.collection()?.pausedAt != null`, show a distinct "Scheduling is paused"
message instead of the "All done / No more cards due" block. Add a `paused`
computed/signal; the existing `finished` block branches on it. Satisfies R17.
- **Done when:** `npm run test -w web` builds; a paused fixture renders the
  paused message, an unpaused finished session renders "All done".
- Skills: angular-conventions, scheduling-domain, testing-playbook
- Complexity: low

### T010 — Streak-gap test (no code change to `dayStreak`)
Add a test in `web/src/app/core/stats.spec.ts` proving `dayStreak(reviewDays,
today)` breaks across a >1-day zero-review gap (e.g. reviews on days
{10,11,20}, `today=20` → streak 1). Do **not** modify `dayStreak` unless the
test shows it bridges gaps. Satisfies R18; test T8.
- **Done when:** `npm run test -w web` passes the streak test with `dayStreak`
  unchanged.
- Skills: scheduling-domain, testing-playbook
- Complexity: low

### T011 — SKILL.md unit fix (docs only)
In `.claude/skills/scheduling-domain/SKILL.md`, change **both** stale
"epoch seconds" descriptions of learning-queue `due` to "epoch milliseconds"
(grep for "epoch"; ~line 27 and ~line 51 — do not rely on fixed lines). Do
**not** touch the `Card.due` comment in `server/src/models/index.ts` (D1).
Satisfies R19.
- **Done when:** `grep -n "epoch seconds" .claude/skills/scheduling-domain/SKILL.md`
  returns nothing and both learning-`due` mentions read "epoch milliseconds".
- Skills: none
- Complexity: low

## Testing strategy

- R1/R2 → T001 build + fresh-seed server assertion.
- R7–R10, T1–T6 → `pause-shift.spec.ts` pure-function cases (T002).
- R12/R13, T10 → study-queue gate spec (T003).
- R14 → collection-store paused-counts spec (T004).
- R5/R6/R11b, T7/T7b → server resume vitest with temp-dir isolation (T005).
- R3/R4/R11/R11a, T7a/T9 → pause-service spec with mocked api (T006).
- R15/R16/R17 → component build + render assertions (T007–T009).
- R18/T8 → stats streak spec (T010).
- R19 → grep assertion (T011).

Every requirement R1–R19 and every acceptance test T1–T10 maps to a task above.

## Open Questions
None.
