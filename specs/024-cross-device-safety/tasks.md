# tasks — 024 · Cross-device safety

**13 steps, in order, do not skip ahead.** Checkpoints at Steps 4, 9 and 13.
Read `Analyst.md` first; every `D-` reference below points at a decision there.

Required reading before touching code: `.claude/skills/scheduling-domain`
(every step except 11–13 touches the card data model or the study loop) and
`.claude/skills/angular-conventions` (any step with a `web/src/app/` file).
`.claude/skills/testing-playbook` before any step's `Done when`.

**Baseline for test counts:** server **88 tests / 14 files**, web **268 tests /
23 files**, as re-verified 2026-10-11 at `96e6cde`.

**Two standing rules from 023's retrospective, applied to every step below:**

1. **A green test suite is not a green build.** `vitest` does not type-check, so
   every step's `Done when` carries an explicit `npm run build` bullet. 023's
   Step 1 passed every bullet it was given while the build was red.
2. **Error-path tests must use real framework objects.** A mocked
   `HttpErrorResponse` whose `headers` is a plain object does not exercise the
   real bound method, which is how L-029's `this`-binding crash shipped through
   three green passes. Any test that constructs an HTTP error uses
   `new HttpErrorResponse({ status: …, headers: new HttpHeaders(), error: … })`.
3. **If a lint rule rejects a shape a step prescribes, report it and STOP.** Do
   not silently redesign, and do not disable the rule. 023's Step 12 had
   `require-await` force four methods from `async` to sync `void` and the
   deprecated `e.returnValue` replaced by `preventDefault()` — both were the
   right outcome, and both were decided by the user rather than by the
   implementer. Step 5 below prescribes exactly the kind of `async` → promise
   change that can trip such a rule.

---

### Step 1 — Add the optional `rev` token to `Card`, both mirrors

**Model:** haiku

**Status:** not started

**Files**
- MODIFY `server/src/models/index.ts` — anchor: `export interface Card` (~line 77)
- MODIFY `web/src/app/core/models/index.ts` — anchor: the mirrored `Card` interface
- DO NOT TOUCH: `server/src/store/seed.ts`, `server/src/store/migrations.ts`,
  `server/src/import/transform.ts`. `rev` is deliberately absent-tolerant (D4),
  so there is **no** migration and **no** importer change in this spec.

**Context**
`server/src/models/index.ts` is the canonical data model; the web copy mirrors it
and CLAUDE.md requires the two stay in sync. The field is optional on purpose:
every card on disk today lacks it and self-migrates as cards are reviewed (D4).
`reconcileNoteCards` already spreads `{ ...prior }` for surviving ords
(`server/src/cards/generate.ts:101`), so the token survives note edits with no
work here.

**Do**
1. In both files, add to `Card`, immediately after the `modified: number;` line:
   ```ts
   /** Optimistic-concurrency token: the `RevlogEntry.id` of the review that
    *  produced this state. Absent on cards not yet reviewed under spec 024.
    *  Compared by EQUALITY only, never by ordering (D3). */
   rev?: string;
   ```
2. Change nothing else. No route, no store, no client code in this step.

**Done when**
- `npm run build` — exit 0 for **both** workspaces.
- `grep -c "rev?: string" server/src/models/index.ts web/src/app/core/models/index.ts`
  returns `1` for each file.
- `npm run test` — server 88, web 268, unchanged (this step is type-only).

**If blocked**
If the two `Card` interfaces have drifted so the same insertion point does not
exist in both, STOP and report the drift rather than reconciling them — that is
a pre-existing problem outside this spec.

---

### Step 2 — Expose revlog-id membership on `FileStore`, and make `POST /review` dedupe *before* it writes

**Model:** haiku

**Status:** not started

**Depends on:** Step 1 — needs `Card.rev` to exist so the route compiles once
Step 3 assigns it. (This step does not read `rev` yet.)

**Files**
- MODIFY `server/src/store/file-store.ts` — anchor: `appendRevlog` (~line 221)
- MODIFY `server/src/routes/index.ts` — anchor: `r.post('/review'` (~line 115)
- CREATE `server/src/routes/review-staleness.integration.test.ts`
- DO NOT TOUCH: `server/src/routes/review-idempotency.integration.test.ts`
  (023's file — it must keep passing **unchanged**; that is A3)

**Context**
`revlogIds` is a private `Set<string>` on `FileStore`, populated at `init()` and
added to by `appendRevlog`, which already no-ops on a known id
(`file-store.ts:221-225`). The route cannot currently *ask*, so it applies the
card first and dedupes second. D5 inverts that: a replay must return 200 and
**not** write the card, because re-applying would clobber a newer review. The
existing integration test for idempotency
(`review-idempotency.integration.test.ts`) is the pattern to imitate for the new
test file.

**Do**
1. In `FileStore`, add next to `appendRevlog`:
   ```ts
   /** Has this revlog entry already been appended? The route uses this to
    *  detect a replay BEFORE writing the card (spec 024 D5). */
   hasRevlogId(id: string): boolean {
     return this.revlogIds.has(id);
   }
   ```
2. In `r.post('/review')`, immediately after the `idx === -1` 404 guard, insert
   the replay branch — before any write:
   ```ts
   // D5: a replay of an already-applied review must NOT re-write the card.
   // The response that never arrived is what makes the client retry, and
   // re-applying its card state would clobber a newer review from another
   // device. Return the stored card so the contract is unchanged.
   if (revlog && store.hasRevlogId(revlog.id)) {
     return res.json(cards[idx]);
   }
   ```
3. Leave the rest of the handler exactly as it is in this step.
4. In the new test file, cover (imitating 023's integration-test setup):
   - POSTing a review twice appends exactly **one** revlog line **and** the
     second response leaves the stored card byte-identical to the first — assert
     with `JSON.stringify(first) === JSON.stringify(second)`.
   - A replay whose body carries a *different* card state for the same
     `revlog.id` does **not** overwrite the stored card. This is the clobber
     case and is the point of the step.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm test -w server -- review-staleness.integration.test.ts` — the new cases
  pass.
- `npm test -w server -- review-idempotency.integration.test.ts` — 023's 3 cases
  still pass, file unmodified (`git diff --quiet -- server/src/routes/review-idempotency.integration.test.ts`).
- `npm run test -w server` — 88 + the new cases, 0 failures.

**If blocked**
If `revlogIds` is no longer a `Set<string>` on `FileStore`, STOP and report —
Step 2's design depends on 023's dedupe set being intact (see `Analyst.md`
Discovered / C-6).

---

### Step 3 — Add the `expectedRev` precondition and assign `rev` server-side

**Model:** haiku

**Status:** not started

**Depends on:** Step 2 — the precondition must sit *after* the replay branch it
adds; that ordering is D5 and is load-bearing.

**Files**
- MODIFY `server/src/routes/index.ts` — anchor: `r.post('/review'` (~line 115)
- MODIFY `server/src/routes/review-staleness.integration.test.ts` (from Step 2)
- DO NOT TOUCH: `r.patch('/cards/:id')`, `r.patch('/decks/:id')`,
  `r.patch('/collection')`, `r.post('/collection/resume')` — all four are
  explicitly out of scope (`Analyst.md` §3). Adding a precondition to any of
  them is drift.

**Context**
D9 is the trap: `cards[idx] = { ...card, modified: Date.now() }` spreads the
**client's** card, and the schedulers propagate the old `rev` through their own
`{ ...card }` spread. So the route must assign `rev` itself and never trust
`card.rev`; otherwise the stored token stays one review behind and every later
write conflicts forever. D4 distinguishes the two absences: a **missing**
`expectedRev` is a wildcard (a Phase 3 op still in someone's `localStorage`),
while an explicit `null` asserts the stored card has no `rev`.

**Do**
1. Widen the body type to
   `{ card: Card; revlog?: RevlogEntry; expectedRev?: string | null }`.
2. After the Step 2 replay branch, insert:
   ```ts
   // D4/D3: equality-only precondition. `undefined` is a wildcard for ops
   // queued by a pre-024 client; an explicit `null` asserts "no rev yet".
   if (expectedRev !== undefined) {
     const storedRev = cards[idx].rev ?? null;
     if (storedRev !== expectedRev) {
       return res.status(409).json({ error: 'stale card', card: cards[idx] });
     }
   }
   ```
3. Change the write so the server owns the token (D9) — note `rev` is set from
   the revlog id and the client's `card.rev` is discarded:
   ```ts
   cards[idx] = { ...card, modified: Date.now(), rev: revlog?.id ?? cards[idx].rev };
   ```
4. Extend the test file with: stale `expectedRev` → 409 and the stored card is
   **unchanged**; matching `expectedRev` → 200 and stored `rev === revlog.id`;
   `expectedRev: null` against a card with no `rev` → 200; `expectedRev: null`
   against a card that *has* a `rev` → 409; `expectedRev` omitted entirely →
   200 regardless of stored `rev` (the wildcard).
5. **A2 (falsifiability):** before committing, confirm the stale-rejection case
   is **red** against the pre-change route. Do this by **commenting out the
   precondition block from (2)**, running that single test, observing the
   failure, then uncommenting — *not* with `git stash`, which over a single path
   with a brand-new untracked test file in the tree can lose the test. Record
   the observed failure message in this step's `Status:`.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w server` — all green, 0 failures.
- The stale-rejection test was observed failing without the route change, and
  the failure text is quoted in `Status:`.
- `grep -c "409" server/src/routes/index.ts` returns exactly `1`.

**If blocked**
If adding `rev` to the assignment in (3) produces a type error because `Card`
has no `rev`, STOP — Step 1 did not land.

---

### Step 4 — Checkpoint: server half complete

**Model:** haiku

**Status:** not started

**Depends on:** Steps 1–3.

**Files**
- None. No new code. Re-verification only.

**Do**
1. Re-run the previous three steps' `Done when` commands and record the actual
   numbers, not a restatement.
2. Confirm `git diff --stat origin/main..HEAD` touches **only**
   `server/src/models/index.ts`, `web/src/app/core/models/index.ts`,
   `server/src/store/file-store.ts`, `server/src/routes/index.ts` and the new
   test file. Any other file is drift from Steps 1–3 — report it.
3. Confirm no client code has been changed yet.

**Done when**
- `npm run test` — server ≥ 88 + new cases, web 268, 0 failures.
- `npm run build`, `npm run lint:ci`, `npm run format:check` — all exit 0.
- The file list in (2) matches exactly; any extra file is named in `Status:`.

**If blocked**
If any earlier step's `Done when` no longer holds, mark **that** step
`in progress` again and say so. Do not push forward on a false premise
(`specs/TEMPLATE.md`, Status field).

---

### Step 5 — Make `CollectionStore.load()` await an in-flight load instead of early-returning

**Model:** haiku

**Status:** not started

**Depends on:** none — it shares no file with Steps 1–4.

**Files**
- MODIFY `web/src/app/core/collection.store.ts` — anchor: `async load()` (~line 136)
- MODIFY `web/src/app/core/collection.store.spec.ts` (create if absent)
- DO NOT TOUCH: `web/src/app/features/review/review.ts`,
  `web/src/app/core/outbox/outbox.service.ts`. Callers must need no change.

**Context**
`load()` opens with `if (this.loading()) return;`, which returns **immediately**
rather than awaiting the in-flight load, so every caller's `await` is
meaningless and the caller proceeds against the pre-load card array. This is
**L-028**, and this is its third sighting (023's study-route gate, 023's
Discovered, and now D6's resolver reload, which would otherwise re-apply against
the same stale array and conflict again). `Analyst.md` open question 4, approved
by the user, fixes it properly rather than working around it a third time.

**Do**
1. Add a private field `private loadPromise: Promise<void> | null = null;`.
2. Restructure `load()` so the in-flight promise is **returned**, not skipped —
   keep the existing body as a private `_runLoad()` and make `load()`:
   ```ts
   load(): Promise<void> {
     // L-028: return the in-flight load so a caller's `await` means what it
     // says. The old `if (this.loading()) return;` resolved immediately and
     // let the caller read the pre-load card array.
     if (this.loadPromise) return this.loadPromise;
     const p = this._runLoad().finally(() => {
       if (this.loadPromise === p) this.loadPromise = null;
     });
     this.loadPromise = p;
     return p;
   }
   ```
3. Keep `_runLoad()` byte-identical to today's body **except** remove the
   `if (this.loading()) return;` guard (the promise field now serialises). Keep
   the `loading` signal and its `finally` reset — the UI binds to it.
4. Add a spec proving the fix: two overlapping `load()` calls produce **one**
   `getCollection()` call and **both** returned promises resolve only after the
   cards signal is populated. Verify it is falsifiable — it must fail if (2) is
   reverted to the early return.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w web` — 268 + the new cases, 0 failures.
- `grep -c "if (this.loading()) return" web/src/app/core/collection.store.ts`
  returns `0`.
- The new spec was observed failing against the early-return version.

**If blocked**
If removing the guard breaks existing specs that depend on `load()` returning
synchronously, STOP and report which ones — do not change their expectations to
match.

---

### Step 6 — `rate()` sends `expectedRev`, and the client owns its local `rev`

**Model:** haiku

**Status:** not started

**Depends on:** Step 3 — the server now reads `expectedRev`; Step 1 — `Card.rev`.

**Files**
- MODIFY `web/src/app/features/review/review.ts` — anchor: the `outbox.enqueue` call in `rate()` (~line 308)
- MODIFY `web/src/app/features/review/review.spec.ts`
- DO NOT TOUCH: `web/src/app/core/scheduling/sm2.ts`, `fsrs.ts`. The schedulers
  must **not** learn about `rev` (D9: it is assigned where the revlog entry is
  minted, not inside the scheduler).

**Context**
D9's client half. The scheduler returns `{ ...card, … }`, which silently carries
the **old** token, so the card handed to `applyCard()` must have `rev` set
explicitly to the new `revlog.id`. Without it the next review in the same
session sends a stale `expectedRev` and false-conflicts — the A4 trap, which is
every 10-minute learning step. The precondition value must be read from
`current.card` **before** the scheduler runs.

**Do**
1. In `rate()`, capture the base token before scheduling:
   `const expectedRev = current.card.rev ?? null;`
2. After `answer(...)` returns, build the card the client will cache and send:
   `const nextWithRev: Card = { ...next, rev: revlog.id };`
3. Pass `nextWithRev` to `this.store.applyCard(...)` and use it in the enqueued
   body, which becomes:
   `body: { card: nextWithRev, revlog, expectedRev }`
4. Leave `recordStudied`, `burySiblings` and the `await this.loadNext()` call
   exactly as they are — those three ops stay unguarded (`Analyst.md` §3).
5. Add specs: a first review of a card with no `rev` enqueues
   `expectedRev: null` and a body whose `card.rev === revlog.id`; a **second**
   review of the same card in the same session enqueues `expectedRev` equal to
   the **first** review's `revlog.id` (the A4 chain, with no server round-trip).

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w web` — 268 + Step 5's + the new cases, 0 failures.
- `grep -c "expectedRev" web/src/app/features/review/review.ts` returns `2`
  (the `const` and the body property — `grep -c` counts lines, not tokens).
- The A4 chain spec passes.

**If blocked**
If `current.card` is not the object the scheduler was called with (e.g. the
queue hands back a copy), STOP and report — the precondition value would be
read from the wrong object.

---

### Step 7 — Teach the outbox to *detect* a conflict, with the resolver seam

**Model:** haiku

**Status:** not started

**Depends on:** Step 6 — ops now carry `expectedRev`, so a 409 is reachable.

**Files**
- MODIFY `web/src/app/core/outbox/outbox-ops.ts` — anchor: `classify` (~line 18)
- MODIFY `web/src/app/core/outbox/outbox-types.ts`
- MODIFY `web/src/app/core/outbox/outbox.service.ts` — anchor: `_runDrain` (~line 95)
- MODIFY `web/src/app/core/outbox/outbox-ops.spec.ts`
- MODIFY `web/src/app/core/outbox/outbox.service.spec.ts`
- DO NOT TOUCH: `web/src/app/core/collection.store.ts`. `OutboxService` must
  stay ignorant of the store (D8) — importing it here is the cyclic dependency
  this step exists to avoid.

**Context**
D8: the outbox **detects**, a separate service (Step 8) **resolves**. 409 is
currently `'retry'` (`classify` poisons only 400/404/422), which would retry a
stale body forever at the 60s cap and burn the tier-1 limiter's budget.

**The one trap that can lose real user data:** `parseState` returns
`EMPTY_STATE` unless `obj['version'] === 1`. Bumping the version to 2 would
**silently discard every queued review** in every existing client's
`localStorage`. Keep `version: 1` and treat a missing `conflicts` array as `[]`.

**Do**
1. In `outbox-types.ts`, add `conflicts: OutboxOp[]` to `OutboxState` (keeping
   `version: 1`) and an optional `conflictReason?: string` on `OutboxOp`. Add
   the handler contract:
   ```ts
   /** D8 seam: the outbox detects a 409 and delegates. `replaced` substitutes
    *  the op IN PLACE at the queue head, preserving FIFO (AD-029). */
   export type ConflictOutcome =
     | { outcome: 'replaced'; replacement: Omit<OutboxOp, 'attempts' | 'failedReason' | 'createdAt'> }
     | { outcome: 'unresolved'; reason: string };
   export type ConflictHandler = (op: OutboxOp, body: unknown) => Promise<ConflictOutcome>;
   ```
2. In `outbox-ops.ts`: `classify` returns `'conflict'` for `409` (add it to the
   union). Then fix `parseState` **carefully** — it ends with
   `JSON.parse(JSON.stringify(obj))`, i.e. it deep-copies the *stored* object
   rather than building a known shape, so a pre-024 state has no `conflicts` key
   at all and the copy will not invent one. Immediately before the final deep
   copy, write the defaulted key:
   ```ts
   // Widen the v1 shape backward-compatibly: a state written before spec 024
   // has no `conflicts`. Do NOT bump `version` — parseState returns
   // EMPTY_STATE for any version !== 1, which would silently DISCARD every
   // queued review in every existing client's localStorage.
   obj['conflicts'] = Array.isArray(obj['conflicts']) ? obj['conflicts'] : [];
   ```
   Add a spec that a stored v1 state with **no** `conflicts` key still restores
   its `ops` and yields `conflicts: []`.
3. In `OutboxService`: add `readonly conflicts = signal<OutboxOp[]>([])` and
   `readonly conflictCount = signal(0)`; include `conflicts` in `persist()`; and
   restore it in the constructor as `this.conflicts.set(state.conflicts ?? [])`
   — the `?? []` is a deliberate belt-and-braces guard alongside (2), because
   setting this signal to `undefined` would throw on the first `.length` read,
   in the constructor, at app boot, for precisely the users who have queued
   reviews. Add `setConflictHandler(h: ConflictHandler): void`.
4. In `_runDrain`'s catch, add a `classification === 'conflict'` branch, before
   the retry branch:
   - increment `conflictCount`;
   - if no handler is registered → move the op to `conflicts` with
     `conflictReason: 'no resolver'` and `continue`;
   - else `await` the handler with `(op, errObj['error'])`;
   - on `'replaced'` → replace `ops[0]` in place with the replacement
     (`attempts: 0`, `failedReason: null`, `createdAt: Date.now()`), persist,
     and `continue` the loop;
   - on `'unresolved'` → move the op to `conflicts` with the reason, persist,
     and `continue` so the queue behind it drains.
   - A 409 must **not** increment `attempts` and must **not** schedule backoff
     (A7).
5. Specs, using **real** `HttpErrorResponse` + `HttpHeaders` objects per the
   standing rule: a 409 with a registered handler returning `'replaced'`
   substitutes at the head and the queue keeps draining; `'unresolved'` moves it
   to `conflicts` and later ops still drain; a 409 never calls
   `setTimeout`-driven backoff; `conflictCount` increments.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w web` — all green, 0 failures.
- `grep -c "CollectionStore" web/src/app/core/outbox/outbox.service.ts` returns
  `0` (D8 holds).
- `grep -c "version: 1" web/src/app/core/outbox/outbox-ops.ts` returns `1` — the
  value it has today, i.e. no version bump.
- The "pre-024 state with no `conflicts` key" spec passes.

**If blocked**
If `classify`'s return type is consumed anywhere that cannot handle a fourth
value, STOP and report the call site rather than widening it blind.

---

### Step 8 — `ConflictResolver`: reload once, re-apply the rating at the original instant

**Model:** haiku

**Status:** not started

**Depends on:** Step 7 — consumes `ConflictHandler` / `ConflictOutcome` and
`setConflictHandler`; Step 5 — relies on `load()` actually awaiting.

**Files**
- CREATE `web/src/app/core/outbox/conflict-resolver.ts`
- CREATE `web/src/app/core/outbox/conflict-resolver.spec.ts`
- MODIFY `web/src/app/app.ts` — anchor: the constructor (~line 51), to
  instantiate the resolver so it registers
- DO NOT TOUCH: `web/src/app/core/outbox/outbox.service.ts` (Step 7 finished it),
  `web/src/app/core/scheduling/*`.

**Context**
D6 + D10. The resolver owns resolution and may inject `CollectionStore`; the
outbox may not (D8). Resolution is per **snapshot**, not per op: one reload per
stale snapshot, bounded at **2 reload cycles per drain pass**, because a 409 is
not 2xx and each one spends part of the tier-1 limiter's 20-failures-per-15-min
budget. D10 fixes the re-schedule instant at `revlog.reviewedAt`, **not**
`Date.now()`, so the result is what would have happened had the op arrived in
order. The reverse rating mapping is `RATINGS[button - 1]` — verified safe for
both schedulers, since `fsrs.ts`'s `GRADE` is literally `RATING_BUTTON`
(`fsrs.ts:21`).

**Do**
1. Create the service, `@Injectable({ providedIn: 'root' })`, injecting
   `CollectionStore` and `OutboxService`, registering itself in its constructor
   via — note **both** parameters are declared, or this does not compile:
   ```ts
   this.outbox.setConflictHandler((op, body) => this.resolve(op, body));
   ```
2. `resolve(op, body)` returns `Promise<ConflictOutcome>`:
   - If `op.path !== '/review'` → `unresolved`, reason `'conflict on non-review path'`.
   - If the reload budget for this pass is spent → `unresolved`, reason
     `'reload budget exhausted'`. Track `reloadsThisPass`, incremented per
     reload and **reset to 0 whenever `outbox.pendingCount()` reaches 0**.
   - `await this.store.load()` (one reload; Step 5 makes this await real) and
     increment the counter.
   - Read the server card from the 409 body (`{ card }`); if absent →
     `unresolved`, reason `'409 without card'`.
   - Recover the rating: `const rating = RATINGS[op.body.revlog.button - 1]`.
   - Resolve the options in **two** lookups — `optionsFor` takes a `Deck`, not a
     deck id (`collection.store.ts:215-219`):
     ```ts
     const deck = this.store.deckById(serverCard.deckId);
     if (!deck) return { outcome: 'unresolved', reason: 'unknown deck' };
     const opts = this.store.optionsFor(deck) ?? this.store.defaultDeckOptions();
     if (!opts) return { outcome: 'unresolved', reason: 'no deck options' };
     ```
   - Re-run the scheduler:
     ```ts
     const ctx = { now: revlog.reviewedAt, today: todayNumber(coll, revlog.reviewedAt) };
     const { card, revlog: fresh } = schedulerFor(opts).answer(
       serverCard, rating, opts, ctx, revlog.timeMs,
     );
     const applied: Card = { ...card, rev: fresh.id };
     ```
   - `store.applyCard(applied)`, then return
     `{ outcome: 'replaced', replacement: { id: fresh.id, method: 'POST', path: '/review', body: { card: applied, revlog: fresh, expectedRev: serverCard.rev ?? null } } }`.
3. Instantiate the resolver in `App`'s constructor (`inject(ConflictResolver)`)
   so registration happens at startup. Do not add it to the `Review` component —
   resolution must work whatever route is open.
4. Specs: a 409 for a `/review` op reloads **once** and returns `'replaced'`
   with `expectedRev` equal to the server card's `rev`; the replacement's
   scheduling is computed at `revlog.reviewedAt`, not `Date.now()` (assert a
   `due`/`interval` that differs from the `Date.now()` result); a third
   consecutive conflict in one pass returns `'unresolved'` with the budget
   reason; a non-`/review` path returns `'unresolved'`.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w web` — all green, 0 failures.
- `grep -c "reviewedAt" web/src/app/core/outbox/conflict-resolver.ts` ≥ 2.
- The D10 spec fails if `ctx.now` is changed to `Date.now()` — verified
  falsifiable, and said so in `Status:`.

**If blocked**
If `store.optionsFor` / `defaultDeckOptions` are not public on
`CollectionStore`, STOP and report rather than widening their visibility as a
side effect.

---

### Step 9 — Checkpoint: the whole mechanism, no UI yet

**Model:** haiku

**Status:** not started

**Depends on:** Steps 1–8.

**Files**
- None. Re-verification only.

**Do**
1. Re-run Steps 5–8's `Done when` commands; record actual counts.
2. Confirm D8 still holds end to end. **The `grep` is the authoritative check**,
   not the boot: `grep -rn "collection.store" web/src/app/core/outbox/outbox.service.ts`
   must return nothing. A cycle introduced through a *type-only* import would
   not fail at runtime at all, so a clean boot alone does not prove D8. The boot
   check is still worth doing — `ConflictResolver` is only injected once `App`
   instantiates it (Step 8), so a genuine runtime cycle does surface there.
3. Start the dev server (`npm run dev`), load the app, and confirm the console
   is free of DI cycle warnings. Stop it afterwards, then
   `git checkout -- data/spanish/` — the running server dirties live state
   (L-002).

**Done when**
- `npm run test` — server and web both green, 0 failures; counts recorded.
- `npm run build`, `npm run lint:ci`, `npm run format:check` — exit 0.
- App loads with no console error; `git status` clean afterwards.

**If blocked**
If the app fails to boot with a cyclic dependency, Step 7's `DO NOT TOUCH` was
violated — report which import introduced it.

---

### Step 10 — Surface conflicts in the shell, distinct from "unsaved"

**Model:** haiku

**Status:** not started

**Depends on:** Step 7 — reads `outbox.conflicts()` and `outbox.conflictCount()`.

**Files**
- MODIFY `web/src/app/app.ts` — anchor: `outboxBannerText` (~line 32)
- MODIFY `web/src/app/app.html` — anchor: the `outbox-banner` block (~line 5)
- MODIFY `web/src/app/app.spec.ts`
- DO NOT TOUCH: the existing `'draining'` / `'waiting'` / `failed` wording.
  023's Discovered records that this banner calls every op a "review" and so
  overstates unsaved work ~3x. **That is a separate recorded issue and fixing
  it here is drift** — this step only adds the conflict state.

**Context**
D7: a conflict is a different claim from "not yet saved" — the review was
rejected and then either re-applied or parked — so it gets its own words. The
existing `outboxBannerText` computed signal is the pattern; conflicts take
priority over the pending-count text because they need action.

**Do**
1. In `outboxBannerText`, add a branch **before** the existing ones: if
   `outbox.conflicts().length > 0`, return
   `` `${n} ${n === 1 ? 'review' : 'reviews'} could not be merged — answered on another device` ``.
2. Leave the `Retry` button bound to `outbox.retryFailed()` as-is, and add
   nothing for conflicts in this step beyond the text (a conflict is not
   retryable by replaying the same body).
3. **Fix the unload guard, or this step ships a regression** (critic R-6).
   `onBeforeUnload` currently fires whenever the banner has text
   (`app.ts:128-133`), and a parked conflict is **never auto-deleted** — so
   adding a conflict branch to `outboxBannerText` would prompt "leave site?" on
   every tab close, forever, with no way for the user to clear it. Change the
   guard to key on genuinely unsent work instead of on the banner:
   ```ts
   onBeforeUnload(event: BeforeUnloadEvent): void {
     // Unsent work only. A parked conflict is surfaced in the banner but must
     // NOT block closing the tab — it is never auto-cleared (critic R-6).
     if (this.outbox.pendingCount() > 0 || this.outbox.failed().length > 0) {
       event.preventDefault();
     }
   }
   ```
   Leave the `failed` half of that condition exactly as it behaves today — a
   poisoned op blocking close is 023's existing choice and is not in scope here.
4. Add specs: the conflict text wins over a non-zero pending count; and
   `onBeforeUnload` does **not** preventDefault when the only outbox state is a
   parked conflict.

**Done when**
- `npm run build` — exit 0 both workspaces.
- `npm run test -w web` — all green, 0 failures.
- `git diff web/src/app/app.ts` shows **no** change to the existing
  draining/waiting/failed strings.

**If blocked**
If `app.spec.ts` has no existing banner test to extend, add one rather than
changing unrelated expectations.

---

### Step 11 — Verify locally: stale write rejected, re-applied, nothing lost

**Model:** top-level

**Status:** not started

**Depends on:** Steps 1–10.

**Files**
- None (verification). Any fix found here gets its own step.

**Context**
`Model: top-level` **and driven by the user**, deliberately. 023's retrospective
records that browser automation could not drive its equivalent step — it was
blocked by `beforeunload` and by stale `localStorage` — and that its
`Model: haiku` was "optimistic about what a subagent can drive". Two browser
profiles are needed, which automation here cannot reliably hold.

**Do**
1. `npm run build && npm run dev`, then open the app in **two** separate browser
   profiles (or a normal and a private window) so each has its own
   `localStorage`.
2. In window A, load a deck and leave the study screen open **without**
   answering — this is the stale snapshot.
3. In window B, answer card X. Confirm it persisted.
4. In window A, answer the same card X. Expected: the POST 409s, the resolver
   reloads once, re-applies A's rating on top of B's state, and the review lands.
5. Verify against the store, not the UI: `data/spanish/revlog.ndjson` gained
   exactly **two** lines with distinct ids, and `cards.json`'s card X shows a
   `rev` equal to the **second** (re-applied) revlog id — i.e. B's review was
   not erased.
6. Count the 409s in the server log; confirm **one** per conflicting review, not
   three (A7).
7. Stop the dev server and `git checkout -- data/spanish/` (L-002).

**Done when**
- The revlog gained exactly 2 distinct lines for card X and neither review was
  lost; the actual ids and `cards.json` values are quoted in `Status:`.
- Exactly one 409 per conflicting review was observed.
- `git status` is clean afterwards.

**If blocked**
**If the user is not available, mark this step `in progress`, report that the
run is paused pending manual verification, and STOP.** Do not attempt browser
automation and do not proceed to Step 12 — 023's retrospective records that
automation could not drive the equivalent step (blocked by `beforeunload` and by
stale `localStorage` from a previous aborted run) and burned two runs proving
it. Steps 11 and 12 are the only two steps in this plan an agent cannot
complete alone.

If the conflict is not detected at all, check that Step 6 is sending
`expectedRev` before suspecting the server. If the resolver loops, Step 8's
budget reset is wrong. Report rather than patching inline — a fix is a new step.

---

### Step 12 — Verify on the phone against production (A1)

**Model:** top-level

**Status:** not started

**Depends on:** Step 11 — do not deploy a mechanism that has not worked locally.

**Files**
- None (verification + deploy).

**Context**
A1 is the acceptance that matters, and `Analyst.md` requires ground truth to be
the **pulled live state**, never a UI (L-025: "exercised in step N" was once a
claim in a spec document that `git log` contradicted). Deploy is `fly deploy`;
state comes back with `tools/pull-fly-state.sh`.

**Do**
1. Ask the user to deploy (`fly deploy`) and confirm the version.
2. Record the live baseline first: run `tools/pull-fly-state.sh` and note
   `wc -l data/spanish/revlog.ndjson`.
3. Phone loads a deck and sits on the study screen without answering.
4. Desktop answers card X against production.
5. Phone answers card X. The conflict banner may appear briefly; the review must
   still land.
6. Pull the live state again and verify: the revlog grew by exactly **2** for
   card X with distinct ids, no id appears twice, and card X's final state
   reflects the re-applied (phone) review on top of the desktop's.
7. If the tier-1 rate limiter locks the phone out, that is the pre-existing
   issue from 023's Discovered — clear it with `fly apps restart spanish-srs`
   and note it; it is **not** a Phase 4 defect.

**Done when**
- Live `revlog.ndjson` line counts before/after are quoted in `Status:`, with
  the two ids.
- Neither device's review was lost, verified in the pulled files.
- `git checkout -- data/spanish/` afterwards unless the pull is being kept.

**If blocked**
**If the user is not available, mark this step `in progress`, report that the
run is paused pending a manual phone run, and STOP.** This step requires a
physical device and a deploy; it cannot be delegated or automated.

If production behaves differently from Step 11's local run, STOP and report with
both observations side by side. Do not iterate against production.

---

### Step 13 — Regression, docs, and wrap-up

**Model:** top-level

**Status:** not started

**Depends on:** Steps 1–12.

**Files**
- MODIFY `specs/024-cross-device-safety/Analyst.md` — §5 verdicts, `## Discovered`
- MODIFY `specs/011-mobile-remote-access/ROADMAP.md` — tick Phase 4's boxes
- MODIFY `specs/STATE.md` — confirm AD-030, add any new `AD`/`L` headline
- MODIFY `specs/LESSONS.md` — the body of any new `L-NNN`
- MODIFY `.claude/skills/scheduling-domain/SKILL.md` — D10's lesson (below)
- MODIFY root `STATE.md` — remove the `## Executing:` marker

**Do**
1. Walk **A1–A8** in `Analyst.md` §5 and write a verdict plus evidence for each.
   A verdict with no evidence is not a verdict.
2. Append D10's rule to `scheduling-domain`'s `## Lessons (auto-appended)`,
   dated: re-applying a rejected review re-schedules at the **original**
   `revlog.reviewedAt`, not at re-apply time, and a resulting learning `due` in
   the past is correct. That is a domain gotcha next to the rules it qualifies
   (AD-009), not an `L-NNN`.
3. Record as `L-NNN` pairs (headline in `specs/STATE.md`, body in
   `specs/LESSONS.md`) anything **process**-shaped the run found. Candidate
   already known: an `OutboxState` version bump would silently discard every
   queued review, so a persisted-state schema must be widened
   backward-compatibly, never versioned up (Step 7's trap).
4. Tick Phase 4's three checkboxes in the ROADMAP, noting that presence
   signalling was declined with the conflict counter as the instrument that
   would justify revisiting it.
5. Run the full gate set: `npm run test`, `npm run build`, `npm run lint:ci`,
   `npm run format:check`, `bash scripts/clean-table-check.sh`,
   `python3 tools/state_rotate.py --check`.
6. `git status` and `git checkout -- data/spanish/` if dirty (L-002).
7. **Do not commit, and do not archive — ask the user first.** The archive
   ritual (steps 3–4) is its own pass, and `specs/STATE.md` is at 298/300 lines,
   so a new entry likely needs `state_rotate.py --apply` — a human's call.

**Done when**
- Every one of A1–A8 has a verdict **and** its evidence in `Analyst.md` §5.
- All six commands in (5) pass; outputs recorded.
- The `## Executing:` marker is gone from the root `STATE.md`.
- The lessons gate passes (every `L-NNN` headline has a body and vice versa).

**If blocked**
If any acceptance criterion cannot be met, write it down as **not met** with the
reason. Do not quietly restate it as met — 023's A1 was amended to text-only
cards in exactly this situation, and the amendment is why it is trustworthy.
