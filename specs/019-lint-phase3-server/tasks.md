# Tasks — Phase 3: `server/src` lint remediation

**11 steps, in order, do not skip ahead.** Baseline: `server/src` has **41**
violations across 11 files; `npm test` is green at **280** (71 server, 209 web).

Every code fix in this file was applied, linted, type-checked, formatted and
tested in this worktree during the Analyst pass, then reverted
(`Analyst.md` §4). The verified diff is
[`verified-remediation.patch`](./verified-remediation.patch) — **use it as the
authoritative cross-check**: after each code step, the file's content should
match that patch's hunk for it. If your edit and the patch disagree, the patch
is right and you should stop and report rather than reconciling by hand.

**Running counts** (assert these exactly — a mismatch means stop, not adjust):

| After step | `npx eslint server/src` |
|---|---|
| baseline | 41 |
| 1 | 28 |
| 2 | 23 |
| 3 | 16 |
| 5 | 10 |
| 6 | 1 |
| 7 | 0 |

---

### Step 1 — Autofix the 13 `no-confusing-void-expression`, then format

**Model:** haiku

**Status:** done (2026-08-31, `eslint server/src` = 28 problems, format:check + tsc
clean, 71 tests; 6 files changed, diff read at top level and matched
`verified-remediation.patch`)

**Files**
- MODIFY `server/src/app.ts`
- MODIFY `server/src/middleware/auth.ts`
- MODIFY `server/src/middleware/auth.test.ts`
- MODIFY `server/src/app.integration.test.ts`
- MODIFY `server/src/routes/notes.integration.test.ts`
- MODIFY `server/src/routes/resume.integration.test.ts`
- DO NOT TOUCH: `eslint.config.mjs`, `package.json`, anything under `web/`

**Context**
All 13 autofixable violations in `server/src` are this one rule (Analyst §5).
The fixer rewrites `return f();` → `{ f(); return; }` and `() => r()` →
`() => { r(); }`. It emits the block on one line, which prettier disagrees
with — hence the mandatory `npm run format` in the same step (Analyst D2). This
is the *only* step allowed to run `--fix`.

**Do**
1. Run `npx eslint --fix server/src`.
2. Run `npm run format`.
3. Read the whole diff: `git diff server/src`. Every hunk must be either
   `return f();` → a `{ f(); return; }` block, or `() => r()` → `() => { r(); }`.
   **If any hunk changes a condition, an argument, or the order of two calls,
   stop and report** — that is not this rule's transformation.
4. Confirm the three hunks in `middleware/auth.ts` kept the call-then-return
   order of the credential check (`unauthorized(res); return;`, never
   `return; unauthorized(res);`).

**Done when**
- `npx eslint server/src 2>&1 | tail -3` reports exactly **28** problems (was 41)
- `npm run format:check` exits 0
- `npx tsc --noEmit -p server/tsconfig.json` exits 0
- `npm test -w server` — **71** tests pass
- `git diff --name-only server/src` lists exactly the 6 files above

**If blocked**
If `--fix` changes a file not in the list above, or the count is not 28, STOP
and report the actual diff. Do not hand-edit to reach the number.

---

### Step 2 — The four scattered source-file fixes

**Model:** haiku

**Status:** done (2026-08-31, `eslint server/src` = 23, tsc + format:check clean,
71 tests, 1 `void (async` in index.ts; shutdown block read at top level —
`flushAll()` still precedes `server.close()`, no await/try-catch added)

**Depends on:** Step 1 — `app.ts` was already edited there; this step edits a
different line of the same file, so it must run after.

**Files**
- MODIFY `server/src/app.ts` — anchor: `if (config.staticDir) {`
- MODIFY `server/src/index.ts` — anchor: `const shutdown = async () => {`
- MODIFY `server/src/import/cli.ts` — anchor: `main().catch((err) => {`
- DO NOT TOUCH: any `*.test.ts`, `server/src/routes/`, `server/src/import/transform.ts`

**Context**
`index.ts`'s shutdown handler is the `flushAll()` path CLAUDE.md names as the
reason no review is lost on SIGINT/SIGTERM. `process.on` never awaited it, so
it was already fire-and-forget; the voided IIFE keeps that behaviour exactly
while making the listener's type honest. Do not add error handling, a timeout,
or an `await` — that would change shutdown behaviour.

**Do**
1. `server/src/app.ts`: `if (config.staticDir) {` → `if (config.staticDir != null) {`.
   (`staticDir` is `string | null` and only ever a real directory path or null —
   `config.ts:50` — so `''` is unreachable.)
2. `server/src/index.ts`: replace the shutdown block with, comment included:
   ```ts
     // Flush debounced writes on shutdown so no review is lost. The listener must
     // be void-returning (`process.on` does not await it), so the async work is an
     // explicitly-voided IIFE rather than an async listener.
     const shutdown = () => {
       void (async () => {
         await store.flushAll();
         server.close(() => process.exit(0));
       })();
     };
   ```
3. `server/src/index.ts`: `main().catch((err) => {` → `main().catch((err: unknown) => {`.
4. `server/src/import/cli.ts`: same `(err: unknown)` change.

**Done when**
- `npx eslint server/src 2>&1 | tail -3` reports exactly **23** problems
- `npx tsc --noEmit -p server/tsconfig.json` exits 0
- `npm run format:check` exits 0
- `npm test -w server` — **71** tests pass
- `grep -n "void (async" server/src/index.ts` returns exactly 1 line

**If blocked**
If `process.on('SIGINT', shutdown)` no longer type-checks, the listener is
still async — re-read step 2's block. Do not silence it with a cast.

---

### Step 3 — The scattered test-file fixes

**Model:** haiku

**Status:** done (2026-08-31, `eslint server/src` = 16, tsc + format:check clean,
71 tests, app.integration 15; diff read at top level — all three `api()`
signatures preserved, IIFE body unchanged, no try/catch added)

**Depends on:** Step 1 — all four files were touched there.

**Files**
- MODIFY `server/src/middleware/auth.test.ts`
- MODIFY `server/src/store/seed.test.ts`
- MODIFY `server/src/app.integration.test.ts` — anchor: `async function api(`
- MODIFY `server/src/routes/notes.integration.test.ts` — anchor: `async function api(`
- MODIFY `server/src/routes/resume.integration.test.ts` — anchor: `async function api(`
- DO NOT TOUCH: `server/src/routes/index.ts`, `server/src/import/`

**Context**
The `no-misused-spread` hits are a real catch, not a false positive:
`HeadersInit` includes `string[][]`, which object-spreads into numeric indices.
The same duplicated `api()` helper appears in three test files and gets the
identical fix in each. Caller-supplied headers must still win, as they did when
they were spread last — `if (!headers.has(...))` preserves that.

**Do**
1. In all three `api()` helpers, replace the `fetch` body with (comment included):
   ```ts
     // `Headers` rather than an object spread: `HeadersInit` includes `string[][]`,
     // which spreads into an object as numeric indices. Caller-supplied headers
     // still win, as they did when they were spread last.
     const headers = new Headers(init?.headers);
     if (!headers.has('content-type')) headers.set('content-type', 'application/json');
     return fetch(`${base}${path}`, { ...init, headers });
   ```
   In `app.integration.test.ts` the template is `` `${base}${path}` `` with
   `base` as a *parameter* — keep that file's existing signature and template.
2. `auth.test.ts`, both sites: `addr && typeof addr === 'object'` →
   `addr != null && typeof addr === 'object'`.
3. `auth.test.ts`, the `password containing a colon` test: make the `listen`
   callback synchronous and wrap its body:
   ```ts
       // `listen`'s callback is void-returning, so the async work is an
       // explicitly-voided IIFE rather than an async listener.
       const server2 = app2.listen(0, () => {
         void (async () => {
           ...existing body, unchanged...
         })();
       });
   ```
   Do **not** add a `try`/`catch` or reject the outer promise — that is a real
   improvement but out of scope (Analyst §10) and would change behaviour.
4. `seed.test.ts`: `if (dir)` → `if (dir != null)`.

**Done when**
- `npx eslint server/src 2>&1 | tail -3` reports exactly **16** problems
- `npm run format:check` exits 0
- `npm test -w server` — **71** tests pass, and specifically
  `npm test -w server -- app.integration` passes **15** (this file drives the
  basic-auth 401/200 paths, so a header regression shows up here)

**If blocked**
If any auth test flips from 401 to 200 or vice versa, the header merge changed
precedence — revert this file and report.

---

### Step 4 — Checkpoint (no new code)

**Model:** haiku

**Status:** done (2026-08-31, eslint 16, tsc + format:check clean, 280 tests
(71+209), `web/src` diff empty, scope exactly the 9 expected files)

**Depends on:** Steps 1–3.

**Files** — none. This step writes no code.

**Do**
1. `npx eslint server/src 2>&1 | tail -3`
2. `npx tsc --noEmit -p server/tsconfig.json`
3. `npm run format:check`
4. `npm test` (root, both workspaces)
5. `git diff --name-only origin/main..HEAD -- web/src` — must be empty.
6. Re-read the diff of Steps 1–3 against `verified-remediation.patch`'s hunks
   for those files. Report any divergence rather than fixing it.

**Done when**
- eslint reports **16**; tsc exits 0; format:check exits 0
- `npm test` — **280** tests (71 server, 209 web)
- the `web/src` diff is empty

**If blocked**
Any count off by even one: STOP and report which step's Done-when no longer
holds. Do not proceed to Step 5.

---

### Step 5 — `routes/index.ts`: the four non-mechanical sites

**Model:** haiku

**Status:** done (2026-08-31, file at 0, `eslint server/src` = 10, tsc +
format:check clean, 71 tests; guards re-grepped at top level in the file
itself — `cardUpdates ?? []` L74, `if (revlog)` L122, `.at(0)` chain L182 all
present, both casts optional, no eslint-disable)

**Depends on:** Step 4 — starts from a verified-green tree.

**Files**
- MODIFY `server/src/routes/index.ts`
- DO NOT TOUCH: anything else. No autofix in this step.

**Context**
**Read this before editing.** Three of these violations are ESLint calling a
*live* runtime guard dead, because a `req.body as {...}` cast asserts more than
the network can guarantee, and because `noUncheckedIndexedAccess` is off so an
array index is typed as always-present. **The fix is always to make the type
honest, never to delete the guard.** `/collection/resume` is the endpoint that
bulk-writes `card.due`; deleting its `?? []` makes a request omitting the field
throw mid-loop with cards already mutated in memory.

**Do**
1. `/collection/resume`'s cast — make the field optional, leave `?? []` alone:
   ```ts
       cardUpdates?: { id: string; due: number }[];
   ```
2. `/review`'s cast — same, leave `if (revlog)` alone:
   ```ts
       const { card, revlog } = req.body as { card: Card; revlog?: RevlogEntry };
   ```
3. `GET /cards` — replace the ternary condition:
   ```ts
       // `!= null` alone is not equivalent here: `?deckId=` yields `''`, which the
       // truthy test sent down the "all cards" branch. No card has an empty
       // deckId, so dropping the `!== ''` would return [] instead.
       res.json(deckId != null && deckId !== '' ? cards.filter((c) => c.deckId === deckId) : cards);
   ```
4. `PATCH /notes/:id`'s deck fallback — `.at(0)`, not `[0]`, and **not** a
   `const x: T | undefined = arr[0]` annotation (TypeScript narrows a `const`
   to its initializer's type; that was tried and produced *more* violations,
   Analyst §10):
   ```ts
         // `.at(0)` rather than `[0]`: without `noUncheckedIndexedAccess` an array
         // index types as non-optional, so the `??` fallbacks read as dead code.
         // They are live — `existing` is empty for a note's first card and
         // `getDecks()` is empty on a fresh store.
         const deck = deckId ?? existing.at(0)?.deckId ?? store.getDecks().at(0)?.id ?? '';
   ```

**Done when**
- `npx eslint server/src/routes/index.ts` exits 0 — zero violations in this file
- `npx eslint server/src 2>&1 | tail -3` reports exactly **10** problems
- `npx tsc --noEmit -p server/tsconfig.json` exits 0
- `npm test -w server -- resume.integration` — **6** tests pass
- `npm test -w server -- notes.integration` — **5** tests pass
- `git diff server/src/routes/index.ts` shows **no deleted `??`, no deleted
  `if (revlog)`, and no deleted `?? []`** — only the type/condition changes above

**If blocked**
If any fix seems to require removing a runtime guard to satisfy the rule, STOP
and report. That is the exact defect class this step exists to prevent.

---

### Step 6 — `transform.ts`: the nine mechanical fixes

**Model:** haiku

**Status:** done (2026-08-31, `eslint server/src` = 1 — the `complexity` hit at
`transform.ts:182` that Step 7 owns; tsc + format:check clean, transform 9,
71 tests; diff read at top level and matched `verified-remediation.patch`).
First dispatch was killed by an account spend limit (HTTP 429) **before it made
any edit** — `transform.ts` verified unmodified, tree clean at the Step 5
boundary, restarted from scratch. (The dispatch prompt's file-count arithmetic
was wrong — it said 10 changed files when 11 is correct, having forgotten
Step 5's `routes/index.ts`. Executor listed the right 11.)

**Depends on:** Step 5.

**Files**
- MODIFY `server/src/import/transform.ts`
- DO NOT TOUCH: `server/src/import/run.ts`, `server/src/import/cli.ts`,
  `server/src/cards/generate.ts`

**Context**
This file owns the import identity contract (`python-pipeline`): note id
`n{guid}`, card id `c{guid}-{ord}`, `guid = sha1("{slug}:{Card_ID}")[:16]`.
Re-import preserves scheduling **only** because those strings are
deterministic. Fix #4 below rewrites the card-id expression — it must produce a
byte-identical string. Do not touch the `complexity` violation here; that is
Step 7.

**Do**
1. `resolveNoteType` — replace the `!` with a named throw:
   ```ts
     const noteType = NOTE_TYPES_BY_ID.get(id);
     if (!noteType) throw new Error(`seed note type missing: ${id}`);
     return noteType;
   ```
2. `isUrl` and `isLocalMedia` — `!!v` → `v != null && v !== ''` in both. (`v`
   is `string | null | undefined`; `''` is the only falsy string, so this is
   exactly equivalent, and both stay type predicates.)
3. `DeckRegistry.order` becomes `Deck[]`, which removes the `byName`/`order`
   invariant rather than asserting it:
   ```ts
   interface DeckRegistry {
     byName: Map<string, Deck>;
     /** Insertion order. Holds the decks themselves so it cannot drift from `byName`. */
     order: Deck[];
   }
   ```
   In `ensureDeck`, `reg.order.push(acc)` → `reg.order.push(deck)`; at the
   bottom of `transformBooks`, `const decks = reg.order.map((name) => reg.byName.get(name)!);`
   → `const decks = [...reg.order];`
4. `ensureDeck` — one lookup instead of `has()` + `get()!` (Phase 2's D2), and
   the trailing lookup disappears because the loop already holds the deck:
   ```ts
     const cached = reg.byName.get(fullName);
     if (cached) return cached.id;

     const parts = fullName.split(DECK_SEP);
     let parentId: string | null = null;
     let acc = '';
     for (let i = 0; i < parts.length; i++) {
       acc = i === 0 ? parts[0] : acc + DECK_SEP + parts[i];
       let deck = reg.byName.get(acc);
       if (!deck) {
         // Reuse existing id (and collapsed state) so re-import is stable.
         const prior = existingByName.get(acc);
         deck = {
           id: prior?.id ?? 'd' + hash(acc),
           name: acc,
           parentId,
           optionsId: prior?.optionsId ?? 'opts-default',
           collapsed: prior?.collapsed ?? false,
         };
         reg.byName.set(acc, deck);
         reg.order.push(deck);
       }
       parentId = deck.id;
     }
     // `parts` always has at least one element, so the loop always assigns.
     return parentId ?? '';
   ```
5. In `walk`, the card-id line: `const cardId = 'c' + guid + '-' + ord;` →
   `` const cardId = `c${guid}-${ord}`; ``
6. In `walk`, replace the `carriesCards` const with an inline narrowing —
   `if (Array.isArray(node.cards) && node.cards.length > 0) {` — and change
   `for (const sc of node.cards!)` to `for (const sc of node.cards)`. (TS does
   not carry the narrowing through an intermediate boolean const.)

**Done when**
- `npx eslint server/src 2>&1 | tail -3` reports exactly **1** problem — the
  `complexity` violation, which Step 7 owns
- `npx tsc --noEmit -p server/tsconfig.json` exits 0
- `npm test -w server -- transform` — **9** tests pass
- `grep -n "reg.byName.get(name)" server/src/import/transform.ts` returns nothing

**If blocked**
If `transform.test.ts` fails on an id or a `due` value, a fix changed the
identity contract — revert and report the failing assertion verbatim.

---

### Step 7 — `transform.ts`: extract `buildNote` / `buildCard` for `complexity`

**Model:** haiku

**Status:** done (2026-08-31, **`npx eslint server/src` exits 0 — zero
violations, from 41**; tsc + format:check clean, transform 9, 71 tests; one
`newCardPosition++`, guarded by `if (!priorCard)`; both `buildCard` branches
read at top level and match `verified-remediation.patch`)

**Depends on:** Step 6 — same file.

**Files**
- MODIFY `server/src/import/transform.ts`
- DO NOT TOUCH: anything else.

**Context**
`walk` is complexity 17 against a max of 15. It is also where a new card gets
its `due` **position** and its SM-2/FSRS defaults, and where a re-imported
card's prior scheduling state is preserved. Two things must survive exactly:
every field of both branches, and the fact that **`newCardPosition` advances
only when no prior card existed** (it was `due: newCardPosition++` inline, in
the else branch only). Transcribe the code below; do not restructure further.

**Do**
1. Add both helpers immediately above `ensureDeck`'s doc comment:
   ```ts
   /**
    * Build the note for one scraped card. `guid` is the identity hash — see the
    * header comment; `prior` preserves the existing note's id and creation time so
    * re-import reconciles in place.
    */
   function buildNote(
     sc: ScrapedCard,
     guid: string,
     prior: Note | undefined,
     noteTypeId: string,
     now: number,
   ): Note {
     return {
       id: prior?.id ?? 'n' + guid,
       noteTypeId,
       fields: {
         SideA: sc.SideA ?? '',
         SideAAudio: mediaAudio(sc.SideAAudio),
         SideAImage: mediaImage(sc.SideAImage),
         SideB: sc.SideB ?? '',
         SideBAudio: mediaAudio(sc.SideBAudio),
         SideBImage: mediaImage(sc.SideBImage),
       },
       tags: [],
       created: prior?.created ?? now,
       modified: now,
       guid,
     };
   }

   /**
    * Build one card for a note. An existing card keeps ALL its scheduling state
    * (`due`, `queue`, `type`, `reps`, `ease`, `interval`, FSRS fields) and only has
    * its placement refreshed; a fresh card gets the standard "new" defaults, with
    * `due` as its position in the new-card queue (see `scheduling-domain`).
    * The caller advances `newCardPosition` only when a fresh card is built.
    */
   function buildCard(
     cardId: string,
     priorCard: Card | undefined,
     noteId: string,
     deckId: string,
     ord: number,
     now: number,
     newCardPosition: number,
   ): Card {
     if (priorCard) {
       // Preserve scheduling state; only refresh placement.
       return { ...priorCard, noteId, deckId, ord, modified: now };
     }
     return {
       id: cardId,
       noteId,
       deckId,
       ord,
       type: 'new',
       queue: 'new',
       due: newCardPosition,
       reps: 0,
       lapses: 0,
       left: 0,
       lastReviewed: null,
       created: now,
       modified: now,
       ease: 2500,
       interval: 0,
       stability: null,
       difficulty: null,
     };
   }
   ```
2. Replace the body of `walk`'s card loop with:
   ```ts
           for (const sc of node.cards) {
             const guid = hash(`${book.slug}:${sc.Card_ID}`);
             const prior = existingNotesByGuid.get(guid);
             const note = buildNote(sc, guid, prior, noteType.id, now);
             notes.push(note);

             for (const ord of ords) {
               const cardId = `c${guid}-${ord}`;
               const priorCard = existingCardsById.get(cardId);
               const cardDeckId = templateByOrd.get(ord)?.deckId ?? deckId;
               cards.push(
                 buildCard(cardId, priorCard, note.id, cardDeckId, ord, now, newCardPosition),
               );
               // Only a freshly-built card consumes a new-queue position.
               if (!priorCard) newCardPosition++;
             }
           }
   ```

**Done when**
- `npx eslint server/src` exits 0 — **zero** violations in `server/src` (was 41)
- `npx tsc --noEmit -p server/tsconfig.json` exits 0
- `npm run format:check` exits 0
- `npm test -w server` — **71** tests pass
- `grep -c "newCardPosition++" server/src/import/transform.ts` returns **1**

**If blocked**
If eslint still reports `complexity`, do NOT add an `eslint-disable` (Analyst
D5) and do not invent a further split — report the remaining count.

---

### Step 8 — Prove the importer refactor byte-for-byte over the real corpus

**Model:** haiku

**Status:** done (2026-08-31, 3/3 byte-identical over the real corpus;
**negative control fired** — `ease: 2500`→`2400` failed exactly 2 of 3
(cold import, gap re-import), the same two the Analyst pass measured, then 3/3
again after restoring; both temp files deleted, `git status` clean of `??`
under `server/src`, `eslint server/src` exit 0, 71 tests)

**Depends on:** Steps 6 and 7 — this verifies both.

**Files**
- CREATE `server/src/import/transform.baseline.ts` — **temporary, deleted in this step**
- CREATE `server/src/import/equiv.test.ts` — **temporary, deleted in this step**
- DO NOT TOUCH: `server/src/import/transform.ts` (this step must not change
  production code)

**Context**
`transform.test.ts`'s 9 tests do not pin the identity contract across a whole
corpus, and Steps 6–7 changed card-id construction and new-card `due`
sequencing. This step runs the *pre-change* transformer beside the new one over
the real `data/spanish/_source/` corpus (3,638 scraped cards) and compares the
entire `ImportResult` as JSON. It ends by deleting both temporary files — they
are meaningless once the change has landed and must not be committed.

**Do**
1. `git show origin/main:server/src/import/transform.ts > server/src/import/transform.baseline.ts`
2. Create `server/src/import/equiv.test.ts` that imports `transformBooks` from
   both modules, loads every `data/spanish/_source/*.json` except `_index.json`
   into `SourceBook` (`{ slug: <basename>, root: <parsed root> }`), fixes
   `now = 1_700_000_000_000`, and asserts
   `JSON.stringify(after) === JSON.stringify(before)` for three scenarios:
   - **cold**: `existing = { decks: [], notes: [], cards: [] }`, plus
     `expect(after.notes.length).toBeGreaterThan(100)` so an empty corpus
     cannot pass vacuously;
   - **re-import with state**: cold result fed back as `existing`, with every
     3rd card given `type/queue: 'review'`, `due: 400 + i`, `reps: 5`,
     `lapses: 1`, `ease: 2300`, `interval: 12`;
   - **re-import with gaps**: cold result fed back with
     `cards.filter((_, i) => i % 2 === 0)`, so fresh cards are minted
     interleaved with preserved ones.
3. `npm test -w server -- equiv` — all 3 must pass.
4. **Negative-control the harness.** Temporarily change `ease: 2500` to
   `ease: 2400` in `transform.ts`'s `buildCard`, re-run, and confirm scenarios
   1 and 3 now FAIL (scenario 2 legitimately still passes — every card there
   has a prior and never reaches the fresh-card branch). Then restore `2500`
   and confirm all 3 pass again.
5. Delete both temporary files:
   `rm server/src/import/transform.baseline.ts server/src/import/equiv.test.ts`

**Done when**
- Step 3's run: 3 passed
- Step 4's negative control: exactly 2 of 3 failed on the perturbation, and 3 of
  3 passed after restoring — **report both numbers**; if the perturbation did
  not fail the harness, the harness is hollow and the step has failed
- After deletion: `git status --short server/src` shows only `transform.ts`
  and the other steps' files as modified — no new untracked files
- `npx eslint server/src` exits 0 and `npm test -w server` — **71** tests

**If blocked**
If any scenario differs, Step 6 or 7 changed importer output. Report the first
differing field from the diff; do not "fix" the harness to make it pass.

---

### Step 9 — Checkpoint (no new code)

**Model:** haiku

**Status:** done (2026-08-31, all 8 checks pass: eslint/tsc/build/format:check
exit 0, 280 tests (71+209), no `eslint-disable`, `web/src` diff empty, no
untracked files under `server/src`). Dispatched in one executor together with
Step 10, with a hard "stop if any Step 9 check fails" gate between them —
a deliberate deviation from one-step-per-dispatch to reduce cold-start cost
after the spend-limit interruption at Step 6; the gate preserved the ordering
non-negotiable (a directory joins the CI gate only once already clean).

**Depends on:** Steps 5–8.

**Files** — none.

**Do**
1. `npx eslint server/src` → expect exit 0.
2. `npx tsc --noEmit -p server/tsconfig.json`, `npm run build`.
3. `npm run format:check`.
4. `npm test` (root).
5. `grep -rn "eslint-disable" web/src server/src` → must return nothing.
6. `git diff --name-only origin/main..HEAD -- web/src` → must be empty.
7. `git status --short` → no stray untracked files under `server/src`.

**Done when**
- eslint `server/src` exits 0; build, tsc, format:check all exit 0
- `npm test` — **280** tests (71 server, 209 web)
- the `eslint-disable` grep and the `web/src` diff are both empty

**If blocked**
Report which check failed and stop. Step 10 must not run over a red tree.

---

### Step 10 — Gate `server/src` in CI

**Model:** haiku

**Status:** done (2026-08-31, `"lint:ci": "eslint web/src server/src"` — grepped
at top level per L-015, not trusted to the exit code; `ci.yml` lint-job comment
now names both workspaces and leaves the repo root + `tools/` to Phase 4;
`npm run lint:ci` exit 0; 280 tests; nothing under `web/src` touched)

**Depends on:** Step 9 — a directory joins the gate only once it is already
clean (the roadmap's non-negotiable #2).

**Files**
- MODIFY `package.json` — anchor: `"lint:ci":`
- MODIFY `.github/workflows/ci.yml` — anchor: the `lint:ci` step's comment
- DO NOT TOUCH: `server/src`, `web/src`

**Context**
Phase 2 collapsed the web half to one directory after finding nine
clean-but-ungated files that Phase 1's violation-sized path list had skipped.
Do not grow a list here — name the directory (Analyst D3). **`npm run lint:ci`
exits 0 whether or not you make this edit**, because everything it already
names is clean; that vacuous check shipped once in Phase 1 (L-015), so the
Done-when below asserts on the script's *text*.

**Do**
1. `"lint:ci": "eslint web/src"` → `"lint:ci": "eslint web/src server/src"`.
2. Update the `lint` job's comment in `ci.yml` so it no longer describes
   `server/src` as pending Phase 3; it should now say the gate covers both
   workspaces and that Phase 4 folds in the repo root and `tools/`.

**Done when**
- `grep '"lint:ci"' package.json` output contains **both** `web/src` and
  `server/src` — paste the line in the report
- `npm run lint:ci` exits 0
- `grep -n "lint:ci" .github/workflows/ci.yml` shows the step still present
- `npm test` — **280** tests

**If blocked**
If `npm run lint:ci` exits non-zero, a file outside `server/src`/`web/src` is
being linted — report the paths, do not narrow the gate to make it pass.

---

### Step 11 — Docs, retrospective, and stop

**Model:** top-level

**Status:** done (2026-08-31 — `INVENTORY.md` final table (254 → 0) +
Phase 3's 11 files; `ROADMAP.md` Phase 3 ticked, Phase 4 inheritance listed,
5 dated Discovered entries; **L-016** paired across `specs/STATE.md` +
`specs/LESSONS.md`; Quick Tasks row for the hanging auth test; §11 acceptance
walk (10/10) and §12 retrospective written; `verified-remediation.patch`
deleted; root `STATE.md` marker removed. `state_rotate --check` **fails at 301
lines, 1 over budget** — names AD-017 (frees 25); left for a human per
CLAUDE.md. **Not committed — awaiting the user.**)

**Depends on:** Step 10.

**Files**
- MODIFY `specs/015-typescript-lint-rollout/INVENTORY.md`
- MODIFY `specs/015-typescript-lint-rollout/ROADMAP.md`
- MODIFY `specs/STATE.md`, `specs/LESSONS.md`
- MODIFY `specs/019-lint-phase3-server/Analyst.md` — §11 retrospective
- MODIFY `STATE.md` (root) — remove the `## Executing:` marker

**Context**
This step edits the spec docs, which subagents are blocked from writing
(`protect-spec-docs-from-subagents.sh`) — hence `top-level`.

**Do**
1. `INVENTORY.md`: record Phase 3 as 41 → 0 and the repo total as 0.
2. `ROADMAP.md`: tick both Phase 3 boxes; add dated Discovered entries for the
   items in `Analyst.md` §10, and note what Phase 4 inherits (repo root,
   `tools/`, `web/src/index.html`, `noUncheckedIndexedAccess`).
3. `specs/STATE.md`: add the lesson headline from `Analyst.md` §10 — *a harden
   pass must re-derive, not re-reason* — as **L-016** (L-015 is the highest in
   use; verified in the harden pass), with its body in `specs/LESSONS.md`
   (both, or the pre-push gate refuses). Add a Quick Tasks row for the
   `auth.test.ts` hang-on-failure defect.
4. Walk `Analyst.md` §9's ten acceptance criteria and record pass/fail for each.
5. Fill in `Analyst.md` §11.
6. Delete `specs/019-lint-phase3-server/verified-remediation.patch` (22 KB,
   over the archive gate's per-file limit).
7. Remove the `## Executing: 019-lint-phase3-server` line from root `STATE.md`.
8. `python3 tools/state_rotate.py --check`. **Expect this to fail.**
   `specs/STATE.md` was at 299 lines of its 300-line budget before this step,
   so the L-016 headline and the Quick Tasks row will take it over. Report the
   overage and which `AD-`/`B-` entries are due for rotation; **do not** run
   `--apply` — CLAUDE.md reserves it for a human who has decided to rotate.
   This blocks the push, not the work.
9. `bash scripts/clean-table-check.sh`.

**Done when**
- All ten §9 criteria are recorded with evidence
- `specs/STATE.md` and `specs/LESSONS.md` each carry the new `L-` entry
- `verified-remediation.patch` is gone; root `STATE.md` has no `## Executing:` line
- `bash scripts/clean-table-check.sh` passes
- **Do not commit — ask the user first.**
