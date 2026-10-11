# Critic review — round 1 (against `Analyst.md`, before `tasks.md`)

Run 2026-10-11, top-level. Harden round 1 of 2 (Large). Per
`specs/TEMPLATE.md`, every assumption about a type, signature or return value
below was checked by **opening the file**, not by re-reading the plan. File
and line references are from the working tree at `origin/main` + the archive
commit.

Verdict: **the design holds, but three findings change it and must be folded
into `Analyst.md` before `tasks.md` is written.** C-1 and C-8 are the two that
would have broken a run.

---

## C-1 — BLOCKING. The conflict resolver cannot live in `OutboxService`: that is a circular dependency.

`Analyst.md` §2 puts "a conflict resolver: re-run the scheduler … against the
server's returned card" in the web scope without saying **where** it lives, and
D6 describes it as acting "inside the outbox's failure path". That is not
constructible as written.

Verified: `CollectionStore` already injects `OutboxService` —

```ts
// web/src/app/core/collection.store.ts:64-65
private readonly api = inject(ApiService);
private readonly outbox = inject(OutboxService);
```

and `OutboxService` currently injects only `ApiService`
(`outbox/outbox.service.ts:10`). A resolver needs **all** of:

- the card's `DeckOptions` → `store.optionsFor(deck)`
  (`study-queue.service.ts:48` is the existing caller)
- `collection` for `todayNumber()` → `CollectionStore`
- `applyCard()` to update the local cache

i.e. it needs `CollectionStore`. Putting it in `OutboxService` makes
`OutboxService → CollectionStore → OutboxService`, which Angular DI reports as
a cyclic dependency at runtime, and which is also an ESM import cycle.

**Required fix — invert the direction.** `OutboxService` must stay ignorant of
the store. It owns *detection* only: classify 409, hold the op, expose it. A
separate `ConflictResolver` (new, `core/outbox/conflict-resolver.ts`, injecting
`CollectionStore` + `OutboxService`) owns *resolution* and registers itself with
the outbox — either a `setConflictHandler(fn)` seam or a signal the resolver
reacts to. This must be a named design decision (**D8**), because an
implementer who discovers it at Step 6 will either invent a different seam or
reach for `forwardRef` and leave a cycle behind.

Note this mirrors a shape the codebase already prefers: `OutboxService` was
deliberately kept free of `CollectionStore` in 023 for the same reason.

---

## C-2 — BLOCKING. A per-op re-apply bound multiplies 409s into a rate-limiter lockout, and the fix changes D6's shape.

`Analyst.md` A7 claims "no 409 contributes to the backoff schedule or the
rate-limiter failure budget". The second half is **false and not achievable
client-side.** Verified:

```ts
// server/src/app.ts:70-78  (tier 1, before basicAuth, all routes)
rateLimit({ windowMs: 15*60*1000, limit: 20, skipSuccessfulRequests: true, … })
```

`skipSuccessfulRequests` skips **2xx**. A 409 is not 2xx, so every rejected
review spends one of 20 failures per 15 minutes, for the whole app, on every
route — the same budget whose exhaustion locked the phone out of its own auth
challenge in 023 Step 14.

Now compose that with D6's "cap re-apply attempts per op (proposed: 3)". A
stale device's queue is stale *in bulk*: if the snapshot is old, it is old for
every queued op, not just the head. So N conflicting ops × 3 attempts ≈ 3N
409s. **Seven conflicting ops exhaust the budget and lock the entire app out
for 15 minutes**, while the banner says reviews are unsaved — precisely the
failure 023's C-5 set the backoff floor to prevent, arriving by a different
road.

**Required fix — resolve per *snapshot*, not per op.** A 409 means "my snapshot
is stale", which is a statement about the whole queue. The response should be:

1. Pause draining.
2. Re-load the collection **once** (`store.load()`).
3. Re-apply the affected op(s) against the fresh state.
4. Resume draining.

That is one reload plus one retry per op instead of 3N blind round-trips, it is
literally what the roadmap bullet says ("reload and re-apply"), and it bounds
total 409s at roughly one per genuinely-conflicting review. The bound then
belongs on *reload cycles* (e.g. 2 per drain pass), not on per-op attempts.

Consequence for `Analyst.md`: **A7 must be restated** as "a 409 is never
retried blindly; each rejected op produces at most one 409 per reload cycle,
and the design keeps the total well inside the 20-failure tier-1 budget".
Claiming zero contribution is unachievable.

Also note step 2 hits the known `CollectionStore.load()` early-return hazard
(`collection.store.ts:137`, `if (this.loading()) return;`) recorded in 023's
Discovered and generalised as **L-028** — a reload that overlaps an in-flight
load is silently skipped, so the resolver would re-apply against the *same*
stale array and conflict again. The resolver must not assume `await load()`
actually reloaded. This is the third sighting of that shape; `tasks.md` should
consider fixing `load()` to return the in-flight promise rather than working
around it a third time.

---

## C-3 — The scheduler's spread silently carries the *old* `rev`, on both sides.

D2 says `rev` is the new `RevlogEntry.id`, and §2 says the client sets its local
card's `rev` itself. Reading the code shows there are **two** places that must
assign it, and both are easy to "simplify" away:

```ts
// scheduling/sm2.ts:53  (fsrs.ts:68 identical in this respect)
return { ...card, reps: card.reps + 1, lastReviewed: ctx.now, modified: ctx.now };
```

The spread carries `rev` through unchanged, so the scheduler's output card
holds the **previous** token.

1. **Server must assign authoritatively.** `POST /review` does
   `cards[idx] = { ...card, modified: Date.now() }` (`routes/index.ts:120`) —
   spreading the *client's* card, so a client-held stale `rev` would be
   persisted. The route must set `rev: revlog.id` itself and never trust
   `card.rev`. Otherwise the stored token stays one review behind and **every
   subsequent write conflicts forever** — a self-inflicted permanent conflict.
2. **Client must assign locally.** If `applyCard(next)` stores a card whose
   `rev` is the old token, the *next* review in the same session sends a stale
   `expectedRev` and false-conflicts — which is exactly the A4 trap D1 was
   written to avoid, re-entering through the back door.

`Analyst.md` implies both but states neither as a rule. Say it: **`rev` is
assigned exactly where a new `RevlogEntry` is minted, on both sides, and is
never propagated by a spread.** A test for each half.

---

## C-4 — `expectedRev: undefined` and `expectedRev: null` must mean different things, because Phase 3 ops outlive the deploy.

D4 says "absent `rev` matches absent `rev`". There are two distinct absences and
the plan conflates them:

- **`undefined` / key missing** — an op enqueued by the *current* (Phase 3)
  build, sitting in `localStorage` right now, which will drain after the Phase 4
  deploy. It carries no `expectedRev` because the concept did not exist.
- **`null`** — a Phase 4 client explicitly asserting "the card I scheduled from
  had no `rev`".

If the server treats a missing key as `null` ("assert the stored card has no
`rev`"), a legitimate pre-deploy op targeting an already-reviewed card is
rejected 409 — and the resolver then re-applies it, which is survivable but is
a spurious conflict on the first post-deploy drain. Decide and test:

**`undefined` = wildcard, skip the precondition** (backward compatibility for
in-flight Phase 3 ops); **`null` = assert absent.** The wildcard is a real but
one-time, bounded hole: it lasts only until the pre-deploy queue drains. Say so
in the Analyst rather than leaving it to be discovered.

---

## C-5 — The resolver's `ReviewContext` is a scheduling decision, and the plan does not make it.

D6 says the resolver has "everything `Scheduler.answer()` needs". Verified
against the signatures — nearly true, and the gap is the interesting part:

```ts
// scheduling/types.ts:15-18
export interface ReviewContext { now: number; today: number; }
// RevlogEntry carries button: 1|2|3|4, timeMs, reviewedAt  (models/index.ts:182-192)
// answer(card, rating, opts, ctx, timeMs)                  (review.ts:295-301)
```

`button` and `timeMs` are present, so the rating survives. But **`ctx` is not in
the revlog**, and the choice of `now` changes the resulting schedule:

- `now = Date.now()` (re-apply time) → a learning step computed hours after the
  answer pushes `due` hours later than the user earned.
- `now = revlog.reviewedAt` (original answer time) → the result matches what
  would have happened had the op arrived in order. A learning `due` may land in
  the past, which makes the card immediately due — correct, and the study queue
  handles it (`due <= ctx.now`).

Recommendation: **use `revlog.reviewedAt`**, with
`today: todayNumber(coll, revlog.reviewedAt)`. Verified implementable —
`todayNumber(collection, now = Date.now())` already takes an explicit instant
(`collection.store.ts:51`). This is scheduling semantics, so per the prime
directive it belongs in `Analyst.md` as a decision, not in an implementer's
judgement. It also needs a `scheduling-domain` lesson if it ships, since
"re-schedule at the original instant" is a new rule in this codebase.

---

## C-6 — Trimming the revlog-id set would silently re-enable the clobber.

D5 makes "dedupe first, and a replay must not write the card" load-bearing for
*correctness*, not just for append-dedupe. That promotes an assumption 023
recorded as optional: 023's D4 named "retain only the last N ids" as a
deliberately-unbuilt escape hatch for the unbounded in-memory
`Set<string>`.

After Phase 4, trimming that set does not merely re-admit a duplicate revlog
line — it lets a late replay **overwrite a newer card state**, because a replay
whose id has been forgotten falls through to the precondition branch with a
stale `expectedRev`… where it is correctly rejected. So the damage is bounded to
a spurious conflict rather than a clobber. Lower severity than it first looks,
but the coupling is now real and undocumented: record in `Analyst.md` that the
id set's completeness is a Phase 4 correctness input, so whoever builds the
trim knows it interacts.

---

## C-7 — A2's falsifiability check conflates a manual run with an automated test.

A1 is a **manual two-device run**; A2 says "the test that proves A1 must fail
against `main`". A manual run cannot be re-run against `main` cheaply, and
nobody will. Sharpen: the *server integration test* for the stale-write
rejection must be verified **red against the pre-change route** and green after
— the same falsifiability discipline 023 Step 6 applied to its FIFO test. Keep
A1 as the manual acceptance; make A2 a property of the automated test.

---

## C-8 — Minor / record only

- **The 200 response body changes on a dedupe hit** (it returns the stored card,
  not the client's). Verified harmless: `rate()` discards the response
  (`review.ts`, 023 D3) and `_runDrain` ignores the body
  (`outbox.service.ts:102-107`). Record it so nobody introduces a
  response-dependency later.
- **`POST /collection/resume` sets `due` without touching `modified` or
  `rev`** — already in the Analyst's Discovered. Worth one line in D-scope
  saying the precondition does not cover resume, rather than only in Discovered.
- **A conflict counter is cheap and is the only thing that can answer "was
  declining presence signalling right?"** The Analyst's Discovered says this;
  promote it to in-scope. One incremented number, surfaced in the UI or logged,
  turns a guess into a measurement.
- **`rev` appears in `cards.json` progressively** (only on reviewed cards), so
  the backup diff will show a growing field. No gate cares — `backup.yml`
  commits the file wholesale — but expect the first post-deploy backup commit to
  be large-ish as cards acquire tokens.

---

## Required changes to `Analyst.md` before `tasks.md`

1. **Add D8** — resolver lives outside `OutboxService`; the outbox detects, a
   `ConflictResolver` resolves; name the seam (C-1).
2. **Rewrite D6** — resolve per snapshot (pause → reload once → re-apply →
   resume), bound reload cycles rather than per-op attempts (C-2).
3. **Restate A7** — a 409 does count against the tier-1 budget; claim bounded
   contribution, not zero (C-2).
4. **Add D9** — `rev` is assigned only where a `RevlogEntry` is minted, on both
   sides, never carried by a spread (C-3).
5. **Sharpen D4** — `undefined` = wildcard, `null` = assert absent, with the
   one-time pre-deploy hole stated (C-4).
6. **Add D10** — the resolver re-schedules at `revlog.reviewedAt`, not at
   re-apply time (C-5).
7. **Rewrite A2** — falsifiability attaches to the automated server test (C-7).
8. **Add to scope** — a conflict counter (C-8).
9. **Note** — revlog-id set completeness is now a correctness input (C-6), and
   the resolver must not trust `load()` to have reloaded (C-2 / L-028).
