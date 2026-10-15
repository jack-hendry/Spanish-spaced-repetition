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

**Status:** done 2026-10-11 — `rev?: string` added after `modified` in both mirrors
(`server/src/models/index.ts:97`, `web/src/app/core/models/index.ts:74`), grep
returns 1 each. `npm run build` exit 0 both workspaces. `npm run test`: server
**88 / 14 files**, web **268 / 23 files** — unchanged from baseline, as expected
for a type-only step. No drift between the two `Card` interfaces.

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

**Status:** done 2026-10-11 — `hasRevlogId()` added beside `appendRevlog`
(`file-store.ts:221`); D5 replay branch in `r.post('/review')`
(`routes/index.ts:120-126`), placed after the 404 guard and before any write,
verified by reading the diff. New `review-staleness.integration.test.ts` 2/2
(identical-replay byte-identity + the differing-body clobber case). The
amendment above was applied under the user's decision: 023's differing-body case
rewritten, diff confined to that one `it(...)` block (3 hunks: name, comment,
`toBe(5)`); 023's other two cases byte-identical. `npm run test -w server`
**90 passed / 15 files, 0 failures** (88 baseline + 2 new). `npm run build`,
`npm run lint:ci`, `npm run format:check` all exit 0.

**Depends on:** Step 1 — needs `Card.rev` to exist so the route compiles once
Step 3 assigns it. (This step does not read `rev` yet.)

**Files**
- MODIFY `server/src/store/file-store.ts` — anchor: `appendRevlog` (~line 221)
- MODIFY `server/src/routes/index.ts` — anchor: `r.post('/review'` (~line 115)
- CREATE `server/src/routes/review-staleness.integration.test.ts`
- MODIFY `server/src/routes/review-idempotency.integration.test.ts` — **one case
  only**, per the amendment below.

> **Amendment, 2026-10-11 (user decision).** This step originally said
> `DO NOT TOUCH: review-idempotency.integration.test.ts` — "023's 3 cases must
> keep passing unchanged; that is A3". That bullet was **unsatisfiable**. 023's
> case `card write still applies on the replay` POSTs the *same* `revlog.id`
> with a *different* card body (`interval: 5` then `interval: 9`) and asserts
> the second wins; its own comment reads "demonstrates last-write-wins for
> card". D5 exists precisely to remove that behaviour
> (`Analyst.md:196-199` calls re-applying a differing body "the exact bug this
> spec exists to prevent").
>
> **A3 is not in conflict** and is not being weakened: `Analyst.md:306` defines
> A3 over an *identical* body twice → 200, one revlog line, card byte-identical.
> D5 delivers exactly that, and `review-staleness.integration.test.ts` pins it.
> Only the differing-body case encodes the pre-024 contract.
>
> Resolution: rewrite **that one case** to assert the D5 behaviour and rename it.
> 023's other two cases stay untouched. The behaviour change is deliberate and is
> recorded here, in `Analyst.md`'s `## Discovered`, and in this step's `Status:`.

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
- `npm test -w server -- review-idempotency.integration.test.ts` — all 3 cases
  pass, with the differing-body case rewritten per the amendment above. The two
  cases that do **not** concern a differing body are unchanged — verify with
  `git diff -- server/src/routes/review-idempotency.integration.test.ts` and
  confirm the diff touches only the one `it(...)` block.
- `npm run test -w server` — 88 + the new cases, 0 failures.

**If blocked**
If `revlogIds` is no longer a `Set<string>` on `FileStore`, STOP and report —
Step 2's design depends on 023's dedupe set being intact (see `Analyst.md`
Discovered / C-6).

---

### Step 3 — Add the `expectedRev` precondition and assign `rev` server-side

**Model:** haiku

**Status:** done 2026-10-11 — body type widened to
`{ card: Card; revlog?: RevlogEntry; expectedRev?: string | null }`; D4/D3
equality-only precondition inserted **after** the Step 2 replay branch (ordering
verified by reading the diff: 404 guard → replay → precondition → write); write
is now `{ ...card, modified: Date.now(), rev: revlog?.id ?? cards[idx].rev }`, so
the server owns the token and the client's `card.rev` is discarded (D9).
`review-staleness.integration.test.ts` extended with all five prescribed cases.

**A2 falsifiability:** with the precondition block commented out, the
stale-rejection case failed with **`expected 200 to be 409 // Object.is
equality`** (received 200 at the `expect(res2.status).toBe(409)` assertion);
uncommenting restored green. Verified by commenting out, not `git stash`.

`npm run test -w server` **95 passed / 15 files, 0 failures** (88 baseline + 7
new across Steps 2–3). `npm run build` exit 0 both workspaces;
`grep -c "409" server/src/routes/index.ts` returns 1; `lint:ci` and
`format:check` exit 0. The four out-of-scope routes are untouched — the
`routes/index.ts` diff is confined to the `/review` handler.

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

**Status:** done 2026-10-11 — **PASS on all four points.** Re-verified, actual
numbers: `npm run test` → server **95 / 15 files**, web **268 / 23 files**, 0
failures. `npm run build`, `npm run lint:ci`, `npm run format:check` all exit 0.
`grep -c "rev?: string"` → 1 in each mirror; `grep -c "409"` → 1 in
`routes/index.ts`.

Changed-file list matches the permitted set exactly, no drift: the five Steps 1–3
source files (incl. the new `review-staleness.integration.test.ts` and the
one-block amendment to `review-idempotency.integration.test.ts`), plus
`specs/024-cross-device-safety/{tasks,Analyst}.md` and the root `STATE.md` run
marker. No client code changed beyond Step 1's type-only field — nothing under
`web/src/app/features/`, `web/src/app/core/outbox/`, or `collection.store.ts`.
`data/spanish/` clean.

One committed-but-pre-existing item checked and cleared: `origin/main..HEAD`
shows a 1-line change to `web/src/app/features/review/review.ts`, which is a
comment reflow from the 023 archive commit (`specs/023-review-outbox` →
`specs/archive/2026-10-11-023-review-outbox`). It sits immediately above the
`outbox.enqueue` call Step 6 edits but changes no code. Not drift.

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

**Status:** done 2026-10-11 — `private loadPromise` added; `load()` returns the
in-flight promise; old body moved to `private async _runLoad()` with the
`if (this.loading()) return;` guard removed and the `loading` signal + its
`finally` reset preserved for the UI. `grep -c "if (this.loading()) return"` → 0.
**No lint rule objected** to the `async` → returns-a-promise change, so standing
rule 3 never fired. No caller needed changing, as intended.

`npm run test -w web` **269 passed / 23 files**, 0 failures (268 + 1);
server unchanged at 95. `npm run build`, `lint:ci`, `format:check` exit 0.

**Falsifiability — recorded precisely.** The spec first shipped leading with
`expect(p1).toBe(p2)` (promise identity), which short-circuited the reverted run
and yielded only `expected Promise{…} to be Promise{…}` — evidence about
plumbing, not about whether a caller's `await` waits. Promise identity is also
not L-028's contract: `return this.loadPromise.then()` would honour it and fail
that line. The block was reordered so the behavioural assertions run first, with
the identity check kept last and commented as an implementation pin. Re-verified
failure, now behavioural:

> `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`
> at `collection.store.spec.ts:298` (the `getCollection` call-count assertion)

**Residual gap, deliberately not chased further:** that revert was
`load() { return this._runLoad(); }` (drops promise-caching, keeps the await
real), which proves the *dedupe* assertion is live but not the
*resolves-after-cards-populated* one. A true early-return revert would fail both
(instant resolve → `cards().length` 0). The test does assert both, so a
reintroduced early return is caught either way; only the direct evidence is
one-sided.

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

**Status:** done 2026-10-11 — `const expectedRev = current.card.rev ?? null;`
captured **before** `answer()` (ordering verified by reading the diff, since
reading it after would defeat D9); `const nextWithRev: Card = { ...next, rev:
revlog.id };` passed to both `applyCard()` and the enqueued
`body: { card: nextWithRev, revlog, expectedRev }`. `recordStudied`,
`burySiblings` and `await this.loadNext()` untouched. Schedulers untouched —
`git status --porcelain web/src/app/core/scheduling/` is empty.

`npm run test -w web` **271 passed / 23 files**, 0 failures (269 + 2); server
unchanged at 95. `npm run build`, `lint:ci`, `format:check` exit 0.
`grep -c "expectedRev" review.ts` → 2.

**A4 chain spec quality — checked by reading it, not from the report.** It is a
genuine chain, not a restated mock: two real `.rate` button clicks drive the
component, `storeFake.applyCard` updates the tracked card and `queueFake.next`
serves that updated card back (mirroring how the real store/queue behave), so
the second review reads its `expectedRev` from state the first review wrote. It
asserts the **concrete** `firstRevlogId` (`expect(secondBody.expectedRev).toBe(
firstRevlogId)`), plus `component.state()!.card.rev === firstRevlogId` and that
the two revlog ids differ. A truthiness-only assertion would have passed while
the common path — every 10-minute learning step — false-conflicted.

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

**Status:** done 2026-10-11 — `conflicts: OutboxOp[]` on `OutboxState`,
`conflictReason?: string` on `OutboxOp`, `ConflictOutcome` / `ConflictHandler`
added; `classify` returns `'conflict'` for 409; `EMPTY_STATE` carries
`conflicts: []`; `OutboxService` gains `conflicts` / `conflictCount` signals,
`setConflictHandler`, `conflicts` in `persist()`, constructor restore via
`?? []`, and the `'conflict'` branch in `_runDrain` **before** the retry branch.

**The data-loss trap was not tripped.** `grep -c "version: 1" outbox-ops.ts` → 1,
no `version: 2` anywhere. `parseState` writes the defaulted `conflicts` key
immediately before its final `JSON.parse(JSON.stringify(obj))`, so a pre-024
stored state restores its `ops` intact. Guard spec at `outbox-ops.spec.ts:227`.
**D8 holds:** `grep -c "CollectionStore" outbox.service.ts` → 0.

`npm run test -w web` **280 passed / 23 files**, 0 failures (271 + 9); server
unchanged at 95. `npm run build`, `lint:ci`, `format:check` exit 0.

Specs T17–T21 in `outbox.service.spec.ts` use **real** framework objects per
L-029 — 6 × `new HttpErrorResponse({ status: 409, headers: new HttpHeaders(),
… })`. T18 is substantive rather than handler-call-counting: it asserts the
replacement is actually re-sent (`send.mock.calls[1]` carries the new
`expectedRev`) and that the op behind it still drains.

**A7 is proven by proxy, not directly — recorded honestly.** T20 asserts
`conflicts()[0].attempts === 0` and `status() === 'idle'`. It runs on real
timers, so it cannot assert "no timer was scheduled" directly. The two
assertions together do fail the realistic regression (a 409 falling through to
the retry branch, which sets `attempts: 1` **and** `status: 'waiting'` together),
but a contrived change that scheduled a timer without touching status or attempts
would slip past.

**Open, for Step 9 to confirm:** nothing here bounds a replacement op that
*itself* 409s — the `'replaced'` path re-attempts at the head, so the bound comes
entirely from Step 8's reload budget (2 cycles per drain pass, `'unresolved'`
thereafter). Verify at the checkpoint rather than assuming.

**Run note:** the first Step 7 agent was stopped mid-run, having completed the
types/ops/service work but never opening `outbox.service.spec.ts`, which left
`ng test` non-compiling (required `conflicts` missing from pre-existing
`OutboxState` literals) while `npm run build` stayed green — standing rule 1 in
reverse. A fresh agent finished from the partial work on disk.

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

**Status:** done 2026-10-11 — `ConflictResolver` created, `@Injectable({
providedIn: 'root' })`, registering itself in its constructor; `resolve()`
implements every prescribed branch (non-`/review`, budget exhausted, `409`
without card, unknown deck, no deck options, no collection) and the two-lookup
`deckById` → `optionsFor` → `defaultDeckOptions()` chain. Instantiated via
`inject(ConflictResolver)` in `App`, not in `Review`, so resolution works on any
route. Schedulers untouched.

**D10 holds and is falsifiable.** `ctx = { now: reviewedAt, today:
todayNumber(coll, reviewedAt) }`; `grep -c "reviewedAt"` → 5. Temporarily
changing `now:` to `Date.now()` fails the D10 spec with:

> `AssertionError: expected 1791742213771 to be 1791741913771`

— a 300,000 ms gap, exactly the spec's 5-minute `reviewedAt` offset. Verified by
editing directly, not `git stash`.

**Why that spec actually works** (checked, because it looks like it shouldn't):
it patches a scheduler obtained from `schedulerFor(...)`, which returns
**module-level singletons** (`scheduler-factory.ts` holds one `Sm2Scheduler` and
one `FsrsScheduler`), so the patch does reach the instance the resolver builds
internally. `vi.restoreAllMocks()` was added at `conflict-resolver.spec.ts:155`
because it was not restoring, which leaked the patch into the four later tests.

**Step 7's open question is answered:** a replacement op that itself 409s cannot
loop — `conflict-resolver.spec.ts:273` proves the budget converts repeated
conflicts to `'unresolved'` and the drain terminates.

**Budget reset was reimplemented.** The first pass used a 100 ms `setInterval`
polling `pendingCount()` — never cleared, running for the app's whole lifetime,
and firing on a wall-clock tick rather than on the signal. Replaced with
`effect(() => { if (this.outbox.pendingCount() === 0) this.reloadsThisPass = 0; })`
and the dead `checkInterval` field deleted. `grep -c "setInterval"` → 0.

`npm run test -w web` **286 passed / 24 files**, exit 0; server **95 / 15**,
exit 0 across 10 consecutive runs; `build`, `lint:ci` (repo-wide `eslint .`),
`format:check` all exit 0.

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

**Status:** done 2026-10-11 — **PASS.** Server **95 passed / 15 files**, web
**286 passed / 24 files**, `npm run build`, `npm run lint:ci` (repo-wide
`eslint .`) and `npm run format:check` **all exit 0** — verified by exit code,
not by test count (see the run note below). `npm run test -w server` run five
times by the checkpoint and three more independently: **eight consecutive
exit 0**, so Step 8's race fix holds.

D8 confirmed by the authoritative greps, not the boot:
`grep -rn "collection.store" outbox.service.ts` → nothing;
`grep -c "CollectionStore" outbox.service.ts` → 0. (`conflict-resolver.ts` does
import `CollectionStore` — that is the seam working as designed, not a
violation.) `grep -c "version: 1" outbox-ops.ts` → 1;
`grep -c "setInterval" conflict-resolver.ts` → 0. The `ctx` line, verified
verbatim rather than assumed:

> `115:    const ctx = { now: reviewedAt, today: todayNumber(coll, reviewedAt) };`

`data/spanish/` clean after `git checkout --` (L-002). Changed-file list matches
Steps 1–8's footprint with no drift.

**Boot check — what was actually observed, corrected.** The checkpoint reported
"no DI cycle warnings" from `npm run dev` having curled `/api/health` and
fetched the app HTML. Neither executes the Angular bundle, so that evidence came
from **server** logs, where an Angular DI cycle cannot appear; the browser
console was never observed. The substantive evidence for no cycle is instead:
(1) the D8 greps, which this step designates authoritative precisely because a
type-only import would not fail at runtime at all, and (2) `app.spec.ts` calling
`TestBed.createComponent(App)` four times — `App` injects `ConflictResolver`, so
a real cycle would fail those specs, and all 286 web tests pass. Step 11's manual
run will exercise a real browser.

**Run note (candidate `L-NNN`):** between Steps 2 and 8 this run reported
"all gates clean" while `npm run test -w server` was exiting **1** and printing
"95 passed". Verification was done with `grep -E "Test Files|Tests "`, which
reads the count and discards the exit status. Step 4's checkpoint inherited the
same method and so confirmed a false green. Every gate from here on is checked
with `; echo "exit: $?"`.

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

**Status:** done 2026-10-11 — conflict branch added to `outboxBannerText`
**before** the existing ones, so it takes priority over the pending-count text;
returns `` `${n} ${n === 1 ? 'review' : 'reviews'} could not be merged —
answered on another device` ``. `Retry` left bound to `outbox.retryFailed()`,
nothing added for conflicts. No `app.html` change was needed — the template
already renders the computed signal's text.

**The R-6 regression was averted**, which is the substance of this step:
`onBeforeUnload` now keys on `this.outbox.pendingCount() > 0 ||
this.outbox.failed().length > 0` instead of `outboxBannerText() !== null`. Left
as-was, adding a conflict branch to the banner would have prompted "leave site?"
on every tab close **forever**, since a parked conflict is never auto-cleared
and the user has no way to clear it. The `failed` half is unchanged, preserving
023's choice that a poisoned op blocks close.

**Existing strings untouched** — verified by reading `git diff web/src/app/app.ts`:
the draining, waiting and failed wording is byte-identical. 023's recorded issue
that this banner calls every op a "review" (overstating unsaved work ~3×) was
deliberately **not** touched; that is a separate issue and fixing it here would
be drift.

Four new specs, all using **real** `new Event('beforeunload')` + `vi.spyOn(event,
'preventDefault')` per standing rule 2: conflict text wins over a non-zero
pending count; no `preventDefault` when only a parked conflict exists; and —
importantly — `preventDefault` **is** called when `pendingCount() > 0` and when
`failed().length > 0`. Without those positive cases a guard broken to never fire
at all would have passed the negative test.

`npm run test -w web` **290 passed / 24 files exit 0** (286 + 4); server **95 /
15 exit 0**; `build`, `lint:ci` (repo-wide), `format:check` all **exit 0** —
verified by exit code. `git diff --stat` confirms no stray files.

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

**Status:** done 2026-10-14 — **PASS.** The open question below is resolved:
the "1 review could not be saved" banner was a **stale 023 artefact**, not this
run — `failed` held one op, `PATCH /cards/does-not-exist`, `HTTP 404`,
`createdAt 2026-09-18T19:35:51.988Z` (023 Step 17's deliberate poison op; never
auto-deleted by design). The `409 (Conflict)` console error in window A is the
browser logging the expected 4xx.

**Caveat, recorded rather than glossed:** both windows printed the identical
`failed` op, so they were **one browser profile sharing one `localStorage`**, not
the two the step asked for. The result still holds — the conflict arose from each
tab's in-memory card (A held a stale `rev: null`) and the server-side evidence
below is unambiguous — but this run did **not** exercise two independent
outboxes. Step 12 (phone vs desktop) does, by construction.

`git checkout -- data/spanish/` done; `git status --porcelain data/spanish/`
empty.

Evidence (2026-10-14):
User ran the two-window test 2026-10-14; evidence read from the store, not the UI:

- Revlog **4036 → 4038**: exactly 2 lines, both `cardId:
  "ccc5d3a221d49156d-0"`, distinct ids `r1792020449563-skzqic` (B) and
  `r1792020456357-iyobsu` (A, re-applied).
- Card X `rev: r1792020456357-iyobsu` — the **second**, re-applied id. `reps`
  **28 → 30**: two increments, so neither review was lost (a clobber leaves 29).
- A applied **on top of** B, visible in the revlog itself: B `relearn` 1→1, A
  `review` 1→2. A clobber would make A's entry a copy of B's, since both windows
  started from the same state (HEAD: `relearning`, interval 1, `rev` null).
- **A7:** window A's network panel shows one `review 409` → `collection` →
  `cards` → `review 200`. One 409, one reload, no retry loop.
- D10, supporting only: card `lastReviewed` `…456357` = A's original answer
  instant; server `modified` `…456437`, 80 ms later, after the 409 + reload.

**Open:** both windows showed "1 review could not be saved" — the `failed`
(poison) banner, not the conflict one. Not explained by A's network panel, where
everything after the 409 succeeded. Suspected stale `localStorage` from earlier
dev work; awaiting the `failed` ops' `createdAt` from each window to confirm.
`data/spanish/` deliberately left dirty until resolved.

Earlier note, 2026-10-11 — paused pending the user's manual two-profile run. Steps 1–10 are complete and green (server **95 / 15**, web **290 / 24**,
`build` / `lint:ci` / `format:check` all exit 0, eight consecutive green server
runs). Browser automation deliberately **not** attempted, per this step's
`If blocked` note and 023's retrospective. Nothing is committed yet.

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

**Status:** done 2026-10-15 — **A1 PASS on production, 3 of 3.** User ran
phone-vs-desktop three times on release v6. Live revlog **4034 → 4040**: two
entries for each of three cards, **0 duplicate ids** across the whole log. Per
card (baseline → after, pulled with `tools/pull-fly-state.sh` into a scratch dir):
`c4025ccd683f86f1e-0` reps 6→8, `rev r1792069757052-ecfn0e`;
`ccc5d3a221d49156d-0` reps 28→30, `rev r1792069816158-3axacu`;
`c00f8119f941fc61c-0` reps 3→5, `rev r1792069830937-20e7j5` — in every case
`rev` equals the **second** entry's id and the second entry builds on the first
(`relearn 1→1` then `review 1→2`; `review 45→126` then `126→353`), so neither
device's review was lost. No banner appeared on the phone — expected on a
successful resolve, which completes in one 409 + reload + replacement round trip.
Limits: the data cannot identify *which* device answered second (only that the
second write was re-applied on top); the 409 count (A7) was evidenced in Step 11,
not here. Not rate-limited; no restart needed. `data/spanish/` untouched.

Deploy note, 2026-10-14 — deployed; awaited the user's phone run.
`fly deploy` from the **uncommitted** working tree, at the user's direction
(they chose not to commit first) → release **v6**, machine `850d53cd95d668`
healthy, DNS verified. Previous release v5 (2026-09-18). Ships the out-of-scope
`FileStore` + shutdown fix with 024, per the user's scope decision recorded in
`Analyst.md` `## Discovered`. Live baseline pulled to a scratch dir (not
`data/spanish/`, which stays clean): **revlog 4034 lines**.

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

**Status:** done 2026-10-15 — A1–A8 verdicts with evidence in `Analyst.md` §5:
A1–A6 and A8 **met**; **A7 partly not met** — no blind retry holds, but a stale
queue with 3+ conflicting cards in one drain pass parks the rest (found by
reading `conflict-resolver.ts` while writing the verdict; recorded in
`## Discovered`, AD-030's amendment and an open Quick Task, not fixed).
D10 lesson appended to `scheduling-domain`'s `## Lessons (auto-appended)`.
New `L-030`…`L-034` (headline in `specs/STATE.md`, body in `specs/LESSONS.md`;
34/34 pair) and `AD-031` (the `FileStore` fix shipping with 024, per the user).
`specs/STATE.md` hit 324/300, so `state_rotate.py --apply` ran (standing user
instruction, 2026-10-15): AD-031 and AD-027 moved to `STATE-ARCHIVE.md` with
stubs, now 273 lines. ROADMAP Phase 4's three boxes ticked; presence signalling
recorded as declined with `conflictCount` as the evidence for revisiting.
Gates, all **exit 0**: `npm run test -w server` (95), `npm run test -w web`
(290), `npm run build`, `npm run lint:ci`, `npm run format:check`,
`state_rotate.py --check`, `scripts/clean-table-check.sh` — the last ran over
committed history only, since nothing is committed, so lesson pairing was also
checked directly. `data/spanish/` clean. `## Executing:` marker removed from
root `STATE.md`. **Not committed, not archived** — both wait on the user.

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
