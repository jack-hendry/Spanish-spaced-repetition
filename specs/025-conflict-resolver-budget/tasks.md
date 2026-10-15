# 025 — tasks

**6 steps, in order. Do not skip ahead, do not batch steps.** Every step ends at
a green build. Read `.claude/skills/scheduling-domain/SKILL.md`,
`.claude/skills/angular-conventions/SKILL.md` and
`.claude/skills/testing-playbook/SKILL.md` before Step 1.

All paths are relative to the repo root `/Users/jhend/repos/Spanish-spaced-repetition`.
Temp files go in `T="${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp"; mkdir -p "$T"` — shell
state does not persist between Bash calls, so re-declare `T` in every command
that uses it. Never pipe a test command into `tail` when its exit code matters
(L-031): redirect to a file, `echo exit=$?`, then `tail` the file.

Decisions these steps implement (do not re-decide them): AD-032 in
`specs/STATE.md`, and `specs/025-conflict-resolver-budget/Analyst.md` D1–D3.

---

### Step 1 — Outbox plumbing: `reapplies` field, pass id into the handler

**Model:** haiku

**Status:** done (2026-10-15, web 290/290 exit 0 before and after; `grep -n "++this.drainPass"` → `outbox.service.ts:107`; lint + format exit 0)

**Files**
- MODIFY `web/src/app/core/outbox/outbox-types.ts` — anchors: `conflictReason?: string;`, `export type ConflictHandler`
- MODIFY `web/src/app/core/outbox/outbox.service.ts` — anchors: `private conflictHandler: ConflictHandler | null = null;`, `private async _runDrain(): Promise<void> {`, `await this.conflictHandler(op, errObj['error'])`
- MODIFY `web/src/app/core/outbox/outbox.service.spec.ts` — anchor: `'reload budget exhausted'` (2 hits, in T19)
- DO NOT TOUCH: `conflict-resolver.ts`, `conflict-resolver.spec.ts`, `outbox-ops.ts`, anything under `server/`

**Context**
The outbox will tell the resolver which drain pass a conflict belongs to, and
each queued op gets an optional counter the resolver uses in Step 2. Widening
`ConflictHandler` with a third parameter is backward compatible: the existing
two-parameter lambda in `conflict-resolver.ts` and the fakes in
`outbox.service.spec.ts` still type-check, so nothing else changes here.

**Do**
1. Record the baseline first:
   `T="${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp"; mkdir -p "$T"; npm run test -w web > "$T/base.txt" 2>&1; echo exit=$?; tail -15 "$T/base.txt"`
   — note the passing test count (expected 290) and `exit=0`.
2. In `outbox-types.ts`, directly after the `conflictReason?: string;` line
   inside `interface OutboxOp`, add:
   ```ts
     /** How many times ConflictResolver has re-applied this review's lineage.
      *  Carried onto each replacement op; absent = 0 (ops queued before spec
      *  025). Bounds a ping-pong per review, not per drain pass (AD-032). */
     reapplies?: number;
   ```
3. In `outbox-types.ts`, replace the `ConflictHandler` type with:
   ```ts
   /** `pass` identifies the `_runDrain()` invocation the conflict arose in, so
    *  the resolver can reload at most once per pass (spec 025 D1, AD-032). */
   export type ConflictHandler = (
     op: OutboxOp,
     body: unknown,
     pass: number,
   ) => Promise<ConflictOutcome>;
   ```
4. In `outbox.service.ts`, directly after
   `private conflictHandler: ConflictHandler | null = null;` add:
   ```ts
     /** Incremented once per `_runDrain()`; passed to the conflict handler. */
     private drainPass = 0;
   ```
5. In `outbox.service.ts`, make the first statement inside
   `private async _runDrain(): Promise<void> {` (before the `while`):
   ```ts
       const pass = ++this.drainPass;
   ```
6. In `outbox.service.ts`, change
   `await this.conflictHandler(op, errObj['error'])` to
   `await this.conflictHandler(op, errObj['error'], pass)`.
7. In `outbox.service.spec.ts`, replace both occurrences of the string
   `'reload budget exhausted'` with `'test: unresolved'` (T19's fake handler
   reason and its assertion — the string is opaque to the outbox).
8. `npm run format` then `npm run lint:ci`.

**Done when**
- `npm run test -w web` exits 0 with the same passing count as the baseline.
- `npm run lint:ci` exits 0; `npm run format:check` exits 0.
- `grep -c "reload budget exhausted" web/src/app/core/outbox/outbox.service.spec.ts` prints `0`.
- `grep -n "++this.drainPass" web/src/app/core/outbox/outbox.service.ts` prints exactly one hit.

**If blocked**
If `outbox-types.ts` has no `ConflictHandler` export or `_runDrain` does not call
`this.conflictHandler(op, errObj['error'])`, STOP and report — the file is not
the one this spec was written against. Do not improvise.

---

### Step 2 — Rewrite `ConflictResolver`'s bound and amend its unit tests

**Model:** haiku

**Status:** done (2026-10-15, web 291/291 exit 0; retired-symbol grep empty; D10 `reviewedAt` diff grep → 0; lint + format exit 0)

**Depends on:** Step 1 — consumes the 3-parameter `ConflictHandler` and
`OutboxOp.reapplies`.

**Files**
- MODIFY `web/src/app/core/outbox/conflict-resolver.ts`
- MODIFY `web/src/app/core/outbox/conflict-resolver.spec.ts`
- DO NOT TOUCH: `outbox.service.ts`, `outbox-types.ts`, `outbox.service.spec.ts`, `collection.store.ts`, any scheduler file

**Context**
Today `resolve()` reloads on every conflict and parks everything after the
second conflict in a pass. New behaviour (AD-032): reload at most once per pass,
recording the pass only if the reload succeeded (`store.load()` swallows errors
and reports them in `store.error()`), and park a review only after its own
lineage has been re-applied `MAX_REAPPLIES` times. The scheduling half
(`schedulerFor(opts).answer(...)` at `reviewedAt`, D10) must not change at all.

**Do**
1. In `conflict-resolver.ts`:
   - Change the Angular import to `import { Injectable, inject } from '@angular/core';` (drop `effect`).
   - Directly above `@Injectable`, add:
     ```ts
     /** Spec 025 D2 / AD-032: an original send plus at most two re-applied
      *  sends — original (0) → 409 → (1) → 409 → (2) → 409 → parked. */
     export const MAX_REAPPLIES = 2;
     ```
   - Replace the class doc comment with:
     ```ts
     /**
      * D8 seam: the outbox detects a 409 and delegates to this resolver, which
      * re-applies the rejected rating on top of the server's card at the
      * original answer instant (D10).
      *
      * Spec 025 / AD-032: the store is reloaded at most once per drain pass
      * (only a successful reload counts), and each review's lineage is
      * re-applied at most MAX_REAPPLIES times before it is parked in the
      * visible conflicts list. The bound follows the lineage, not the card: a
      * conflict legitimately cascades along an offline chain of one card.
      */
     ```
   - Replace `private reloadsThisPass = 0;` with
     `private reloadedForPass: number | null = null;`
   - Replace the whole constructor body with:
     ```ts
         // D8: register as the conflict handler.
         this.outbox.setConflictHandler((op, body, pass) => this.resolve(op, body, pass));
     ```
   - Replace the whole `resolve` method with (helpers `extractRevlog`,
     `extractRating`, `extractTimingInfo` stay unchanged):
     ```ts
       async resolve(op: OutboxOp, body: unknown, pass: number): Promise<ConflictOutcome> {
         if (op.path !== '/review') {
           return { outcome: 'unresolved', reason: 'conflict on non-review path' };
         }

         // D2: bound per lineage, checked before anything spends the reload.
         const reapplies = op.reapplies ?? 0;
         if (reapplies >= MAX_REAPPLIES) {
           return { outcome: 'unresolved', reason: 'reapply limit reached' };
         }

         const serverCard = (body as Record<string, unknown> | null)?.['card'] as Card | undefined;
         if (!serverCard) {
           return { outcome: 'unresolved', reason: '409 without card' };
         }

         const revlog = this.extractRevlog(op);
         if (!revlog) {
           return { outcome: 'unresolved', reason: 'no revlog in op body' };
         }

         const rating = this.extractRating(revlog);
         if (rating === null) {
           return { outcome: 'unresolved', reason: 'invalid button' };
         }

         // D1: one successful reload per drain pass. load() swallows errors, so
         // a failed reload is not recorded and the next conflict retries it.
         if (this.reloadedForPass !== pass) {
           await this.store.load();
           if (this.store.error() === null) this.reloadedForPass = pass;
         }

         const deck = this.store.deckById(serverCard.deckId);
         if (deck === undefined) {
           return { outcome: 'unresolved', reason: 'unknown deck' };
         }

         const opts = this.store.optionsFor(deck) ?? this.store.defaultDeckOptions();
         if (opts === undefined) {
           return { outcome: 'unresolved', reason: 'no deck options' };
         }

         // D10: re-schedule at the original answer instant, not Date.now()
         const coll = this.store.collection();
         if (coll === null) {
           return { outcome: 'unresolved', reason: 'no collection' };
         }

         const { reviewedAt, timeMs } = this.extractTimingInfo(revlog);
         const ctx = { now: reviewedAt, today: todayNumber(coll, reviewedAt) };
         const { card: fresh, revlog: freshRevlog } = schedulerFor(opts).answer(
           serverCard,
           rating,
           opts,
           ctx,
           timeMs,
         );

         const applied: Card = { ...fresh, rev: freshRevlog.id };
         this.store.applyCard(applied);

         // Replace in place at the queue head, preserving FIFO (AD-029).
         return {
           outcome: 'replaced',
           replacement: {
             id: freshRevlog.id,
             method: 'POST',
             path: '/review',
             body: {
               card: applied,
               revlog: freshRevlog,
               expectedRev: serverCard.rev ?? null,
             },
             reapplies: reapplies + 1,
           },
         };
       }
     ```
2. In `conflict-resolver.spec.ts`:
   - Add `MAX_REAPPLIES` to the import: `import { ConflictResolver, MAX_REAPPLIES } from './conflict-resolver';`
   - Every existing `resolver.resolve(op, body)` style call gains a third
     argument `1` (e.g. `resolver.resolve(op, body, 1)`). Tests 1, 2, 4 and 5
     ("reloads once and returns replaced", "D10: …", "non-/review path …",
     "409 without card …") are otherwise **unchanged** — in particular D10's
     test body must not be edited beyond the third argument.
   - **Replace** the test `third consecutive conflict in one pass returns "unresolved" with budget reason`
     with a test named
     `conflicts in one pass reload once; a new pass reloads again`:
     `const load = vi.spyOn(store, 'load').mockResolvedValue(undefined);`
     `store.error.set(null);` then `resolve(makeOp({ id: 'rev1' }), { card: makeCard() }, 1)`,
     same for `'rev2'` and `'rev3'` with pass `1` — expect all three outcomes
     `'replaced'` and `load` called **1** time. Then
     `resolve(makeOp({ id: 'rev4' }), { card: makeCard() }, 2)` — expect
     `'replaced'` and `load` called **2** times.
   - **Replace** the test `a replacement op that itself 409s cannot loop forever — budget holds`
     with a test named
     `a lineage is parked after MAX_REAPPLIES re-applies, without spending a reload`:
     spy `load` as above. `let op = makeOp();` then loop
     `for (let i = 1; i <= MAX_REAPPLIES; i++)`: `const out = await resolver.resolve(op, { card: makeCard() }, i);`
     expect `out.outcome` `'replaced'`; then, **inside**
     `if (out.outcome === 'replaced') { … } else { throw new Error('expected replaced'); }`
     (TS narrowing — `replacement` does not exist on the `'unresolved'` variant),
     expect `out.replacement.reapplies` to be `i` and reassign
     `op = { ...out.replacement, attempts: 0, failedReason: null, createdAt: Date.now() };`.
     After the loop (`load` has been called 2 times — passes 1 and 2): `const callsBefore = load.mock.calls.length;`
     `const last = await resolver.resolve(op, { card: makeCard() }, MAX_REAPPLIES + 1);`
     expect `'unresolved'` with reason `'reapply limit reached'`, and
     `load.mock.calls.length` still `callsBefore` (C-5: a parked op spends no reload).
   - **Add** a test named `a failed reload is not recorded; the next conflict in the pass retries it`
     (A7): `const load = vi.spyOn(store, 'load').mockImplementation(async () => { store.error.set('boom'); });`
     resolve `'rev1'` and `'rev2'` with pass `1` → `load` called **2** times.
     Then `load.mockImplementation(async () => { store.error.set(null); });`
     resolve `'rev3'` and `'rev4'` with pass `2` → `load` called **3** times in total.
     (The resolver still re-applies after a failed reload — outcomes are `'replaced'`; assert that too.)
3. `npm run format` then `npm run lint:ci`.

**Done when**
- `npm run test -w web` exits 0; passing count = baseline + 1 (two tests replaced, one added).
- `grep -rn "reload budget exhausted\|reloadsThisPass\|effect(" web/src/app/core/outbox/` prints nothing.
- `git diff -U0 web/src/app/core/outbox/conflict-resolver.spec.ts | grep "^[-+]" | grep -c "reviewedAt"` prints `0` (D10's test untouched).
- `npm run lint:ci` and `npm run format:check` exit 0.

**If blocked**
If the D10 test fails after this step, STOP — the scheduling half was changed,
which this step forbids. If `vi.spyOn(store, 'load')` does not intercept the
resolver's call, STOP and report; do not switch the resolver to a different
store API.

---

### Step 3 — Integration spec: real outbox + real resolver over a fake API

**Model:** haiku

**Status:** done (2026-10-15, web 296/296 exit 0; `grep -c "^  it("` → 5; lint + format exit 0. Executor first called `setup()` before `seed()` — 5/5 red — and fixed the order in its own file, as the Context prescribes)

**Depends on:** Step 2 — exercises the new resolver through the real drain loop.

**Files**
- CREATE `web/src/app/core/outbox/conflict-drain.spec.ts`
- DO NOT TOUCH: every non-spec file; `conflict-resolver.spec.ts`; `outbox.service.spec.ts`

**Context**
No existing test wires the real `ConflictResolver` into the real drain loop.
`CollectionStore` itself injects `OutboxService`, and `OutboxService`'s
constructor starts a drain of whatever is in `localStorage`. Its first
`send` settles on a microtask, so as long as every `TestBed.inject` and the
`store.load` spy happen synchronously in one block, the resolver is registered
before the first 409 is handled. Seed ops into `localStorage` **before** that
block so the whole queue is present in the first pass. Real timers (no
`vi.useFakeTimers()`): no conflict path uses `setTimeout`.

Copy the fixture helpers `makeCollection`, `makeDeck`, `makeDeckOptions`,
`makeCard`, `makeRevlog` verbatim from `conflict-resolver.spec.ts` (top of file,
up to but not including `makeOp`). `CollectionBundle` fields are
`{ collection, notetypes, decks, deckoptions }` (see `CollectionStore._runLoad`).
A 409 is produced exactly as `outbox.service.spec.ts` does it:
`throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'stale card', card } }))`.

**Two traps (round 2, C-18/C-19):**
- A real `store.load()` runs `unburyForNewDay()`, which **enqueues a
  `PATCH /collection` op** unless `collection.lastUnburyDay >= today`. The
  harness's `getCollection` therefore returns
  `lastUnburyDay: Number.MAX_SAFE_INTEGER`, and every `send` fake starts with
  `if (path !== '/review') return of({});` as a second guard.
- **Do NOT import `MAX_REAPPLIES` (or anything not in the harness's import list)
  from `conflict-resolver.ts`.** Step 4 runs this file against `HEAD`'s
  resolver, which has no such export; a missing named export fails the whole
  file. Use the literals `3` (sends) and `2` (`reapplies`).

**Do**
1. Create the file with this harness (fill the fixture helpers by copying):
   ```ts
   import { TestBed } from '@angular/core/testing';
   import { HttpErrorResponse } from '@angular/common/http';
   import { of, throwError, type Observable } from 'rxjs';
   import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

   import { ApiService } from '../api.service';
   import { CollectionStore } from '../collection.store';
   import type { Card, Collection, Deck, DeckOptions, RevlogEntry } from '../models';
   import { ConflictResolver } from './conflict-resolver';
   import { OUTBOX_KEY } from './outbox-ops';
   import { OutboxService } from './outbox.service';
   import type { OutboxOp } from './outbox-types';

   // --- fixtures copied from conflict-resolver.spec.ts ---

   type Send = (method: string, path: string, body: unknown) => Observable<unknown>;
   interface ReviewBody { card: Card; revlog: RevlogEntry; expectedRev: string | null }

   function conflict(card: Card): Observable<never> {
     return throwError(
       () => new HttpErrorResponse({ status: 409, error: { error: 'stale card', card } }),
     );
   }

   function reviewOp(id: string, cardId: string, expectedRev: string): OutboxOp {
     const revlog = makeRevlog({ id, cardId });
     return {
       id, method: 'POST', path: '/review',
       body: { card: makeCard({ id: cardId }), revlog, expectedRev },
       createdAt: Date.now(), attempts: 0, failedReason: null,
     };
   }

   function seed(ops: OutboxOp[]): void {
     localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, ops, failed: [], conflicts: [] }));
   }

   function setup(send: Send, cards: Card[]) {
     const sendMock = vi.fn<Send>(send);
     const api = {
       send: sendMock,
       getCollection: vi.fn(() =>
         of({
           // MAX_SAFE_INTEGER: stops unburyForNewDay() enqueueing a PATCH /collection mid-drain.
           collection: { ...makeCollection(), lastUnburyDay: Number.MAX_SAFE_INTEGER },
           notetypes: [],
           decks: [makeDeck()],
           deckoptions: [makeDeckOptions()],
         }),
       ),
       getCards: vi.fn(() => of(cards)),
     };
     TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
     // All synchronous, before the boot drain's first send settles (C-14).
     const store = TestBed.inject(CollectionStore);
     const load = vi.spyOn(store, 'load');
     const outbox = TestBed.inject(OutboxService);
     TestBed.inject(ConflictResolver);
     return { store, load, outbox, send: sendMock };
   }

   describe('conflict drain (spec 025)', () => {
     beforeEach(() => localStorage.clear());
     afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
     // tests below
   });
   ```
   If `ApiService` typing rejects the partial fake in `useValue`, that is fine
   — `useValue` is untyped; do not add casts beyond what lint requires.
2. **A1** — `it('a stale queue of 5 conflicting ops on 5 cards drains fully in one pass, reloading once')`:
   cards `c1..c5` with `makeCard({ id: 'cN', rev: 'server-N' })`; seed
   `reviewOp('op-N', 'cN', 'stale')` for N = 1..5. `send` fake: keep a
   `Set<string>` of card ids already conflicted and a `conflicts409` counter;
   for a `/review` body whose `card.id` is not yet in the set, add it,
   increment the counter, and return `conflict(serverCardFor(id))` (the
   matching `cN` card); otherwise return `of((body as ReviewBody).card)`.
   After `await outbox.drain()`: `outbox.pending()` length 0,
   `outbox.conflicts()` length 0, `load` called 1 time, `conflicts409` is 5,
   `send` called 10 times, and every `send` call's path (`send.mock.calls[i][1]`)
   is `'/review'`.
3. **A3** — `it('a lineage that keeps 409ing is parked after 2 re-applies; the queue behind drains')`:
   seed, in order, `op-1`/`c1`, `op-2`/`c2` (each conflicts once, as in A1),
   `op-A`/`c3` (conflicts on **every** send), `op-B`/`c4` (never conflicts).
   Count sends whose body card id is `c3`. After `await outbox.drain()`:
   c3 sends = 3; `outbox.conflicts()` length 1, its `conflictReason` is
   `'reapply limit reached'` and its `reapplies` is 2; `send` was called with a
   body whose `card.id` is `'c4'`; `outbox.pending()` length 0.
4. **A4** — `it('an offline chain of 3 reviews of one card cascades and every review re-applies')`:
   one stateful server card `let stored = makeCard({ id: 'c1', rev: 'server-0' });`
   seed `reviewOp('op-1','c1','local-0')`, `reviewOp('op-2','c1','op-1')`,
   `reviewOp('op-3','c1','op-2')` (each op's `expectedRev` is the previous op's
   id, as `Review.rate()` produces offline). `send` fake for `/review`: if
   `b.expectedRev !== (stored.rev ?? null)` increment a 409 counter and return
   `conflict(stored)`; else set `stored = { ...b.card, rev: b.revlog.id }`, push
   `{ expectedRev: b.expectedRev, revlogId: b.revlog.id }` onto an `accepted`
   array, and return `of(stored)`. `getCards` returns `[stored]`.
   After `await outbox.drain()`: `send` called 6 times, 409 counter 3, `load`
   called 1 time, `outbox.conflicts()` length 0, `accepted` length 3,
   `accepted[0].expectedRev === 'server-0'`, and for i = 1, 2
   `accepted[i].expectedRev === accepted[i - 1].revlogId`.
5. **A5** — `it('a new drain pass reloads again on its first conflict')`:
   seed one op `op-1`/`c1` that conflicts once; `await outbox.drain()`; expect
   `load` called 1 time. Then `outbox.enqueue({ id: 'op-2', method: 'POST', path: '/review', body: reviewOp('op-2','c2','stale').body });`
   (`c2` conflicts once), `await outbox.drain()`; expect `load` called 2 times
   and `outbox.conflicts()` length 0. Add the comment
   `// Regression guard, not a bug proof: also passes on pre-025 code (Analyst A5).`
6. **A6** — `it('reapplies is persisted on the replacement op before it is sent')`:
   seed one op `op-1`/`c1` (conflicts once, no `reapplies` field — a pre-025
   op). In the `send` fake, on the **second** call (the replacement), read
   `(JSON.parse(localStorage.getItem(OUTBOX_KEY)!) as { ops: OutboxOp[] }).ops[0].reapplies`
   into a variable. After `await outbox.drain()`: that variable is `1`, and
   `outbox.conflicts()` length 0.
7. `npm run format` then `npm run lint:ci`.

**Done when**
- `npm run test -w web` exits 0; passing count = Step 2's count + 5.
- `grep -c "^  it(" web/src/app/core/outbox/conflict-drain.spec.ts` prints `5`.
- `npm run lint:ci` and `npm run format:check` exit 0.

**If blocked**
If A1 fails with `load` called 0 times, the spy was installed after the resolver
handled the first conflict — STOP and report the order of injections rather
than adding `await`s or fake timers. If any test hangs, STOP: a `send` fake
returned an observable that never completes. If `outbox.pending()` or the
`send` calls contain a `/collection` or `/cards/*` op, STOP — the
`lastUnburyDay` guard is missing.

---

### Step 4 — Checkpoint + falsifiability (A2): the new spec is red on the old resolver

**Model:** haiku

**Status:** done (2026-10-15, `old-resolver exit=1`, restore check `1`; 4 failed on HEAD's resolver — A1 `expected [ { id: 'op-3', … }, …(2) ] to have a length of +0 but got 3`, A3 `expected 1 to be 3`, A4 `called 6 times, but got 5 times`, A6 `expected undefined to be 1`; A5 green; checkpoint web 296/296 exit 0, lint + format exit 0)

**Depends on:** Step 3 — the spec under test.

**Files**
- No source change. Temporarily overwrites `conflict-resolver.ts` and
  `conflict-resolver.spec.ts` with their `HEAD` versions and restores them **in
  the same shell command** (L-034).
- DO NOT TOUCH: everything else.

**Do**
1. Run exactly this, as **one** Bash call **with `timeout: 600000`** (the
   default 120 s can kill the call mid-test, before any restore runs). The
   `trap … EXIT` restores both files however the inner shell exits (L-034):
   ```bash
   bash -c '
   T="${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp"; mkdir -p "$T"; D=web/src/app/core/outbox
   cp $D/conflict-resolver.ts "$T/r.ts" && cp $D/conflict-resolver.spec.ts "$T/s.ts" || exit 2
   trap "cp \"$T/r.ts\" $D/conflict-resolver.ts; cp \"$T/s.ts\" $D/conflict-resolver.spec.ts" EXIT
   git show HEAD:$D/conflict-resolver.ts > $D/conflict-resolver.ts
   git show HEAD:$D/conflict-resolver.spec.ts > $D/conflict-resolver.spec.ts
   npm run test -w web > "$T/a2.txt" 2>&1; echo "old-resolver exit=$?"
   '; grep -c "reapply limit reached" web/src/app/core/outbox/conflict-resolver.ts
   ```
2. `T="${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp"; grep -E "✗|×|FAIL" "$T/a2.txt" | head -20`
   — list the failing test names.
3. Checkpoint:
   `T="${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp"; npm run test -w web > "$T/cp.txt" 2>&1; echo exit=$?; tail -15 "$T/cp.txt"`,
   then `npm run lint:ci`, `npm run format:check`, `git status --short`.

**Done when**
- Step 1's command prints `old-resolver exit=1` (non-zero) and its last line is `1` (restored).
- The failing names in `a2.txt` include the A1, A3, A4 and A6 tests of
  `conflict-drain.spec.ts`; the A5 test is **not** among them.
- After restore: `npm run test -w web` exits 0 at Step 3's count; lint and
  format exit 0; `git status --short` lists only the files Steps 1–3 touched
  plus `specs/025-conflict-resolver-budget/`, `specs/STATE.md` and root
  `STATE.md` (the run's `## Executing:` marker).

**If blocked**
If the restore line does not print `1`, STOP immediately and report — the
source is in the reverted state. Restore with exactly
`cp "${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp/r.ts" web/src/app/core/outbox/conflict-resolver.ts`
and
`cp "${CLAUDE_JOB_DIR:-/tmp/spec025}/tmp/s.ts" web/src/app/core/outbox/conflict-resolver.spec.ts`
only. If the
old resolver passes A1, A3 or A4, STOP and report: the test is hollow.

---

### Step 5 — Full gates by exit code (A9)

**Model:** haiku

**Status:** done (2026-10-15, `npm run test` exit 0 — server 95, web 296; `npm run build`, `lint:ci`, `format:check` exit 0; retired-reason grep empty; `data/spanish/` clean)

**Depends on:** Step 4 — the restored tree.

**Files**
- None modified.

**Do**
1. Run each separately and record its exit code (L-031 — read the exit code,
   not the pass count): `npm run test`, `npm run build`, `npm run lint:ci`,
   `npm run format:check`.
2. `grep -rn "reload budget exhausted" web/src` — expect no output.
3. `git status --short data/spanish/` — if anything is listed, run
   `git checkout -- data/spanish/` (L-002) and report that you did.

**Done when**
- All four commands exit 0; report server and web passing counts.
- The grep prints nothing.

**If blocked**
If any command exits non-zero, STOP and report its last 30 lines. Do not fix.

---

### Step 6 — Acceptance walk-through and memory

**Model:** top-level

**Status:** done (2026-10-15, A1–A9 MET in `Analyst.md` §5a; `state_rotate.py --check` exit 0; `clean-table-check.sh` exit 0; run marker removed)

**Depends on:** Step 5 — the green gates.

**Files**
- MODIFY `specs/025-conflict-resolver-budget/Analyst.md` — §5 verdicts, retrospective
- MODIFY `specs/STATE.md` — AD-030 pointer, Quick Tasks close row
- MODIFY `.claude/skills/scheduling-domain/SKILL.md` — only if a domain gotcha surfaced

**Do**
1. Walk A1–A9, writing a dated MET / NOT MET verdict with evidence under each.
2. Add `→ superseded by AD-032` to AD-030's amendment (Rule 2); add a Quick
   Tasks row closing the 2026-10-15 `ConflictResolver` Open row.
3. Record any new lesson as an `L-NNN` pair (`STATE.md` + `LESSONS.md`).
4. Remove the `## Executing:` line from root `STATE.md`.
5. **Do not commit — ask the user first.**

**Done when**
- Every A has a verdict; `python3 tools/state_rotate.py --check` exits 0;
  `bash scripts/clean-table-check.sh` exits 0.
