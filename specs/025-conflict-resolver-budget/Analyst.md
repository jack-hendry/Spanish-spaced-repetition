# 025 — ConflictResolver: reload once per pass, bound re-applies per op

**Size: Large.** Touches the outbox drain loop and the persisted outbox op shape
(`localStorage`), and re-runs the scheduler — `CLAUDE.md`'s "anything touching
scheduling or the on-disk shape is at least Large". Closes the 2026-10-15 Open
Quick Task in `specs/STATE.md` and AD-030's amendment. Decision: AD-032.

Status: **implemented 2026-10-15 — all of A1–A9 MET (verdicts in §5a).**
Human-reviewed; two harden rounds (`CriticReview.md` C-1…C-27). Not yet
committed or archived.

## 1. Problem

Spec 024 made the server reject a review built on a stale card (409, AD-030) and
gave the client a `ConflictResolver` that re-applies the rejected rating on top
of the server's card (D6). The resolver's loop bound is wrong:

- `resolve()` calls `store.load()` on **every** conflict and increments
  `reloadsThisPass`; at 2 it returns `'reload budget exhausted'`.
- `reloadsThisPass` resets only when `outbox.pendingCount()` reaches 0
  (an `effect()` in the constructor).

So a stale queue with 3+ conflicting ops — the phone studied offline, the
desktop studied the same cards — re-applies the first two and **parks every
later one** in `conflicts`. A parked op is never retried: that review's
scheduling is lost (until a human acts on the conflicts list), even though its
409 body already carried the server card needed to re-apply it.

The bound buys nothing. Its stated purpose (D6) was the tier-1 rate limiter
(`server/src/app.ts`: 20 failures / 15 min, `skipSuccessfulRequests`). But every
conflicting op costs exactly one 409 whether the client reloads or not, and the
reload (`GET /collection`, `GET /cards`) is a 2xx, so it never counted. The
second reload in a pass re-fetches the same snapshot the first one did.

The bound is also keyed to the wrong thing for its *other* job — stopping a
ping-pong where one op keeps 409ing. A per-pass counter cannot tell "one op
conflicting forever" from "many ops each conflicting once".

## 2. Facts established from the code (2026-10-15, critic-verified)

1. `OutboxService._runDrain()` awaits `conflictHandler(op, errObj['error'])`. On
   `'replaced'` it overwrites the queue head with `{ ...outcome.replacement,
   attempts: 0, failedReason: null, createdAt: Date.now() }` and loops — so the
   replacement is sent next, in the same pass, and **any extra field on
   `replacement` is carried into the persisted op.** Retry, poison, park and
   `retryFailed()` all spread `...op` too (C-9).
2. The replacement's `id` is a **fresh** `RevlogEntry.id`, so an op's lineage
   cannot be tracked by `op.id` across re-applies.
3. `parseState()` copies ops verbatim — an optional field added to `OutboxOp`
   survives a `localStorage` round-trip, and its absence in a pre-025 op is
   harmless (L-030: widen, never bump `version`). It never reaches the server:
   only `op.body` is sent.
4. **A conflict cascades along a card's chain** (C-8). An offline chain X1 → X2
   of one card has X2's `expectedRev` = X1's original `revlog.id`. Once X1 is
   re-applied under a fresh id, X2 409s too and is itself re-applied on the 409
   card, which already holds X1′'s result. That is *correct* — X2's body holds
   an absolute card state computed from X1's old result, so it must be
   recomputed, never sent with a patched `expectedRev` (that would clobber). A
   per-**card** bound would wrongly park legitimate chains.
5. `store.load()` returns the in-flight promise (L-028), **and swallows its own
   errors** (`_runLoad`'s `catch` sets `store.error()`), so `await load()`
   always resolves — success must be read from `store.error()` (C-3).
6. The re-apply reads the **card** from the 409 body, and reads only **deck
   options and `collection`** (for `todayNumber`) from the store. That is what
   the reload is for: a desktop may have changed deck options or added a deck
   the phone has never seen.
7. Each pass is one `_runDrain()`: the retry `setTimeout` and `drain()`'s
   coalescing re-run both start a fresh one (C-10). `ConflictResolver` injects
   `OutboxService`, never the reverse — no DI cycle (C-4).

## 3. Scope

- **D1 — Reload at most once per drain pass, and only a successful reload
  counts.** `OutboxService` keeps `private drainPass = 0`; `_runDrain()` starts
  with `const pass = ++this.drainPass;` and calls
  `this.conflictHandler(op, errObj['error'], pass)`. `ConflictHandler` widens to
  `(op, body, pass: number) => Promise<ConflictOutcome>` — existing
  two-parameter handlers still type-check. The resolver keeps
  `private reloadedForPass: number | null = null`; it reloads iff
  `reloadedForPass !== pass`, and sets `reloadedForPass = pass` **only if
  `store.error() === null`** after the load (fact 5), so a failed reload is
  retried by the next conflict. Passing the id in (rather than the resolver
  reading an outbox field) keeps the resolver's unit tests independent of the
  constructor's boot drain (C-4). This replaces the `pendingCount() === 0`
  effect, which never resets for a pass ending in a retry `'waiting'` break.
- **D2 — Bound re-applies per op lineage, not per pass.** `OutboxOp` gains an
  optional persisted `reapplies?: number` (absent = 0). `MAX_REAPPLIES = 2`.
  The resolver returns `'unresolved'` with reason `'reapply limit reached'` when
  `(op.reapplies ?? 0) >= MAX_REAPPLIES`, and otherwise stamps the replacement
  with `reapplies: (op.reapplies ?? 0) + 1`. Arithmetic, written out once:
  original (0) → 409 → replacement (1) → 409 → replacement (2) → 409 →
  parked. At most three sends and three 409s for one review. Persisting it means
  the bound survives an app reload and a retry break.
- **D3 — Cheap checks before the reload** (C-5). Order inside `resolve()`:
  path → reapply limit → 409 card → revlog → rating → reload (if this pass has
  not reloaded successfully) → deck → options → collection → schedule. An op
  that will be parked never spends the pass's reload; deck/options lookups stay
  after it (a new deck may exist only post-reload).
- Remove `reloadsThisPass`, the reset `effect()` (its only use — C-13) and the
  `'reload budget exhausted'` reason. Update the class doc comment.
- Amend the two resolver tests that pin the old bound
  (`third consecutive conflict in one pass…`, `a replacement op that itself
  409s cannot loop forever…`) — they assert the bug (L-032). Replace, don't
  delete. Change T19's fake reason in `outbox.service.spec.ts` (an opaque
  string there) to a neutral one so no grep hit for the retired reason
  survives (C-6).

## 4. Out of scope

- **The 409 cascade along a card chain** (fact 4) — one 409 per op in the chain
  against the 20-failure limiter. Unchanged, neither worsened nor fixed.
  Rewriting later ops' `expectedRev` is *wrong*, not merely deferred.
- **The rate-limiter lockout itself** for a queue with >20 conflicting ops —
  still out of scope, as in 024. This spec adds no 409: each conflicting op
  still costs one, and the per-lineage bound caps a ping-pong at three.
- **A mid-drain reload re-serving an already-answered card** (C-2; Discovered
  below, own Quick Tasks row). D1 shrinks it to one reload per pass; it does not
  fix it.
- Re-trying ops already sitting in `conflicts` from before this fix. They stay
  parked (never auto-deleted, 024 D6); no migration.
- Any server change. Any scheduling math. The UI wording for conflicts (024 D7).
  `conflictCount` semantics (still every 409 — C-15).

## 5. Acceptance — how do we know it is done

All integration criteria (A1, A3, A4, A5, A6) live in a new
`web/src/app/core/outbox/conflict-drain.spec.ts` wiring the **real**
`OutboxService` + real `ConflictResolver` + real `CollectionStore` to a fake
`ApiService` providing `send`, `getCollection` and `getCards` (`store.load()`
calls both — C-7). `store.load` is counted with a `vi.spyOn`. Ops are seeded
into `localStorage` **before** the outbox is constructed, so the whole queue is
present when the first pass starts.

- **A1 — A stale queue of 5 conflicting ops on 5 distinct cards drains fully in
  one pass.** Each op's first send 409s with a server card; its replacement
  sends 200. End state: `pending` and `conflicts` empty, `store.load` called
  **exactly once**, the fake saw exactly **5** 409s and 10 sends.
- **A2 — A1 is red against the current resolver.** Shown by running the new
  spec with only `conflict-resolver.ts` reverted to `HEAD` (expected: ops 3–5 in
  `conflicts` with `'reload budget exhausted'`, `load` called 2 times). The
  revert is restored in the same shell command (L-034).
- **A3 — A lineage that keeps 409ing is parked after 2 re-applies, and the queue
  behind it drains** (C-1: built so it is red on old code). Two one-shot
  conflicting ops on other cards sit *ahead* of op A in the same pass; A 409s
  on every send; op B behind A succeeds. A is in `conflicts` with
  `'reapply limit reached'` and `reapplies === 2` after exactly 3 sends of A's
  lineage; B is sent; `pending` is empty. (Old code parks A on its first 409.)
- **A4 — An offline chain of 3 reviews of one card, all conflicting, all
  re-apply.** The fake `/review` is **stateful**: it holds one card, 409s when
  `expectedRev !== stored.rev` (returning `{ error, card }`), otherwise stores
  `{ ...card, rev: revlog.id }` and returns it — so the cascade is produced by
  the rule, not scripted. Expect 6 sends, 3 409s, 1 load, nothing parked, and
  each accepted op's `expectedRev` equal to the previously accepted
  `revlog.id`. Red on old code (X3 hits the budget).
- **A5 — A new pass reloads again.** Pass 1: one conflicting op,
  `await outbox.drain()`. Then enqueue a second conflicting op and drain:
  `store.load` called 2 times. *Regression guard, not a bug proof* — it also
  passes on old code; it catches an implementation that reloads once ever.
- **A6 — `reapplies` is persisted and a pre-025 op is treated as 0.** After a
  replacement, `JSON.parse(localStorage[OUTBOX_KEY]).ops[0].reapplies === 1`
  (checked while the replacement is in flight); an op with no field re-applies
  normally.
- **A7 — A failed reload is not recorded** (C-3, resolver unit test). With
  `store.load` stubbed to set `store.error`, two conflicts in one pass call it
  twice; with it succeeding, once.
- **A8 — D10 is untouched.** The existing "replacement scheduling is computed at
  `revlog.reviewedAt`" test passes unmodified.
- **A9 — test / build / lint / format green, by exit code** of
  `npm run test`, `npm run build`, `npm run lint:ci`, `npm run format:check`
  (L-031). `grep -rn "reload budget exhausted" web/src` returns nothing.

## 5a. Verdicts (2026-10-15)

- **A1 — MET.** `conflict-drain.spec.ts` › "a stale queue of 5 conflicting ops
  …": pending/conflicts empty, `load` ×1, 5 409s, 10 sends, every path `/review`.
- **A2 — MET.** Run against HEAD's resolver (tasks Step 4, `trap`-restored):
  `old-resolver exit=1`, A1 failed with `expected [ { id: 'op-3', … }, …(2) ]
  to have a length of +0 but got 3` — ops 3–5 parked, exactly the bug.
- **A3 — MET.** Lineage parked with `'reapply limit reached'`, `reapplies` 2,
  after 3 sends; B sent. Red on HEAD (`expected 1 to be 3`).
- **A4 — MET.** Stateful fake: 6 sends, 3 409s, 1 load, nothing parked, each
  accepted `expectedRev` = previous accepted `revlog.id`. Red on HEAD (5 sends).
- **A5 — MET.** Second pass reloads (`load` ×2). Green on HEAD as predicted — a
  regression guard, not a bug proof.
- **A6 — MET.** Persisted replacement carries `reapplies: 1`; seeded pre-025 ops
  (no field) re-apply normally. Red on HEAD (`expected undefined to be 1`).
- **A7 — MET.** `conflict-resolver.spec.ts` › "a failed reload is not recorded
  …": loads 2 then 3.
- **A8 — MET.** D10 test body unchanged except the pass argument
  (`reviewedAt` diff grep → 0); passes.
- **A9 — MET.** `npm run test` exit 0 (server 95, web 296), `npm run build`,
  `lint:ci`, `format:check` exit 0; retired-reason grep empty.

## 6. Open questions — resolved

1. `MAX_REAPPLIES = 2` → **kept** (human, 2026-10-15; C-17 arithmetic in D2).
2. Keep the reload → **yes** (human, 2026-10-15): stale options on a phone
   offline for days, and a reload is a 2xx the limiter never counts.

## Discovered

- **(2026-10-15, C-2) A mid-drain reload can make the study queue re-serve — and
  double-schedule — a card already answered whose op succeeded later in the
  same pass.** `store.load()` replaces every card with server state; an op
  further back that then succeeds never calls `applyCard`, so `store.cards()`
  keeps the pre-review card and `StudyQueueService.next()` sees it as due.
  `Review.init()` forces a reload only `if (this.outbox.pendingCount() > 0)` at
  init, so a drain that finished earlier (boot drain, `online` event) or one
  running mid-session leaves the reverted cache in place. Re-answering it sends
  the pre-review `expectedRev`, 409s, and is re-applied on top: **reviewed
  twice**. Pre-existing; out of scope; Quick Tasks row 2026-10-15. Cheap
  future fix: `/review` already returns the stored card on 200
  (`res.json(cards[idx])`) and the outbox discards it.

## Retrospective

- **Did Analyst.md catch anything not thought about up front?** Yes — fact 4
  (the cascade along one card's chain) ruled out the obvious per-card bound
  before any code existed. Round 1 then found the reload-failure hole (C-3) and
  the conditional `Review.init()` reload behind C-2, a real double-schedule bug
  now tracked separately.
- **Did anything in tasks.md turn out to be wrong during coding?** Nothing
  reached a run: round 2's C-18 (the real store's `unburyForNewDay()` enqueuing
  `PATCH /collection` mid-drain) would have broken five of six criteria and was
  fixed on paper. The one execution slip — Step 3's executor calling `setup()`
  before `seed()` — was caught by its own red run and fixed inside the step.
