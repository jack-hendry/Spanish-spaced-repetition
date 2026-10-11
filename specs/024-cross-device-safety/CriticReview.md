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

---

# Critic review — round 2 (against `tasks.md`)

Run 2026-10-11, top-level. Harden round 2 of 2 (Large). Same discipline as
round 1: every assumed signature, file path and grep count below was checked by
opening the file or running the command. Round 1's nine required changes are all
present in `Analyst.md`; this round reviews the **13-step plan** built from it.

Verdict: **the sequence is sound and every step ends at a green build, but eight
defects in the step text would each have cost a run.** R-1, R-2 and R-8 are
the ones that break a step outright; R-6 is a regression the plan would have
*introduced*.

## R-1 — BLOCKING. Step 8's handler registration references a variable that does not exist.

As written:

```ts
outbox.setConflictHandler(op => this.resolve(op, body));
```

`body` is not in scope in that lambda — it is a parameter of the handler, which
the arrow function never declares. The step's own `ConflictHandler` type (Step 7)
is `(op: OutboxOp, body: unknown) => Promise<ConflictOutcome>`, so this does not
compile. Must be:

```ts
outbox.setConflictHandler((op, body) => this.resolve(op, body));
```

Exactly the class of defect round 1's charter names: a plan can be perfectly
self-consistent and still not compile.

## R-2 — BLOCKING. Step 7's restore would set the `conflicts` signal to `undefined`.

`parseState` ends with `JSON.parse(JSON.stringify(obj))` — it deep-copies the
**stored** object wholesale rather than building a known shape
(`outbox-ops.ts`). So for every client whose `localStorage` predates this spec,
the parsed state has **no `conflicts` key at all**, and
`this.conflicts.set(state.conflicts)` sets a signal typed `OutboxOp[]` to
`undefined`. Every later `.length` read throws, inside the constructor, on app
boot — for exactly the users who have queued reviews.

Two fixes, both required: `parseState` must *write* the defaulted key
(`obj['conflicts'] = Array.isArray(obj['conflicts']) ? obj['conflicts'] : []`
before the deep copy), **and** the constructor must still read
`state.conflicts ?? []` as a belt-and-braces guard. Step 7's instruction to
"treat a missing `conflicts` array as `[]`" is correct in intent and
unimplementable as phrased.

The step's identification of the version-bump trap is right and is the more
dangerous half: bumping to `version: 2` would route every existing state through
`EMPTY_STATE` and **silently discard queued reviews**. Keep that warning.

## R-3 — A wrong `Done when` count fails a correct implementation.

Step 6 asserts `grep -c "expectedRev" review.ts` returns `3`. The step's own
`Do` adds exactly two lines containing the token (the `const` and the body
property). `grep -c` counts matching **lines**, so a correct implementation
returns `2` and the step reports failure. Changed to `2`.

Step 7's "`grep -c "version: 1"` is unchanged from before the step" is not a
command with a checkable answer. It is `1` today; say `1`.

## R-4 — Step 8 calls `optionsFor` with the wrong argument type.

Verified: `optionsFor(deck: Deck): DeckOptions | undefined`
(`collection.store.ts:219`) takes a **`Deck`**, not a deck id, and
`deckById(id)` (line 215) is the lookup. The step says "resolve options via
`store.optionsFor(deck) ?? store.defaultDeckOptions()` for the server card's
`deckId`", which reads as if a `deckId` can be passed. Spell out the two-step
lookup, including the `deckById` miss returning `unresolved`.

## R-5 — Step 3's falsifiability instruction risks the work it is checking.

`git stash` over a single path, with a brand-new untracked test file in the
tree, is fiddly and can lose the test. Replace with: comment out the
precondition block, run the single test, see it fail, uncomment. Same evidence,
no stash.

## R-6 — REGRESSION the plan would have introduced. Step 10 makes the tab permanently un-closable.

`onBeforeUnload` fires whenever the banner has text:

```ts
// app.ts:128-133
onBeforeUnload(event: BeforeUnloadEvent): void {
  if (this.outboxBannerText() !== null) event.preventDefault();
}
```

Step 10 adds a conflict branch to `outboxBannerText`, and a parked conflict is
**never auto-deleted** by design. So after a single unmergeable conflict the
user gets a "leave site?" prompt on every tab close, forever, with no way to
clear it — a worse outcome than the problem being solved.

Fix: the unload guard must key on genuinely unsent work, not on "the banner says
something". Step 10 must change `onBeforeUnload` to read
`pendingCount() > 0 || failed().length > 0` and **exclude** `conflicts`. Note
the pre-existing `failed` behaviour is deliberately left as-is (a poisoned op
blocking close is 023's existing choice, in no step's scope here) — this is only
about not extending it to conflicts.

## R-7 — Step 9's dev-server check cannot see a DI cycle the build already rejects.

Minor, but worth stating so the step is not read as stronger than it is: an
Angular cyclic dependency between two `providedIn: 'root'` services surfaces at
**injection** time, and `ConflictResolver` is only injected once `App`
instantiates it (Step 8). So Step 9's "load the app, confirm no cycle warning"
genuinely does test something — good — but the `grep` for `collection.store` in
`outbox.service.ts` is the load-bearing check, because a cycle introduced
through a *type-only* import would not fail at runtime at all. Keep both, and
say which one is authoritative.

## R-8 — BLOCKING for the executor. Steps 11 and 12 have no `Model:`-legal fallback if the user is unavailable.

Both are `Model: top-level` and require the **user** to drive two browser
profiles / a phone. That is correct — 023's retrospective says its equivalent
step should have been `top-level` + user "from the start". But neither step says
what to do if the user is not present, and a `tasks.md` run that reaches Step 11
unattended will either stall silently or improvise automation that 023 already
proved cannot drive it.

Add to both: if the user is not available, mark the step `in progress`, report
that the run is paused pending manual verification, and **stop** — do not
attempt browser automation, and do not proceed to the next step. Steps 11 and 12
are the only two steps in this plan that cannot be completed by an agent alone,
so saying so is cheap and prevents the failure mode.

## Also checked and found correct (no change needed)

- `RATINGS[button - 1]` is a safe reverse mapping for **both** schedulers:
  `RATING_BUTTON` is `{again:1,hard:2,good:3,easy:4}` (`types.ts:7-12`) and
  `fsrs.ts:21` is literally `const GRADE = RATING_BUTTON`.
- `todayNumber(collection, now)` takes an explicit instant
  (`collection.store.ts:51`), so D10 is implementable as written.
- `schedulerFor` is imported in `review.ts` from
  `../../core/scheduling/scheduler-factory` (line 17) and `Card` is already
  imported (line 16), so Step 6 adds no new import.
- All three spec files Steps 5, 6 and 10 modify exist
  (`collection.store.spec.ts`, `review.spec.ts`, `app.spec.ts`).
- `web/src/app/core/models/index.ts` is a single file holding the mirror, so
  Step 1's two-file edit is right.
- `revlogIds` is a private `Set<string>` with no public accessor
  (`file-store.ts:71`), so Step 2 genuinely must add `hasRevlogId`.
- Step 3's `rev: revlog?.id ?? cards[idx].rev` reads the old value correctly —
  the RHS is evaluated before the assignment.
- Every step carries `Model:` and `Status:`, and the gate command in
  `specs/TEMPLATE.md` passes (13 steps, 13 of each).
- No two steps share a file *and* lack a `Depends on` link, so nothing here is
  accidentally parallelisable in a way the ordering rules would miss.

## One standing rule to add to the preamble

023's Step 12 found that a `tasks.md` step pinning an exact code shape can be
invalidated by a lint rule the planner never ran (`require-await` forced four
methods from `async` to sync `void`; the deprecated `e.returnValue` was
replaced by `preventDefault()`). Step 5 prescribes turning `load()` from `async`
into a promise-returning method, which is exactly the shape that could trip such
a rule. The preamble should say: if a lint rule rejects a prescribed shape,
**report it and stop** — do not silently redesign, and do not disable the rule.
