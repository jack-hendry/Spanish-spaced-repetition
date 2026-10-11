# Analyst — 024 · Cross-device safety

Phase 4 of `specs/011-mobile-remote-access/ROADMAP.md`.
**Size: Large** — it touches the server's `/api/review` contract, the on-disk
card shape (`server/src/models/index.ts` + its `web/src/app/core/models/`
mirror), the outbox's failure classification, and the review loop. The sizing
rule forces Large on its own: anything touching `card.due`, the study queue or
the on-disk shape is at least Large.

Phase 3 (`specs/archive/2026-10-11-023-review-outbox`) made a review *arrive*.
Phase 4 makes a **late** review lose to a newer one instead of silently
overwriting it.

## 1. What problem are we solving?

`POST /api/review` replaces the stored card wholesale with the client's copy and
performs no version check at all:

```ts
cards[idx] = { ...card, modified: Date.now() };   // routes/index.ts:120
```

So the sequential-use case the roadmap says *will* happen loses data:

1. Phone loads the collection at T0 and holds it in memory (`CollectionStore`).
2. Desktop studies card X at T1. Server state advances.
3. Phone studies card X at T2, scheduling from its **T0 snapshot**.
4. The phone's POST overwrites T1's state. The desktop's review is erased from
   `cards.json` with no error, no log line, and nothing visible in either UI.

The roadmap's goal explicitly does not solve for *simultaneous* desktop+phone
use, but "progress is never lost" still binds for *sequential* use — and Phase 3
made step 3 strictly more likely, because an op can now sit in a
`localStorage` outbox across a tab kill and arrive **hours** after it was
computed. Phase 3 widened the window it deliberately did not close.

Four facts found in the code sharpen this beyond the roadmap bullet:

1. **The loss is asymmetric, and that is a diagnostic gift.** `revlog.ndjson` is
   append-only and deduped on `RevlogEntry.id`, so in the scenario above *both*
   reviews are in the revlog and only `cards.json` loses one. The corruption is
   therefore detectable after the fact — and it is exactly the divergence the
   deferred `revlog → cards.json` repair tool (`specs/BACKLOG.md`) would be
   asked to fix. A silent overwrite today becomes a recoverable one.
2. **`card.modified` cannot be the version token**, which is the trap this spec
   mainly exists to avoid. 023's C-8 recorded that client and server `modified`
   diverge permanently; reading the code says *why* it is unusable rather than
   merely divergent. `Sm2Scheduler.answer()` / `FsrsScheduler.answer()` both
   return `{ ...card, modified: ctx.now }` (`scheduling/sm2.ts:53`,
   `fsrs.ts:68`) — a **client** clock value — and `CollectionStore.applyCard()`
   caches that card locally while the server stamps its own `Date.now()`. So
   after any review the client's in-memory `modified` is a value the server has
   never seen. A naive `expectedModified: card.modified` precondition would
   therefore **false-conflict on the second review of the same card in one
   session** — i.e. on every 10-minute learning step, the single most common
   event in the app.
3. **A precondition and Phase 3's replay safety are in direct tension**, and
   023 §3 warned about exactly this ("do not add a version check while we're in
   there — it would make the outbox's replays fail"). The case that forces the
   design is D4's: a POST the server **applied successfully** whose response
   never arrived. The client cannot distinguish that from a failure, so it must
   retry; a naive precondition rejects that retry as stale, because the server's
   own successful write moved the version. The outbox would surface a permanent
   conflict for a review that already landed.
4. **409 is currently classified `'retry'`.** `classify()`
   (`core/outbox/outbox-ops.ts`) poisons only 400/404/422 and retries
   everything else. A conflict shipped without touching it would retry the same
   stale body forever at a 60s cap — head-of-line blocking the whole queue, and
   contributing ~15 failures per 15-minute window to the tier-1 rate limiter
   (the lockout interaction recorded in 023's Discovered).

## 2. What is in scope?

**Server (`server/src/`)**

- `Card` gains an optional **`rev`** field: a client-minted token naming the
  state the card is in. Optional and absent-tolerant, so no migration and no
  importer change (`reconcileNoteCards` spreads `{ ...prior }` for surviving
  ords, so `rev` survives note edits for free — verified, `generate.ts:101`).
- `POST /api/review` gains, **in this order**:
  1. **Dedupe first.** If `revlog.id` is already known, return 200 and do
     **not** write the card. This is new behaviour: today a replay re-applies
     the card wholesale, which is benign under Phase 3 (same value) and a
     clobber under Phase 4.
  2. **Then the precondition.** If the body's `expectedRev` does not equal the
     stored card's `rev`, return **409** with the stored card in the body.
  3. Otherwise apply, setting `rev` to the new `revlog.id`.
- Mirror the `Card` change in `web/src/app/core/models/`.

**Web (`web/src/app/`)**

- `rate()` sends `expectedRev` (the `rev` its scheduling was based on) and sets
  the local card's `rev` to the new `revlog.id` itself, so an **offline chain of
  reviews on one card is self-consistent with no server round-trip**.
- `classify()` learns a fourth outcome for 409, which is neither retry nor
  poison: hand the op to a resolver.
- A conflict resolver — **a new service outside `OutboxService`** (D8) — that
  reloads the collection once and re-applies the rejected rating against fresh
  state (D6), re-scheduling at the original answer instant (D10).
- UI: conflicts get a surface of their own, distinct from "unsaved".
- **A conflict counter** (C-8): the number of 409s this client has seen,
  surfaced. It is the only thing that can later answer whether declining a
  presence signal was right, and it is one number.

**Verification**

- Server integration tests: stale rejected (409), replay accepted (200, one
  revlog line, card untouched), virgin card accepted, fresh write accepted.
- Web specs: 409 classification, the resolver's re-apply, the bound.
- **A real two-device run** — desktop and phone, in the sequence from §1 — is
  the acceptance that matters. Ground truth is the pulled live state, never a UI.

## 3. What is OUT of scope?

Named explicitly, because each is a plausible drag-in:

- **The other three write paths.** `PATCH /cards/:id` (bury/suspend),
  `PATCH /decks/:id {daily}` and `PATCH /collection {lastUnburyDay}` get **no**
  precondition. Rationale: they are narrow field patches, not wholesale
  replacements, so a stale one damages only that field — and the field is
  recomputable (a bury lasts a day; a daily tally is a counter; `lastUnburyDay`
  re-derives on load). `POST /review` is the only path that replaces
  irreplaceable scheduling state wholesale. Two consequences are accepted and
  recorded rather than engineered away:
  - A stale `daily` patch can lower a deck's tally, loosening the day's limit.
  - A stale bury can overwrite a desktop `suspended` back to `schedBuried`.
- **`POST /collection/resume`.** The precondition does not cover it: resume
  assigns `cards[idx].due` and touches neither `modified` nor `rev`
  (`routes/index.ts:78`), so it moves scheduling state invisibly to any version
  check. Pause/resume is desktop-only and D6 re-applies rather than trusting a
  stale card, so this is accepted — but it is a genuine hole in the
  precondition, not an oversight. See `## Discovered`.
- **A presence / "open elsewhere" signal.** The roadmap's third bullet says
  "consider"; this spec declines it for v1. It needs server-side heartbeat state
  (a new write path on a store with no user model) to tell the user something
  the 409 already tells them *at the moment it matters*. Revisit only if real
  conflicts prove frequent — see `## Discovered`.
- **The `revlog → cards.json` repair tool** and the **`/api/review` hard-kill
  divergence** (`specs/BACKLOG.md`, 2026-09-17). This spec makes the divergence
  *detectable and preventable*; it does not retroactively repair one.
- **The tier-1 rate-limiter lockout** (023 Discovered). A 409 is not retried, so
  this spec does not worsen it, but it does not fix it either.
- **Any scheduling math.** The resolver *re-runs* the existing scheduler; it does
  not change SM-2/FSRS, `due` overloading, day numbers, or queue ordering.
- **Merging two reviews of the same card into one.** If the user genuinely
  answered card X on both devices, **both** reviews apply, in arrival order, and
  both appear in the revlog. That is correct, not a conflict to resolve away.
- **Offline reload / PWA / service worker.** Unchanged from 023 §3.

## 4. Design decisions

**D1 — The version token is an explicit `card.rev`, not `card.modified`.**
Fact (2) kills `modified`. An explicit field also avoids repeating the project's
existing `due`-is-overloaded hazard, which `scheduling-domain` exists to warn
about: a reader should not have to know that a timestamp is secretly a
concurrency token. `modified` keeps its current meaning ("when the server last
wrote this"), which the backup/debug path relies on.

**D2 — `rev` is the `RevlogEntry.id` of the review that produced the state.**
It is already client-minted, already unique, already stable across retries, and
already the server's dedupe key — so the client's precondition value, the
client's queue key and the server's dedupe key are **the same value by
construction**. It also ties a row in `cards.json` to a line in
`revlog.ndjson`, which is a free gift to the deferred repair tool. Nothing new
is invented; this is D4 of 023 reused one layer up.

**D3 — Compare by equality, never by ordering, so clock skew is irrelevant.**
The question is only "is the state I scheduled from still the state on disk?",
never "is mine newer?". Equality makes two devices' unsynchronised clocks a
non-issue, which an `expectedModified` design could not claim.

**D4 — Absent `rev` self-migrates, and the two kinds of absence mean different
things.** Every card on disk today has no `rev`, so the field populates itself
as cards are reviewed: no migration script, no `FileStore` seed change, no
`--apply` step. Sharpened by C-4, because Phase 3 ops outlive the deploy:

- **`expectedRev` missing / `undefined` → wildcard, skip the precondition.** An
  op enqueued by the current build is sitting in someone's `localStorage` right
  now and will drain *after* this deploys; it cannot carry a field that did not
  exist. Treating its absence as an assertion would reject a legitimate review.
  This is a real hole, and a bounded one: it closes as soon as the pre-deploy
  queue drains.
- **`expectedRev: null` → assert the stored card has no `rev`.** A Phase 4
  client saying "I scheduled from a virgin card".

The one race left is two devices both writing a *virgin* card from `null`: the
first wins and stamps the token, the second is then correctly rejected. The
window is one write per card, ever.

**D5 — Dedupe strictly before the precondition, and a replay must not write the
card.** This is the decision that resolves fact (3), and the ordering is
load-bearing in both directions:
- Dedupe first means a lost-response replay returns 200 without re-applying, so
  Phase 3's retry-forever contract survives untouched. Phase 4 does not make a
  single Phase 3 replay fail.
- Not writing the card on a replay is the *new* half. Today a replay re-applies
  wholesale; if a desktop review landed in between, re-applying would clobber it
  — the exact bug this spec exists to prevent, reachable through the retry path
  rather than the stale-snapshot path.

**D6 — A 409 is resolved by re-applying the rating, not by discarding it.**
The roadmap permits "reload and re-apply, or warn the user", but the second
non-negotiable ("progress is never lost") argues for re-apply: a warned-about
rejection is still a lost review unless the user manually redoes it. The
rejection response carries the server's current card; the queued op's
`RevlogEntry` carries the rating (`button`) and `timeMs`. That is everything
`Scheduler.answer()` needs, so the client can compute what *would* have happened
had the reviews arrived in order, mint a fresh revlog entry, and enqueue it.
Scheduling stays in the frontend (the prime directive), and the result is the
same state as if the user had answered on an up-to-date device.

**Resolution is per *snapshot*, not per op** — changed by C-2, which is the
finding that most altered this design. A 409 means "my snapshot is stale", and
that is a statement about the **whole queue**: if the snapshot is old it is old
for every op behind the head too. So the resolver:

1. pauses draining,
2. re-loads the collection **once**,
3. re-applies the rejected op against the fresh state,
4. resumes draining.

The arithmetic is why. A naive per-op bound of 3 attempts over N conflicting ops
is ~3N rejections, and a 409 is **not** 2xx, so each one spends part of the
tier-1 limiter's 20-failures-per-15-minutes budget
(`app.ts:70-78`, `skipSuccessfulRequests: true`) — the same budget whose
exhaustion locked the phone out of its own auth challenge in 023 Step 14. Seven
conflicting ops would lock the whole app out for 15 minutes while the banner
said reviews were unsaved. One reload per stale snapshot keeps total 409s at
roughly one per genuinely-conflicting review, and it is also exactly what the
roadmap bullet says ("reload and re-apply").

**Bounded on reload cycles** (proposed: 2 per drain pass), because an unbounded
resolver is a retry loop wearing a different hat. On exhaustion the op moves to
a retained, visible `conflicts` list — never auto-deleted, never silently
dropped. The bound is what stops two devices writing concurrently from
ping-ponging.

**The reload must not trust `load()`.** `CollectionStore.load()` opens with
`if (this.loading()) return;` (`collection.store.ts:137`), which returns
*immediately* rather than awaiting an in-flight load — so a resolver reload
overlapping another load is silently skipped and re-applies against the **same
stale array**, conflicting again. This is the third sighting of that shape
(023's gate, its Discovered entry, now here), generalised as **L-028**.
`tasks.md` should prefer fixing `load()` to return the in-flight promise over
working around it a third time.

**D8 — The outbox *detects*; a separate `ConflictResolver` *resolves*.**
Forced by C-1: `CollectionStore` already injects `OutboxService`
(`collection.store.ts:65`), and a resolver needs `optionsFor()`, `collection`
(for `todayNumber`) and `applyCard()` — i.e. it needs the store. Putting it
inside `OutboxService` would make `OutboxService → CollectionStore →
OutboxService`, a cyclic DI graph and an ESM import cycle. So `OutboxService`
stays ignorant of the store: it classifies the 409, holds the op, and exposes
it. A new `core/outbox/conflict-resolver.ts`, injecting `CollectionStore` +
`OutboxService`, registers itself with the outbox through an explicit seam.
Naming the seam here is the point — an implementer who meets this at step 6
will otherwise either invent a different one or reach for `forwardRef` and
leave the cycle in place.

**D9 — `rev` is assigned only where a `RevlogEntry` is minted, on both sides,
and is never carried by a spread.** C-3: both schedulers return
`{ ...card, … }` (`sm2.ts:53`, `fsrs.ts:68`), which propagates the *old* token,
and `POST /review` spreads the **client's** card
(`routes/index.ts:120`). So two assignments are mandatory and neither is
optional:
- The server sets `rev: revlog.id` itself and never trusts `card.rev`.
  Otherwise the stored token stays one review behind and *every* subsequent
  write conflicts — a self-inflicted permanent conflict.
- The client sets its local card's `rev` when it mints the revlog entry.
  Otherwise the next review in the same session sends a stale `expectedRev` and
  false-conflicts — the A4 trap re-entering through the back door.

**D10 — The resolver re-schedules at the *original* answer instant.**
`ReviewContext` is `{ now, today }` (`scheduling/types.ts:15-18`) and is **not**
in the revlog, so the resolver must choose one — and the choice changes the
schedule, which makes it scheduling semantics and therefore a decision for this
document rather than for an implementer. Use `now = revlog.reviewedAt` and
`today = todayNumber(coll, revlog.reviewedAt)` (verified implementable:
`todayNumber(collection, now = Date.now())`, `collection.store.ts:51`). The
result is then exactly what would have happened had the op arrived in order.
Re-applying at `Date.now()` would instead push a learning step hours later than
the user earned. A learning `due` may land in the past, which makes the card
immediately due — correct, and `StudyQueueService.next()` already handles it
(`due <= ctx.now`). If this ships it earns a `scheduling-domain` lesson, since
"re-schedule at the original instant" is a new rule in this codebase.

**D7 — Conflicts get their own UI state, separate from "unsaved".** 023's
banner already distinguishes draining / will-retry / error, and its Discovered
list records that the banner's wording is the one place the user learns how much
work is unsaved. A conflict is a different claim from "not yet saved" — the
review *was* rejected and then re-applied, or could not be — so it needs its own
words rather than being folded into the error count.

## 5. How do we know it is done?

- **A1** — Reproduce §1 by hand and show the desktop's review **survives**:
  load the phone, study card X on the desktop, then study X on the phone; the
  phone's POST is rejected 409, re-applied against the server's state, and the
  final `cards.json` reflects **both** reviews with two revlog lines. Verified
  against pulled live state, not a UI.
- **A2** — Falsifiability, attached to the **automated** test rather than to
  A1's manual run (C-7): the server integration test for the stale-write
  rejection is verified **red against the pre-change route** and green after —
  the discipline 023 Step 6 applied to its FIFO test. A manual two-device run
  cannot be cheaply re-run against `main`, and nobody will.
- **A3** — A Phase 3 replay still succeeds: POSTing an identical review body
  twice returns 200 twice, appends exactly one revlog line, and leaves the card
  **byte-identical** to the first application. Pinned by a server integration
  test, not by inspection.
- **A4** — A card reviewed repeatedly through its learning steps in **one
  offline session** never conflicts: the `rev` chain is client-minted, so N
  queued reviews of one card all apply in FIFO order on reconnect. This is the
  false-conflict trap from fact (2); it needs an explicit test.
- **A5** — A virgin card (no `rev` on disk) is accepted, and the second write
  from a stale snapshot of that same card is rejected.
- **A6** — The resolver's bound holds: a card under continuous conflict ends in
  the visible `conflicts` list after N attempts rather than looping, and the
  queue behind it still drains.
- **A7** — 409 is never retried blindly, and its cost against the tier-1 rate
  limiter stays bounded. Restated by C-2: a 409 is **not** 2xx, so
  `skipSuccessfulRequests` does not skip it and every rejection *does* spend one
  of 20 failures per 15 minutes. Claiming zero contribution was unachievable.
  The checkable claim is that a rejected op produces at most one 409 per reload
  cycle, and that a full stale queue resolves well inside the budget — measured
  in the A1 run, not assumed.
- **A8** — `npm run test` (both workspaces), `npm run build`, `npm run lint:ci`
  and `npm run format:check` all green, verified independently of any
  implementer's claim.

## 6. Open questions for human review

1. ✅ **RESOLVED 2026-10-11 (user): re-apply.** The alternative was warn-only —
   reject, surface it, let the user redo the card — which the roadmap explicitly
   permits ("Either is fine; silently discarding is not") and which would have
   been perhaps a third of the work, dropping D8/D10 and the resolver entirely.
   Re-apply was chosen because it is the only option that *keeps* the rejected
   review, which is what the second non-negotiable demands. D6, D8 and D10 are
   therefore all live and `tasks.md` is sized accordingly.
2. **The bound in D6** — 2 reload cycles per drain pass is a guess, not a
   measurement. It is now a bound on reloads rather than on per-op attempts
   (C-2), which makes it much less load-bearing than the original 3.
3. **Whether `rev` should also be set by `PATCH /cards/:id`.** Leaving it alone
   means a bury does not invalidate a queued review, which is the behaviour this
   spec wants. Stated as a decision rather than an oversight.
4. **Whether to fix `CollectionStore.load()`'s early return** inside this spec
   (return the in-flight promise) or work around it a third time. It is a
   `core/` change outside the stated scope, but D6's reload depends on it and
   L-028 is now three sightings old.

## Discovered

- **(2026-10-11, C-6) The revlog-id set's completeness is now a correctness
  input, not just a dedupe convenience.** 023's D4 named "retain only the last N
  ids" as a deliberately-unbuilt escape hatch for the unbounded in-memory
  `Set<string>`. After D5 the set also decides whether a replay is allowed to
  write the card. A trimmed set makes a forgotten replay fall through to the
  precondition, where it is *correctly rejected* — so the damage is a spurious
  conflict, not a clobber. Lower severity than it first appears, but the
  coupling is real and whoever builds the trim should know it exists.
- **(2026-10-11, planning) `POST /collection/resume` changes `due` without
  touching `modified`, and would not set `rev` either.** `routes/index.ts:78`
  assigns `cards[idx].due = update.due` and nothing else, so a pause/resume
  shifts scheduling state invisibly to any version check. A stale client's
  precondition would still pass after a resume. Pause/resume is a desktop-only
  action and D6 re-applies rather than trusting the stale card, so this is
  recorded rather than folded in — but it is a genuine hole in the precondition
  and belongs in whatever revisits it.
- **(2026-10-11, planning) Presence signalling was declined, and the thing that
  would justify it is a conflict *rate*.** Nothing measures how often a 409
  actually fires. The 409 counter is the cheap instrument that tells a future
  reader whether the roadmap's third bullet is worth building.
