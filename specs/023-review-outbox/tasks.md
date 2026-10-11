# Tasks — 023 · Never lose a review in flight

**16 steps, in order, do not skip ahead.** Every step ends at a green build —
never leave the repo non-compiling between steps.

Baselines measured 2026-09-18 before any step ran:

| Suite | Files | Tests |
|---|---|---|
| `npm run test -w server` | 12 | **82** |
| `npm run test -w web` | 21 | **216** |

Every "Done when" that quotes a test count is relative to these.

Read before touching code: `.claude/skills/scheduling-domain` (Steps 1–2, 7–9),
`.claude/skills/angular-conventions` (Steps 3–12),
`.claude/skills/testing-playbook` (any step that writes a test).

**Steps run sequentially.** No parallel group in this spec: Steps 6–10 all
touch the review/persistence path and several share files, so the ordering is
doing the checking (see `specs/TEMPLATE.md`, "Running steps in parallel").

---

### Step 1 — Make `appendRevlog` idempotent on `RevlogEntry.id`

**Model:** haiku

**Status:** done — 88 tests / 14 files in `server`; `revlogIds` grep returns 4;
`npm run build` green. Note: first pass was reverted by the Step 5 checkpoint —
tests passed (85/13) but `npm run build -w server` failed, because the new test
used `type: 'new'`, not in `RevlogType` (`'learn' | 'review' | 'relearn'`).
Vitest does not type-check, and this step's "Done when" bullets were test-only,
so nothing here caught it. Fixed to `'learn'`; test file only.

**Files**
- MODIFY `server/src/store/file-store.ts` — anchors: `async init(): Promise<void> {` (~line 84) and `async appendRevlog(entry: RevlogEntry)` (~line 216)
- CREATE `server/src/store/file-store.revlog-dedupe.test.ts`
- DO NOT TOUCH: `server/src/routes/index.ts` (Step 2 covers the route), any file under `web/`

**Context**
`appendRevlog` is a bare `appendFile` with no uniqueness check and exactly one
caller (`routes/index.ts:122`), so this one method is the whole chokepoint.
The dedupe key already exists: `RevlogEntry.id` is minted once by the scheduler
(`web/src/app/core/scheduling/sm2.ts:37`), not per HTTP attempt, so a retried
op carries one id. The motivating case is a POST the server **applied
successfully** whose response never arrived — the client must retry and the
server must absorb it (Analyst D4).
Model the test on `server/src/store/file-store.flush.test.ts` for store-level
shape and on `testing-playbook` for temp-dir isolation:
`new FileStore(mkdtempSync(join(tmpdir(), 'srs-')), { debounceMs: 0 })`, with
`rmSync(dir, { recursive: true })` in `afterAll`.

**Do**
1. Add a private field to `FileStore`: `private revlogIds = new Set<string>();`
2. In `init()`, **after** the `this.data = { ... }` assignment and before the
   migration block, populate it: read the revlog via the existing
   `this.readRevlog()` and `for (const e of entries) this.revlogIds.add(e.id);`.
   Reading the whole file is deliberate and accepted (Analyst D4 / C-7) — do
   **not** implement a bounded window.
3. Change `appendRevlog` to return early without writing when
   `this.revlogIds.has(entry.id)`, and to `this.revlogIds.add(entry.id)` after
   a successful append. It still returns `Promise<void>` — the signature does
   not change, so no caller changes.
4. Write the new test file with three cases:
   - appending two entries with **different** ids yields 2 lines;
   - appending the **same** entry twice yields 1 line;
   - a store re-`init()`ed over an existing `revlog.ndjson` still rejects a
     duplicate of an id written before the restart (this is the case that
     proves the set is populated from disk, not just accumulated in memory).

**Done when**
- `npm test -w server -- file-store.revlog-dedupe.test.ts` — 3 tests pass
- `npm run test -w server` — **85** tests pass, 13 files (was 82/12)
- `grep -n "revlogIds" server/src/store/file-store.ts` returns exactly 4 hits
  (declaration, populate, `has`, `add`)

**If blocked**
If `readRevlog()` is not already defined on `FileStore` (~line 221), STOP and
report — this plan assumed it exists and reuses it rather than re-parsing the
file.

---

### Step 2 — Pin replay-safety at the route level

**Model:** haiku

**Status:** done — 88 tests / 14 files in `server` (was 85/13); `routes/index.ts` unchanged, only the new test file added

**Depends on:** Step 1 — consumes the dedupe it adds to `FileStore.appendRevlog`; this step proves it through the real Express route.

**Files**
- CREATE `server/src/routes/review-idempotency.integration.test.ts`
- DO NOT TOUCH: `server/src/routes/index.ts` — it needs **no change**. The dedupe lives in `appendRevlog`, and `POST /review`'s card write is an absolute replacement that is already safe to repeat. If you find yourself editing the route, stop: the design is wrong, not the route.

**Context**
Acceptance criterion **A3**: an identical `POST /api/review` body sent twice
appends exactly one revlog line. Step 1's unit test proves the store method;
this proves the property a client actually depends on, end to end.
Copy the harness shape from `server/src/routes/notes.integration.test.ts`
verbatim — `mkdtempSync` temp dir, `new FileStore(dir, { debounceMs: 0 })`,
`await store.init()`, real `express()` + `buildRouter(store)`, `app.listen(0)`,
its local `api(path, init)` `fetch` helper, and `rmSync` in `afterAll`. Seed
one deck, one note type, and one card so `/review` can find the card by id
(it 404s on an unknown card — `routes/index.ts:118`).

**Do**
1. Create the test file with the harness above and a single `describe`.
2. Case 1 — **replay appends once**: build `{ card, revlog }` with a fixed
   `revlog.id`; POST it twice; assert both responses are 200, and that
   `(await store.readRevlog()).filter(e => e.id === <that id>)` has length 1.
3. Case 2 — **the card write still applies on the replay**: POST once with
   `interval: 5`, then POST the same `revlog.id` with `interval: 9`; assert the
   stored card's `interval` is 9 and the revlog still has 1 line for that id.
   This documents the asymmetry deliberately: the card is last-write-wins, the
   revlog is write-once.
4. Case 3 — **distinct ids both land**: two POSTs with different `revlog.id`
   yield 2 revlog lines.

**Done when**
- `npm test -w server -- review-idempotency.integration.test.ts` — 3 tests pass
- `npm run test -w server` — **88** tests pass, 14 files (was 85/13 after Step 1)
- `git diff --name-only` lists only the new test file — `routes/index.ts` is unchanged

**If blocked**
If `POST /review` returns 404, the seeded card id and the posted `card.id`
disagree — fix the fixture, do not relax the assertion.

---

### Step 3 — Pure outbox core: types, classification, backoff, (de)serialisation

**Model:** haiku

**Status:** done — N = 34. Web: 250 tests / 22 files (was 216/21). No `@angular` import in either source file; `tsc --noEmit` and `npm run build -w web` clean

**Files**
- CREATE `web/src/app/core/outbox/outbox-types.ts`
- CREATE `web/src/app/core/outbox/outbox-ops.ts`
- CREATE `web/src/app/core/outbox/outbox-ops.spec.ts`
- DO NOT TOUCH: anything outside `web/src/app/core/outbox/`

**Context**
`angular-conventions` — "pure logic first": anything algorithmic is a plain
exported function in `core/*.ts` with **no Angular imports** and a colocated
`*.spec.ts` using plain `vitest` imports and no TestBed. This step is that
layer; Step 5's service is the thin wiring over it. Model the spec on
`web/src/app/core/daily-limits.spec.ts` (tiny factory helpers, plain
`import { describe, expect, it } from 'vitest'`).
The backoff floor of 2000ms is **not arbitrary** — Analyst D5 / critic C-5: the
tier-1 rate limiter is 20 failures per 15 minutes across every route with
`skipSuccessfulRequests: true` (`server/src/app.ts:70-78`), so a fast retry
loop locks the whole app out. Do not lower it.

**Do**
1. Write `outbox-types.ts` with exactly:
   ```ts
   /** An API mutation queued for delivery. Persisted verbatim. */
   export interface OutboxOp {
     /** Client-minted and stable across retries. For a review op this is the
      *  `RevlogEntry.id`, so the client key and the server dedupe agree. */
     id: string;
     method: 'POST' | 'PATCH';
     /** Path relative to `/api` — e.g. `/review`, `/cards/c123`. */
     path: string;
     body: unknown;
     /** Epoch ms the op was created. FIFO tiebreak and UI age. */
     createdAt: number;
     /** Consecutive failed attempts; drives backoff. */
     attempts: number;
     /** Null while retryable; set once classified poison. */
     failedReason: string | null;
   }

   /** What is held in localStorage under `OUTBOX_KEY`. */
   export interface OutboxState {
     version: 1;
     /** FIFO. Index 0 is the next op to send. */
     ops: OutboxOp[];
     /** Poisoned ops: retained, surfaced, never auto-deleted. */
     failed: OutboxOp[];
   }
   ```
2. Write `outbox-ops.ts` with four pure exports and no Angular import:
   - `export const OUTBOX_KEY = 'srs.outbox.v1';`
   - `export const EMPTY_STATE: OutboxState = { version: 1, ops: [], failed: [] };`
   - `classify(status: number | null): 'ok' | 'retry' | 'poison'` — `null`
     (network error / status 0) → `'retry'`; 200–299 → `'ok'`; 400, 404, 422 →
     `'poison'`; **everything else, including 401, 403, 408, 429 and all 5xx**
     → `'retry'`. 401/403 are retryable on purpose: Basic credentials can come
     back, and the rate limiter 429s an ordinary page load.
   - `backoffMs(attempts: number): number` — `Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1))`.
   - `parseState(raw: string | null): OutboxState` — returns a **deep copy** of
     `EMPTY_STATE` for `null`, for invalid JSON, for a non-object, for a
     `version !== 1`, and for a payload whose `ops`/`failed` are not arrays. It
     must never throw: a corrupt key must degrade to an empty outbox, not brick
     the app on boot.
3. Write `outbox-ops.spec.ts` covering: each `classify` bucket including the
   named boundary codes (399/400/422/423 and 401/403/429/500); `backoffMs` for
   attempts 1, 2, 5 and 20 (asserting the 60 000 cap and the 2 000 floor); and
   every `parseState` degradation branch above, plus one round-trip of a
   populated state through `JSON.stringify` → `parseState`.

**Done when**
- `npm run test -w web` — **216 + N** tests pass where N is the number added
  (state the number in the Status line), 22 files (was 21)
- `grep -rn "@angular" web/src/app/core/outbox/outbox-ops.ts web/src/app/core/outbox/outbox-types.ts` returns **no hits**
- `npx tsc -p web/tsconfig.json --noEmit` is clean, or `npm run build -w web` succeeds

**If blocked**
If `parseState` cannot be written without throwing on some input, STOP and
report rather than adding a `try/catch` at the call site — never-throws is the
contract this step exists to establish.

---

### Step 4 — Add a generic `send()` passthrough to `ApiService`

**Model:** haiku

**Status:** done — web build succeeds; 250 tests / 22 files, 0 failures; `grep -c "send("` returns 1

**Files**
- MODIFY `web/src/app/core/api.service.ts` — anchor: `private readonly base = '/api';`
- DO NOT TOUCH: any existing method on `ApiService`; `web/src/app/core/collection.store.ts`

**Context**
`angular-conventions` says HTTP goes only through `ApiService`. The outbox
replays an op it stored as `{ method, path, body }`, so it needs one generic
escape hatch rather than a `switch` over every typed method — which would have
to be extended every time a route is added, and would silently drop an op whose
path it did not recognise. This method exists **for the outbox only**; say so
in the doc comment so nobody reaches for it as a shortcut.

**Do**
1. Add, after the existing methods:
   ```ts
   /**
    * Generic passthrough used **only** by the outbox, which stores ops as
    * `{ method, path, body }` and cannot call a typed method by name. Prefer a
    * typed method above for anything else.
    */
   send(method: 'POST' | 'PATCH', path: string, body: unknown): Observable<unknown> {
     const url = `${this.base}${path}`;
     return method === 'POST'
       ? this.http.post<unknown>(url, body)
       : this.http.patch<unknown>(url, body);
   }
   ```

**Done when**
- `npm run build -w web` succeeds
- `npm run test -w web` — same count as after Step 3, 0 failures
- `grep -c "send(" web/src/app/core/api.service.ts` returns 1

**If blocked**
Nothing here should block. If `Observable` is not already imported in this
file, it is — `rxjs` is imported at the top.

---

### Step 5 — Checkpoint

**Model:** haiku

**Status:** done (second pass) — server 88/14, web 250/22, `npm run build` green
(exit 0), `git status --short` free of `data/spanish/`. Steps 1–4 grep
assertions all re-verified. **First pass FAILED** and reverted Step 1: both
suites were green but `npm run build` was red. The checkpoint earned its place
here — see Step 1's Status. Lesson candidate for Step 15: a "Done when" that
lists only test commands cannot see a `tsc` error, since vitest does not
type-check.

**Depends on:** Steps 1–4 — re-confirms their Done when before the wiring steps build on them.

**Files**
- DO NOT TOUCH: anything. This step writes **no code**.

**Context**
`specs/TEMPLATE.md`: a checkpoint every ~4 steps, verifying against ground
truth rather than trusting the `Status:` claims. Steps 6–10 all rewire the
persistence path; drift found here is cheap, drift found there is not.

**Do**
1. Run each command in **Done when** and record the actual numbers.
2. Re-read Steps 1–4's own "Done when" lines and confirm each still holds.
3. If any does not, set that step's `**Status:**` back to `in progress`, say so
   explicitly in the report, and STOP.

**Done when**
- `npm run test -w server` — 88 tests, 14 files
- `npm run test -w web` — 216 + N tests (N from Step 3), 22 files
- `npm run build` — both workspaces succeed
- `git status --short` shows no unexpected file, and nothing under `data/spanish/` (L-002)

**If blocked**
Report which step's condition failed and stop. Do not repair a previous step
inside a checkpoint — checkpoints observe, they do not fix.

---

### Step 6 — `OutboxService`: durable queue, FIFO drain, backoff

**Model:** haiku

**Status:** done — 10 tests added; web 260 / 23 files (was 250/22). `npm run build`
green (both workspaces). Falsifiability check ran as required: with the
single-flight `draining` guard deleted, the FIFO test goes RED (`send` called 3×
instead of 1×); restored, green. Scope clean — only `core/outbox/` touched.

⚠️ **Amended after Step 13 found a defect.** The original `drain()` early-returned
when a drain was in flight, so `await drain()` did not wait — see Step 13's
Status for the full diagnosis. `drain()` is now non-`async` and coalesces
*safely*: it awaits the in-flight run, then re-checks whether work arrived after
that run's loop had already exited, and starts a fresh run if so. The vestigial
`draining` boolean is gone — `drainPromise` is the single guard. Loop semantics
(FIFO, one in-flight request, poison→continue, retry→backoff→break) unchanged.
Regression test T11 added; web total 261 / 23 files.

**Depends on:** Step 3 — consumes `OutboxOp`, `OutboxState`, `OUTBOX_KEY`, `classify`, `backoffMs`, `parseState`. Step 4 — consumes `ApiService.send()`.

**Files**
- CREATE `web/src/app/core/outbox/outbox.service.ts`
- CREATE `web/src/app/core/outbox/outbox.service.spec.ts`
- DO NOT TOUCH: `collection.store.ts`, `review.ts`, `app.ts` — Steps 7–11 wire those. This step's service must be complete and tested with **no caller yet**.

**Context**
Follow `core/pause.service.spec.ts` for the spec shape: `TestBed` with a mocked
`ApiService`, `vi.fn()` returning `of(...)` / `throwError(...)`. Follow
`core/collection.store.ts` for service shape: `@Injectable({ providedIn:
'root' })`, `inject()` fields, public `readonly` signals, `computed()` derived
views.
**`localStorage` is written synchronously inside `enqueue`, before it returns**
— that is the entire reason for choosing it over IndexedDB (Analyst D2). A
`QuotaExceededError` must surface on a signal, never be swallowed.
FIFO with **one in-flight request** is a correctness requirement, not a
nicety (Analyst D4): ops carry absolute card states, so out-of-order delivery
resurrects an older one.

**Do**
1. Create the service with this surface (implement the bodies):
   ```ts
   readonly pending = signal<OutboxOp[]>([]);
   readonly failed = signal<OutboxOp[]>([]);
   readonly status = signal<'idle' | 'draining' | 'waiting' | 'error'>('idle');
   readonly pendingCount = computed(() => this.pending().length);
   readonly storageError = signal<string | null>(null);

   enqueue(op: Omit<OutboxOp, 'attempts' | 'failedReason' | 'createdAt'>): void
   drain(): Promise<void>
   retryFailed(): void
   ```
2. In the constructor: `parseState(localStorage.getItem(OUTBOX_KEY))` into the
   two signals, add a `window.addEventListener('online', () => void this.drain())`,
   and kick `void this.drain()`.
3. `enqueue` — synchronous: append to `pending` with `attempts: 0`,
   `failedReason: null`, `createdAt: Date.now()`; **persist immediately**; then
   `void this.drain()` (not awaited).
4. `persist()` — private; `localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, ops: this.pending(), failed: this.failed() }))` inside a
   `try/catch` that sets `storageError` on failure. Never throws.
5. `drain()` — guard with a private `draining` boolean so only one runs. While
   `pending()` is non-empty, take the head and
   `await lastValueFrom(this.api.send(op.method, op.path, op.body))`:
   - success → drop the head, persist, continue;
   - error → `classify(err.status ?? null)`:
     - `'poison'` → move the head to `failed` with `failedReason` set, persist,
       **continue** with the next op (Analyst D5: skipping is safe because a
       later op for the same card carries a later absolute state);
     - `'retry'` → increment `attempts`, persist, set `status` to `'waiting'`,
       schedule one `setTimeout(() => void this.drain(), delay)` and **return**
       (head-of-line blocking preserves order). `delay` is
       `backoffMs(op.attempts)`, except on a 429 carrying a `Retry-After`
       header in seconds, where that value in ms wins if it is larger.
   - Never retry immediately after a failure (C-5).
6. Set `status` to `'draining'` while a request is in flight, `'idle'` when
   `pending()` empties, `'error'` when `failed()` is non-empty.
7. `retryFailed()` — move everything from `failed` back to the **tail** of
   `pending` with `attempts: 0`, `failedReason: null`; persist; `void this.drain()`.
8. Write the spec with at least these cases, each with `localStorage.clear()`
   in `beforeEach` and `vi.useFakeTimers()` where backoff is involved:
   - `enqueue` writes to `localStorage` **before** it returns (assert
     `localStorage.getItem(OUTBOX_KEY)` inside the same synchronous tick);
   - a fresh service constructed over a pre-seeded `localStorage` key restores
     the pending ops (survives reload);
   - **FIFO under failure**: enqueue A then B, make A fail retryably, assert
     `api.send` was called with A only — B must **not** be attempted (this is
     the A4 assertion; a spec that only asserts "A was called first" passes
     even if ordering is broken);
   - a retry after the backoff delay succeeds and both A and B then land, in
     order;
   - a 404 moves the op to `failed` and the **next** op still drains;
   - a `localStorage.setItem` that throws sets `storageError` and does not
     throw out of `enqueue`.

**Done when**
- `npm test -w web` — the new spec's cases pass; total is Step 3's total + the
  number added (state both numbers in Status), 23 files
- `grep -n "draining" web/src/app/core/outbox/outbox.service.ts` shows the
  single-flight guard exists
- `npm run build -w web` succeeds

**If blocked**
If the FIFO-under-failure case cannot be made to fail against a deliberately
broken implementation (delete the single-flight guard and confirm it goes red),
STOP and report — an assertion that cannot fail is not coverage (L-024, L-006).

---

### Step 7 — Route `CollectionStore`'s study writes through the outbox

**Model:** haiku

**Status:** done — web 260 / 23 files, 0 failures; `npm run build` green (both
workspaces). ⚠️ Amended at Step 12: the four methods are now sync `void`, not
`async` — after the enqueue rewrite they await nothing and
`@typescript-eslint/require-await` fires. No behaviour change (every caller is
fire-and-forget after Step 8), but the public signatures changed.
User-approved; see `Analyst.md` `## Discovered`.
5 `outbox.enqueue` sites; the only remaining `api.patchCard` is
line 208, inside `unsuspendCard` as required. `collection.store.spec.ts`
unchanged, as the step predicted. No circular DI. `lastValueFrom` retained —
still used by `load()`, `getNote()`, `loadNotes()`, `saveNoteFields()`,
`unsuspendCard()`.

**Depends on:** Step 6 — consumes `OutboxService.enqueue()`.

**Files**
- MODIFY `web/src/app/core/collection.store.ts` — anchors: `async burySiblings(`, `async recordStudied(`, `async suspendCard(`, `async unburyForNewDay(`
- DO NOT TOUCH: `unsuspendCard` (browse-side, out of scope — §3 "non-study writes"); `pause.service.ts`; `api.service.ts`

**Context**
Analyst D1: a rating is 2 + N writes, not one. Queueing only the review still
loses the daily tally and the bury. The four methods above already update their
local signals **before** awaiting the HTTP call, so replacing the await with an
`enqueue` leaves local state exactly as it is today — only the transport
changes.
Note this makes *loading the collection* outbox-producing (critic C-3):
`load()` ends with `await this.unburyForNewDay()` (~line 146). That is correct
and converges — FIFO puts the unbury behind any reviews left from the previous
session. Do **not** move the unbury back onto the direct path.
Op ids must be unique per op. Use the pattern
`` `bury-${c.id}-${Date.now()}` ``, `` `daily-${deck.id}-${daily.day}` ``,
`` `susp-${card.id}-${Date.now()}` ``, `` `unbury-${c.id}-${today}` ``,
`` `unburyday-${today}` ``. Only `/review` needs to agree with a server-side
key; these are client-side identity only.

**Do**
1. Add `private readonly outbox = inject(OutboxService);` alongside the
   existing `api` field.
2. `burySiblings` — replace the `await Promise.all(targets.map(... patchCard ...))`
   with a loop of `this.outbox.enqueue({ id: ..., method: 'PATCH', path: \`/cards/${c.id}\`, body: { queue: 'schedBuried' } })`.
3. `recordStudied` — replace `await lastValueFrom(this.api.patchDeck(deck.id, { daily }))`
   with an enqueue of `PATCH /decks/${deck.id}` body `{ daily }`.
4. `suspendCard` — replace with an enqueue of `PATCH /cards/${card.id}` body
   `{ queue: 'suspended' }`.
5. `unburyForNewDay` — replace both the per-card `patchCard` loop and the
   trailing `patchCollection` with enqueues, keeping the existing order
   (cards first, then the collection's `lastUnburyDay`).
6. Keep every method `async` and keep its existing local-signal update. Remove
   any `lastValueFrom` import only if it becomes unused — check with grep
   before deleting it; `load()` and `getNote()` still use it.

**Done when**
- `npm run test -w web` — 0 failures at the Step 6 total. Measured
  2026-09-18: `collection.store.spec.ts` mocks **no** `ApiService` method and
  never references `patchCard`/`patchDeck`/`patchCollection`, so it should need
  no change. If it does change, say why in `Status:` — an unexplained spec edit
  here is a scope leak
- `grep -n "api.patchCard\|api.patchDeck\|api.patchCollection" web/src/app/core/collection.store.ts`
  returns hits **only** inside `unsuspendCard`
- `npm run build -w web` succeeds

**If blocked**
If injecting `OutboxService` into `CollectionStore` produces a circular DI
error, STOP and report — `OutboxService` must depend only on `ApiService`, and
a cycle means Step 6 added a store dependency it should not have.

---

### Step 8 — `Review.rate()` stops awaiting the network

**Model:** haiku

**Status:** done — web 260 / 23 files, 0 failures; `npm run build` green (both
workspaces). `submitReview` gone from `review.ts` (0 hits); `outbox.enqueue` 1
hit at line 284, with `id: revlog.id`. `core/scheduling/` untouched (0 changed
files). `review.spec.ts` fixed exactly as prescribed — `outboxFake` provider,
both assertions kept with their original sense, none deleted.

**Depends on:** Step 6 — consumes `OutboxService.enqueue()`. Step 7 — `recordStudied`/`burySiblings` must already be non-blocking, or this step's await removal is incomplete.

**Files**
- MODIFY `web/src/app/features/review/review.ts` — anchor: `async rate(rating: Rating): Promise<void> {` (~line 264)
- DO NOT TOUCH: `web/src/app/core/scheduling/` — no scheduling math changes here, at all; `review.html`; `review.scss`

**Context**
Analyst D3. This is the change that makes an offline session possible: today
the `await lastValueFrom(this.api.submitReview(next, revlog))` stalls the loop
on the first card with no network. Dropping the await loses **no information**
— verified in critic C-8: the route returns `cards[idx]` with a server-assigned
`modified` and `rate()` already discards the result.
The op's `id` **must be `revlog.id`**, so the client's queue key and the
server's dedupe key (Step 1) are the same value. This is the one op id in the
system with a server-side meaning.

**Do**
1. Add `private readonly outbox = inject(OutboxService);` alongside the
   existing `api` field.
2. Replace `await lastValueFrom(this.api.submitReview(next, revlog));` with:
   ```ts
   // Durable, ordered hand-off — see specs/023-review-outbox Analyst D3/D4.
   // `revlog.id` is the op id on purpose: it is also the server's dedupe key
   // (`FileStore.appendRevlog`), so a retry of this op cannot double-append.
   this.outbox.enqueue({
     id: revlog.id,
     method: 'POST',
     path: '/review',
     body: { card: next, revlog },
   });
   ```
3. Drop the `await` on `this.store.recordStudied(...)` and
   `this.store.burySiblings(...)` — after Step 7 they no longer perform I/O, so
   keep the calls and their order but let them resolve without blocking the
   advance. `await this.loadNext()` stays awaited.
4. Remove the now-unused `ApiService` import/field **only if** grep confirms
   nothing else in the file uses it.

**Done when**
- `npm run test -w web` — 0 failures; `review.spec.ts` in particular passes
- `grep -n "submitReview" web/src/app/features/review/review.ts` returns **no hits**
- `grep -n "outbox.enqueue" web/src/app/features/review/review.ts` returns exactly 1 hit
- `npm run build -w web` succeeds

**`review.spec.ts` will break, and the fix is prescribed — do not improvise.**
Measured 2026-09-18: its `apiFake` is `{ submitReview: vi.fn(() => of(card())) }`
and nothing else (`review.spec.ts:177`), and it asserts on
`apiFake.submitReview` at **lines 244 and 264**. Once `Review` injects
`OutboxService`, the real root service would be constructed over that same
`apiFake` and `drain()` would call `this.api.send(...)`, which does not exist
on it — a `TypeError`, not a clean failure. It would also write to the shared
`localStorage` (which *is* present in this test env — measured) and leak
between tests.
So: add an outbox fake to the TestBed providers rather than extending
`apiFake`:
```ts
outboxFake = { enqueue: vi.fn(), drain: vi.fn(async () => {}), pendingCount: () => 0 };
// …
{ provide: OutboxService, useValue: outboxFake },
```
and rewrite lines 244/264 to assert on `outboxFake.enqueue` — 244 keeps its
`not.toHaveBeenCalled()` sense, 264 keeps `toHaveBeenCalledTimes(1)`. Also add
`load: vi.fn(async () => {})` to `storeFake`, which Step 10 needs.

**If blocked**
If an existing assertion cannot be expressed against the outbox at all, STOP
and report rather than deleting it (L-011).

---

### Step 9 — Checkpoint

**Model:** haiku

**Status:** done — PASS. Server 88 / 14, web 260 / 23, 0 failures; `npm run build`
exit 0 both workspaces. `submitReview` survives only at `api.service.ts:54` (the
now-unused typed method). Steps 6–8 assertions re-verified independently:
`draining` guard present, sole `patchCard` at line 208 inside `unsuspendCard`,
one `outbox.enqueue` at line 284 passing `id: revlog.id`. `core/scheduling/`
clean; nothing under `data/spanish/`.

**Depends on:** Steps 6–8 — re-confirms the rewired persistence path before the UI steps.

**Files**
- DO NOT TOUCH: anything. No code.

**Do**
1. Run each command below and record actual numbers.
2. Re-confirm Steps 6, 7 and 8's own "Done when" lines still hold.
3. If any fails, set that step back to `in progress`, report, STOP.

**Done when**
- `npm run test` — server 88 + web (Step 6 total), 0 failures
- `npm run build` — both workspaces succeed
- `grep -rn "submitReview" web/src/` returns hits only in `api.service.ts` (the
  now-unused typed method may remain) and any spec that tests it
- `git status --short` shows nothing under `data/spanish/` (L-002)

**If blocked**
Report which condition failed and stop.

---

### Step 10 — Gate study-session start on drain **and** reload

**Model:** haiku

**Status:** done — web 260 / 23 files, 0 failures; `npm run build` green (both
workspaces). `grep -n "await this.store.load()"` returns **2** hits: line 187
(new, unconditional, post-drain) and line 190 (the original conditional) — C-2
not re-introduced. Manual bullet deferred to Step 13.
⚠️ The subagent's claim that the `loading()` self-guard cannot no-op the
post-drain reload is an assumption about timing, not a guarantee — the residual
race is written up in `Analyst.md` `## Discovered`. Not fixed inline (scope).

**Depends on:** Step 6 — consumes `OutboxService.drain()` and `pendingCount`. Step 8 — the outbox must already be the review write path, or there is nothing to gate on.

**Files**
- MODIFY `web/src/app/features/review/review.ts` — anchor: `private async init(): Promise<void> {` (~line 175)
- MODIFY `web/src/app/features/review/review.html` — the `@if (loading())` branch
- DO NOT TOUCH: `web/src/app/app.ts` (Step 11); `collection.store.ts`

**Context**
This is the finding that changed the design (critic **C-2**), so implement it
exactly as written. "Wait for the outbox to be empty" is **not sufficient**:
`App`'s constructor fires `void this.store.load()` unconditionally at startup
(`app.ts:51`), fetching `/api/cards` *before* any drain finishes. By the time a
naive gate runs, the ops are gone but the in-memory card array is still the
pre-drain one — so the card the user already answered is back in the queue.
The gate is **drain → re-load the collection → start**. Note `load()`
self-guards on `this.loading()` (`collection.store.ts:135`) and returns
immediately if a load is in flight, so the post-drain reload must be
*sequenced after* the startup load, not fired alongside it.

**Do**
1. Add a `readonly syncing = signal<'no' | 'draining' | 'stuck'>('no');` to
   `Review`.
2. At the very top of `init()`, before the existing
   `if (this.store.decks().length === 0) await this.store.load();`:
   - if `this.outbox.pendingCount() === 0`, fall through unchanged;
   - otherwise set `syncing` to `'draining'`, `await this.outbox.drain()`, and
     then re-check: if `pendingCount()` is still non-zero, set `syncing` to
     `'stuck'`, `loading.set(false)` and **return without starting a session**;
   - if it drained to zero, `await this.store.load()` **unconditionally** (the
     reload C-2 requires — not the `decks().length === 0` conditional), set
     `syncing` back to `'no'`, and continue into the existing body.
3. In `review.html`, add branches before the existing content: when
   `syncing() === 'draining'` show "Syncing N unsaved reviews…"; when
   `syncing() === 'stuck'` show "N reviews not yet saved — reconnect to
   continue" with no rating buttons rendered. Bind N to
   `outbox.pendingCount()`; expose the service as a `protected readonly` field
   so the template can read it.

**Done when**
- `npm run test -w web` — 0 failures
- `npm run build -w web` succeeds
- `grep -n "await this.store.load()" web/src/app/features/review/review.ts`
  returns **2** hits — the original conditional one and the new unconditional
  post-drain one. One hit means C-2 was re-introduced
- Manual: with `npm run dev` up, seed a pending op by hand
  (`localStorage.setItem('srs.outbox.v1', ...)` with an op pointing at a
  nonexistent path) and confirm `/study/all` shows the stuck message instead of
  a card

**If blocked**
If `store.load()`'s `loading()` self-guard makes the post-drain reload a no-op,
STOP and report — do not work around it by mutating the `loading` signal from
`Review`.

---

### Step 11 — Shell banner + `beforeunload` guard

**Model:** haiku

**Status:** done — web 260 / 23 files, 0 failures (`app.spec.ts` passes with no new
provider, as the step predicted); `npm run build` green both workspaces.
`beforeunload` via the decorator `host` object (`app.ts:14`), not
`@HostListener`. `.outbox-banner` has its own class/colour. Manual bullets
deferred to Step 13.
⚠️ Amended at Step 12: `e.returnValue = ''` removed (deprecated; lint flags it) —
the handler now calls `preventDefault()` only. User-approved; see `Analyst.md`
`## Discovered`.

**Depends on:** Step 6 — consumes `pendingCount`, `status`, `failed`, `retryFailed()`.

**Files**
- MODIFY `web/src/app/app.ts` — anchor: `readonly paused = computed(`
- MODIFY `web/src/app/app.html` — anchor: `@if (paused()) {` (line 1)
- MODIFY `web/src/app/app.scss` — anchor: `.pause-banner {` (line 1)
- DO NOT TOUCH: `review.ts`, `review.html`, `collection.store.ts`

**Context**
Analyst D7. Silent loss is the failure mode that matters, so every outbox state
needs a visible representation. The existing `.pause-banner` at the top of
`app.html` is the exact precedent — a shell-level `role="status"` strip above
`.app-shell`. Copy its structure and its SCSS block (`display:flex`,
centred, `0.5rem 1rem`, `font-size: 0.85rem`), giving the new one its own
class and colour so it is not confused with the pause state.
`beforeunload` goes through the component decorator's `host` binding, per
`angular-conventions` ("not `@HostListener`") — `review.ts` already
demonstrates the pattern with `'(document:keydown)'`.

**Do**
1. In `app.ts`, inject `OutboxService` as a `protected readonly outbox` and add
   a `computed()` returning the banner text: `null` when
   `pendingCount() === 0 && failed().length === 0`; otherwise a string covering
   the three states — draining ("Saving N reviews…"), waiting/offline ("N
   reviews not yet saved — will retry"), error ("N reviews could not be saved").
2. Add `'(window:beforeunload)': 'onBeforeUnload($event)'` to the `@Component`
   decorator's `host` object, and a method that calls `e.preventDefault()` and
   sets `e.returnValue = ''` **only** when the banner text is non-null.
3. In `app.html`, add an `@if` block for the banner immediately after the
   existing pause block, with `role="status"`. When `failed().length > 0`, also
   render a "Retry" button wired to `outbox.retryFailed()`.
4. Add the matching `.outbox-banner` rule to `app.scss`.

**Done when**
- `npm run test -w web` — 0 failures; `app.spec.ts` in particular passes
- `npm run build -w web` succeeds
- Manual with `npm run dev`: DevTools → Network → Offline, answer one card,
  confirm the banner appears with a count of 1, then go back Online and confirm
  it clears
- Manual: with the banner showing, attempting to close the tab prompts

**If blocked**
`app.spec.ts` should **not** need a new provider: measured 2026-09-18, a
root-provided service that injects `ApiService` resolves in a bare
`TestBed.configureTestingModule({})`, and both `localStorage` and `window`
exist in this test env. So the real `OutboxService` constructs fine there, and
with an empty queue its constructor drain is a no-op. If it nonetheless fails,
STOP and report the actual error — do not add providers by trial and error.

---

### Step 12 — Checkpoint: full suite, build, lint, format

**Model:** haiku

**Status:** done (second pass) — server 88 / 14, web 260 / 23, 0 failures;
`npm run build` exit 0 both workspaces; `npm run lint:ci` clean;
`npm run format:check` clean; `git status` free of `data/spanish/`.
First pass found ~52 lint violations. Most were mechanical, but **two were
genuine lint-vs-spec conflicts** and were escalated to the user rather than
decided by the implementer (the step's own "If blocked" rule): the four
`CollectionStore` methods dropping `async` (Step 7 had pinned it) and
`e.returnValue = ''` being removed from the `beforeunload` handler (Step 11 had
pinned it). User accepted both; recorded in `Analyst.md` `## Discovered` and
amended into Steps 7 and 11.
The last error — `@typescript-eslint/dot-notation` on `service['persist']()` —
was fixed per the user's choice by exercising `persist()` through the public
`retryFailed()` and asserting the `localStorage` result, with no
`eslint-disable` (L-014) and no lint-config change. No test count change.

**Depends on:** Steps 10–11 — the last code-writing steps.

**Files**
- DO NOT TOUCH: anything except to fix lint/format violations this step reports.

**Context**
L-023: lint and format errors were twice caught only by CI, after a PR was
open. The pre-push hook runs these, so run them here rather than discovering
them at push time.

**Do**
1. Run every command in **Done when**, recording actual numbers.
2. If `format:check` fails, run `npm run format` and re-run. If `lint:ci`
   fails, fix the violations — do **not** add an `eslint-disable` (L-014).
3. Re-confirm Steps 10 and 11's "Done when" lines still hold.

**Done when**
- `npm run test` — server 88, web at the Step 6/10 total, 0 failures
- `npm run build` — both workspaces succeed
- `npm run lint:ci` — clean
- `npm run format:check` — clean
- `git checkout -- data/spanish/` then `git status --short` is free of
  `data/spanish/` entries (L-002)

**If blocked**
If a lint rule and this spec's design genuinely conflict, STOP and report the
rule and the line — do not change the design to satisfy a linter without
saying so.

---

### Step 13 — Verify offline behaviour locally (A1, A2, A6)

**Model:** haiku

**Status:** done — **A1, A2 and A6 all MET.** Fifth run (manual, by the user,
2026-09-18) closed the two gaps the fourth run left. Text deck
`dec724d1698056083` at `http://localhost:3000` (the built bundle, not the 4200
dev server, whose provenance could not be established).

**A1 — MET at n=5.** `revlog.ndjson` **3933 → 3938**, exactly +5, five distinct
ids (`r1789760809470-hbnkbz`, `-6kecde`, `-alvip6`, `-zwkyqe`, `-6x6lss`), all
`type: review`. Card states match the UI: `due 96 / interval 10` for the three
Good-10d answers, `due 95 / interval 9` and `due 107 / interval 21` for the
other two, today being day 86. **The deck `daily` clause is exercised for the
first time** — `{day: 83, reviewStudied: 0}` → `{day: 86, reviewStudied: 5}`,
the stale tally resetting and counting all five. The n=3 run could not reach
this because all three of its cards were relearn steps. Buried cards 12 → 17,
so the five bury ops landed too. Tab was closed while still offline, so this
run re-proves **A2** as well.

**A6 — MET.** Two poison ops (`PATCH /cards/does-not-exist`) seeded by hand.
Both were classified poison on the Step 10 gate's drain, the session **started
normally rather than going `stuck`**, the banner showed "2 reviews could not be
saved" with a Retry button, and two subsequently-answered cards drained straight
past them: `revlog.ndjson` **3938 → 3940**. Failed ops stayed visible with
pending back at 0.

Two observations from the run, neither a queue defect, both written up in
`Analyst.md` `## Discovered`: the banner labels **every** op a "review" (it read
"Saving 15 reviews…" for 5 cards — 5 reviews + 1 daily + 9 buries), and the
repeated `404`s in the console are console accumulation across two
`location.reload()`s, not re-sends — `outbox.service.ts:100-109` moves a poison
op into `failed` and only `retryFailed()` can return it, so each is attempted
exactly once. That matters: a poison op re-fired per drain would eat C-5's
rate-limit budget.

`git checkout -- data/spanish/` run afterwards; tree clean (L-002).

**Prior runs, kept for the defects they found:** first run FOUND A DEFECT, exactly as this step is meant
to.** Observed: `revlog.ndjson` 3923 lines before, **3923 after** — growth of 0,
not 5. Offline behaviour itself was correct (5 cards answered, each advancing
immediately; 6 ops — 5 reviews + 1 bury — persisted in `localStorage`). The
failure was on reconnect: the banner stayed at 6 and no session started.

Root cause (found by reading `outbox.service.ts`, not from the runner's report):
`drain()`'s single-flight guard early-returns when a drain is already in flight
instead of awaiting it, so `await drain()` is a lie. `App`'s constructor fires
`void drain()` at startup; Step 10's gate then `await`s `drain()`, gets an
instant resolve, re-checks `pendingCount()`, still sees 6, and declares
`syncing = 'stuck'` while a healthy drain is running underneath.
**Same anti-pattern as the `load()` self-guard already logged in `Analyst.md`
`## Discovered` — a guard that returns early makes its caller's `await`
meaningless. That is the `L-NNN` candidate for Step 15.**

Note the runner's claim that "no network requests were sent" was NOT evidenced —
it said its network inspection failed. The revlog counts are the real evidence.

**Second run:** Part 1 (regression falsifiability) PASSED — with the old
early-return shape restored, 6 of 11 outbox tests go RED including T11; with the
fix, 11/11, and the file was restored exactly (`git diff --stat` empty). Part 2
BLOCKED by browser automation: stale `localStorage` ops from the aborted first
run could not be cleared, because the `beforeunload` guard (working as designed)
blocks programmatic navigation. Two failed automation attempts → handed to the
user per CLAUDE.md's two-strikes rule.

**Third run — manual, by the user — found the defect both automated runs had
missed.** Offline, the app could not be interacted with at all: `loadNext()`
still does a network READ per card (`store.getNote` → `api.getNote`), so the
loop stalls on the first uncached note. The automation missed it because its
online warm-up had cached the early cards. Fixed (user-approved) by warming the
cache with the existing bulk `store.loadNotes()` at session start; web 263 / 23.
Also established that audio cannot work offline at all without a service worker
(§3: out of scope), so **A1 is amended to text cards only**. Both findings are
written up in `Analyst.md` `## Discovered`, and A1 is amended in §5.
**Fourth run — manual, by the user — found a SECOND defect, then produced A2's
evidence.** After an offline session the user's `localStorage` held 5 ops
(3 reviews + 2 buries) with **`attempts: 0` on every one** and `failed: []`.
Since `attempts` is incremented in `drain()`'s `catch`, zero attempts proves no
delivery was ever attempted *or classified*: a hung request (Angular
`HttpClient` has no default timeout) left `drainPromise` non-null forever and
every later `drain()` coalesced onto the dead promise. Fixed with an rxjs
`timeout(REQUEST_TIMEOUT_MS = 15_000)`, classified `'retry'` via the existing
`classify(null)` path; web 266 / 23, falsifiability confirmed (T12 goes RED
without the operator). See `Analyst.md` `## Discovered`.

**A2 — MET, with evidence.** Those 5 ops had survived the network outage AND a
tab close. After the fix and a reload they drained: `revlog.ndjson` 3924 → 3927,
the 3 queued review ids (`r1789753978991-6z73hv`, `r1789753994380-bvh3i4`,
`r1789754007730-ogog6t`) each appearing **exactly once** (4 new ids, 4 distinct),
and both bury ops applied (`ca5a150488dcdfde3-1`, `c9ee0fe1988042ebe-1` →
`schedBuried`). Nothing was lost.

**A1 — PARTIAL, at n=3 not n=5.** The substance held (3 offline reviews landed
exactly once, correct `due`/`interval`), but the criterion says 5 and the run
did 3, so it is not recorded as fully met (L-025: do not claim a sample size
that was not run). The deck-`daily` clause was **not** exercised: all three were
relearn steps, and `studiedKind()` deliberately returns `null` for
learning/relearning, so no `daily-` op should exist. Exercising that clause
needs a new or review card.

**A6 — UNMET.** The poison path was never exercised: automation was blocked and
the manual runs did not reach it.

**Depends on:** Step 12 — a green build is a precondition for believing anything this step observes.

**Files**
- DO NOT TOUCH: any source file. This step **observes**; if it finds a defect, it reports and stops.

**Context**
Acceptance criteria A1, A2 and A6. Note precisely what A2 does and does not
claim (critic C-10): there is no service worker, so the tab **cannot be
reloaded while offline** — an offline reload is a browser error page. The
testable claim is: kill the tab offline, reconnect, load, and the ops are still
there and drain.
Record the **observed** numbers, not the expected ones. `revlog.ndjson` is the
ground truth, not the UI (L-025 — a claim in a document is not evidence).

**Do**
1. `npm run dev`. Note the current line count:
   `wc -l < data/spanish/revlog.ndjson`.
2. Start a session at `/study/all`. DevTools → Network → **Offline**.
3. Answer **5** cards. Confirm each advances immediately (no stall) and the
   shell banner count climbs to 5.
4. Close the tab while still offline. Reopen DevTools → **Online**, load the
   app, and watch the banner drain to zero.
5. `wc -l < data/spanish/revlog.ndjson` — assert it grew by **exactly 5**, and
   that the 5 new `id`s are distinct (`tail -5 … | jq -r .id | sort -u | wc -l`
   is 5).
6. Confirm the 5 cards' `due`/`interval` in `cards.json` match what the UI
   showed, and the deck's `daily` tally advanced.
7. **A6 (poison)** — with the app loaded, enqueue a deliberately bad op by hand
   in the console: a `PATCH` to `/cards/does-not-exist`. Confirm it lands in
   `failed`, the banner shows the error state, and a subsequently-answered card
   still drains past it.
8. Write the observed numbers into this step's `Status:` line.

**Done when**
- `revlog.ndjson` grew by exactly 5 across the offline→online cycle, with 5
  distinct ids — quote the before/after counts
- The banner reached 5 while offline and 0 after reconnect
- The poison op sat in `failed` while a later op drained past it
- `git checkout -- data/spanish/` afterwards, so the local run does not dirty
  the tree (L-002)

**If blocked**
If any count is off by even one, STOP and report the exact numbers. An extra
line means the dedupe is not reached; a missing line means an op was dropped.
Both are the failure this whole spec exists to prevent — do not proceed to
Step 14.

---

### Step 14 — Verify on the phone against production (A8)

**Model:** top-level

**Status:** done — **A8 MET at n=5.** User deployed (version 4, then version 5
after a restart; `hardened: true`, health passing) and ran an airplane-mode
session on the phone against `https://spanish-srs.fly.dev`, text deck
`dec724d1698056083`.

**Cards actually answered: 5.** The user reported "between 4-5"; the live
revlog settled it at 5, and 5 is what is recorded (L-025 — the count comes from
ground truth, not from the operator's recollection or the rounder number).

Evidence, live state pulled with `tools/pull-fly-state.sh` before and after:
- `revlog.ndjson` **3923 → 3928**, exactly +5, five distinct ids
  (`r1789763456730-9sxiz1`, `-cmbpsv`, `-fjch3z`, `-kc7mf5`, `-mq4bp1`)
- **No id appears more than once anywhere in all 3 928 live lines** — the
  strongest form of the A3/dedupe claim, checked against the whole file rather
  than just the new tail
- Card states arithmetically correct for day 86: three relearn steps at
  `due 87 / interval 1`, two reviews at `due 95 / interval 9` and
  `due 107 / interval 21`
- `schedBuried` 4 → 9, so the five bury ops applied
- Text deck `daily` `{day: 83, reviewStudied: 79}` → `{day: 86, reviewStudied: 2}`
  — the stale tally reset, and **2, not 5, is correct**: `studiedKind()` returns
  `null` for learning/relearning, so only the two genuine `review`-type cards
  count. An independent cross-check that the `daily-` op carried the right
  payload.
- No card was re-served after reconnecting; the banner drained to zero.

The banner read **12** for 5 cards (5 reviews + 1 daily + 6 buries) — the
wording defect recorded in `Analyst.md` `## Discovered`, not lost work.

⚠️ **The run was blocked first time by a production rate-limit lockout** — the
phone got "Too many requests, please try again later" with no way in, because
the tier-1 limiter counts 401 auth challenges and sits before `basicAuth`.
Cleared with `fly apps restart spanish-srs` (in-memory limiter store). This is
pre-existing, but it interacts badly with the outbox's 60 s backoff cap; written
up in full in `Analyst.md` `## Discovered`. Not fixed here (scope).

**Depends on:** Step 13 — do not deploy a build whose offline behaviour has not been observed locally.

**Files**
- DO NOT TOUCH: any source file.

**Context**
A8, and the roadmap's own Phase 3 acceptance ("verify by doing it"). This is
`top-level` **not** because it edits a spec doc but because it requires the
user: it needs a physical phone, airplane mode, and a `fly deploy` — none of
which a subagent can perform. The top-level session coordinates and the user
acts.
Ground truth is the **live** revlog, pulled with `tools/pull-fly-state.sh` —
not the phone's UI (L-025). Phase 1 Step 21 is the precedent for how this was
run before.

**Do**
1. Ask the user to confirm before deploying — this is a production deploy of an
   unmerged branch and is their call.
2. Record the live revlog line count first (`tools/pull-fly-state.sh`, then
   `wc -l`).
3. User: `fly deploy`, open `https://spanish-srs.fly.dev` on the phone, start a
   session, enable **airplane mode**, answer several cards (record how many),
   disable airplane mode, watch the banner drain.
4. Pull the live state again and assert the revlog grew by **exactly** the
   number answered, with distinct ids.
5. Note explicitly in the `Status:` line how many cards were actually answered.
   Phase 1's "200-card session" was reduced to 12 and the roadmap still carries
   that caveat — do not repeat the pattern of a spec claiming a sample size it
   did not run (L-025).

**Done when**
- The live `revlog.ndjson` grew by exactly the number of cards answered offline
- No card was re-served after reconnecting
- The observed count is written into `Status:`, with no rounding up

**If blocked**
If the user declines the deploy, mark this step `not started`, say so plainly
in the wrap-up, and do **not** mark A8 met. An unrun acceptance criterion is
unmet, not waived.

---

### Step 17 — Fix the offline re-entry gate hang (A5)

**Model:** sonnet

**Status:** done — **A5 MET**, confirmed by manual repro at `localhost:3000`
2026-10-11 (see "Second bug" below for the fix that actually closed it).

**What was fixed (first pass).** Two changes, both gates green when re-run
independently by the top-level session: server 88/14 unchanged, web
**267/23** (+1 = T15), `npm run build` exit 0, `lint:ci` and `format:check`
clean, nothing under `data/spanish/`.
1. `outbox.service.ts` — `drain()`'s coalescing branch re-invoked `this.drain()`
   the instant the in-flight run settled, **bypassing the backoff that run had
   just scheduled**. Against a *stalled* network each bypassed attempt stalls
   for another full `REQUEST_TIMEOUT_MS`, so a caller coalesced onto that
   promise — exactly `Review.init()`'s `await this.outbox.drain()` on re-entry —
   never settles in bounded time. Fixed by adding `&& this.status() !== 'waiting'`
   to the re-trigger condition, so it only re-fires when the prior run exited
   because the queue genuinely emptied.
2. `review.html` — the `syncing()` branches now precede `@if (loading())`, so
   "Syncing N unsaved reviews…" and "N reviews not yet saved — reconnect to
   continue" are reachable. Verified by reading the diff.

**Falsifiability (T15) — reported by the implementer, NOT independently
re-verified.** Claimed: fails against the unfixed service (`settled` still
`false` at t=15 100 ms, `send` called twice), passes after.

⚠️ **This first fix did not explain the symptom the user originally hit** —
flagged honestly at the time rather than claimed as done. That open question
turned out to be correct caution: a manual re-verification pass surfaced a
**second, independent bug**, below, which is what was actually causing the
hang.

**Second bug — found by instrumented manual re-verification, 2026-10-11.**
Re-running the exact repro (clear `localStorage.srs.outbox.v1`, deck
`dec724d1698056083`, offline, answer one card, ← Decks, re-enter) against the
first fix still hung: offline it sat on "Syncing N unsaved reviews…"
indefinitely (never flipped to "stuck"), and after going back online it stayed
on "Syncing 0 unsaved reviews…" forever despite the queue having actually
emptied in the background. Temporary `[A5-DEBUG]` console logging (added and
later fully removed — `grep -rn "A5-DEBUG" web server` returns no hits) caught
it directly in the browser console:
```
ERROR TypeError: Cannot read properties of undefined (reading 'init')
    at get (main-OW6GDSQV.js:5:429)
    at e.getRetryDelay (main-OW6GDSQV.js:5:23581)
    at e._runDrain (main-OW6GDSQV.js:5:22608)
```
Root cause: `getRetryDelay()` extracted `headers?.['get']` into a standalone
variable, then called it as `getMethod?.('Retry-After')` — detached from its
`this`. Angular's `HttpHeaders.get()` internally calls `this.init()`, so a
detached call throws. This only reproduces against a **real** `HttpHeaders`
instance (which a genuine network failure's `HttpErrorResponse` carries, even
at status 0); every existing test mocked `headers` as a plain object, so none
of them exercised the real method and the bug shipped invisibly. Because this
throws synchronously inside `_runDrain()`'s `catch` block, nothing catches
it — `_runDrain()`'s promise **rejects** instead of resolving, which
propagates straight through `Review.init()`'s unguarded
`await this.outbox.drain()`. Execution never reaches the code that sets
`syncing` to `'stuck'` (or back to `'no'`), so the component is wedged
regardless of what the queue does in the background afterwards. This fully
explains both halves of the original `attempts: 0` mystery left open above:
the very first retry attempt throws before `attempts` is ever persisted.

Fix: call `.get` directly on `headers` in one chained expression
(`headers?.get?.('Retry-After')`) so `this` stays bound — no behaviour change
beyond no longer crashing.

**Falsifiability (T16), independently re-verified by the top-level session:**
`npm run test -w web` — 268/23, 0 failures. New case "a retryable error
carrying a real HttpHeaders instance does not crash the retry path" uses
`new HttpErrorResponse({ status: 0, headers: new HttpHeaders() })`. Reported
red-before (`TypeError: Cannot read properties of undefined (reading 'init')`,
same signature as the browser) / green-after by the implementer; re-run
independently by the top-level session on the fixed code — green, 268/268.
`npm run build -w web`, `npm run lint:ci`, `npm run format:check` — all clean,
independently re-run.

**Manual end-to-end re-verification (user, 2026-10-11), clean build, no debug
logging:**
- Answered one card offline → session continued normally to the next card
  (2 of 299), shell banner correctly read "2 reviews not yet saved — will
  retry" (the known "banner labels every op a review" wording quirk, not a
  defect — `Analyst.md` `## Discovered`).
- Clicked ← Decks, re-entered the deck while still offline → showed "N reviews
  not yet saved — reconnect to continue" with **no rating buttons**, and
  stayed there for as long as the network stayed offline. That persistence is
  correct: there is nothing to recover to while genuinely offline.
- Switched back online → recovered automatically and served a new card that
  was **not** the one already answered offline (C-2 preserved).

A5 is MET. The original "Loading…" infinite hang does not recur.

**Depends on:** Steps 10, 11 — this repairs the gate they built. Step 15 is
blocked on it: A5 cannot be met until this lands.

**Files**
- MODIFY `web/src/app/core/outbox/outbox.service.ts`
- MODIFY `web/src/app/core/outbox/outbox.service.spec.ts`
- MODIFY `web/src/app/features/review/review.html`
- MODIFY `web/src/app/features/review/review.ts` — only if the fix requires it; prefer fixing the service
- DO NOT TOUCH: `server/`, `collection.store.ts`, `app.ts`, `core/scheduling/`

**Context — the observed defect**
Reproduce exactly: `http://localhost:3000` (server runs `hardened: false`, no
auth, no rate limiter), text deck `dec724d1698056083`. Clear
`localStorage.srs.outbox.v1`. Enter the deck, wait for a card, DevTools →
Network → **Offline**, answer **one** card, click **← Decks**, click the deck
again. Observed: the screen sits on **"Loading…" indefinitely**. It never shows
the `stuck` message and never recovers.

Measured in the browser at that moment (user, 2026-09-18):
- `localStorage.srs.outbox.v1` → `ops: 2, failed: 0, attempts: [0, 0]`
- Exactly **one** failed `POST /api/review` in the whole Network log — the one
  from answering the card
- **No new request at all** when re-entering the deck

**Two bugs are stacked here. Fix both.**

1. **The drain never settles.** `Review.init()` awaits `this.outbox.drain()`
   (`review.ts:179`) and that promise does not resolve, so `loading` is never
   cleared. `attempts: 0` is the key evidence: **every** path through
   `_runDrain`'s `catch` increments `attempts` before doing anything else —
   whether the error is an `HttpErrorResponse` with `status: 0` or an rxjs
   `TimeoutError` with no status — so `attempts: 0` proves the `catch` never
   ran, i.e. `lastValueFrom` neither resolved nor rejected.
2. **The template shadows the draining message.** `review.html:6-10` tests
   `@if (loading())` **before** `@else if (syncing() === 'draining')`, and
   `loading` is initialised `true` (`review.ts:72`). So the "Syncing N unsaved
   reviews…" branch is unreachable — the user sees the generic "Loading…".
   The `stuck` branch escapes only because `review.ts:183` sets
   `loading.set(false)` before returning.

**Already ruled out — do not re-investigate:**
- `classify()` is correct. `classify(0)` → `'retry'` (`outbox-ops.ts:19-24`).
- The `drain()` coalescing branch is not inherently broken. A scratch
  reproduction (two ops, `send` returning `throwError(() => ({ status: 0 }))`,
  then `await drain()` raced against a 3 s hang detector) **settled correctly**
  and passed. A synchronous fail-fast mock does not reproduce this.

**Check this first — it may be most of the answer.** `REQUEST_TIMEOUT_MS` is
15 000 ms. It was never established whether the user waited a full 15 s before
reading `attempts`. If the `timeout()` does eventually fire, the hang is
bounded at 15 s and the real defects are (a) 15 s of bare "Loading…" with no
feedback and (b) bug 2 above. If it does **not** fire, the `timeout()` operator
is not covering this path and that is the primary bug. **Establish which,
by measurement, before changing anything**, and write the answer into
`Status:`.

**Do**
1. Reproduce in a real browser and determine whether the hang is bounded at
   15 s or unbounded. Record the observed wall-clock time.
2. Write a **failing** spec case first, reproducing a *stalled* network — an
   observable that never emits, errors or completes (`NEVER`, already imported
   in `outbox.service.spec.ts`), **not** a fail-fast `throwError`. Assert that
   `await drain()` settles and that `attempts` increments. This is the gap that
   let the defect through: every existing case mocks clean, synchronous
   failure. See `Analyst.md` `## Discovered` — the same lesson already fired
   once in Step 13 run 4.
3. Fix the service so `drain()` always settles in bounded time under a stalled
   network, and so a stalled op is classified and counted like any other
   retryable failure.
4. Fix the template ordering so `syncing() === 'draining'` and
   `syncing() === 'stuck'` are reachable while `loading()` is true. Simplest
   correct shape: test the `syncing` branches **before** `loading()`.
5. Re-verify A5 by hand at `localhost:3000` using the repro above: confirm
   "Syncing N unsaved reviews…" appears during the drain, then
   "N reviews not yet saved — reconnect to continue" with **no rating
   buttons**, and that going back Online and re-entering the deck recovers and
   serves a card that is **not** one already answered (the C-2 check).

**Done when**
- The new stalled-network spec case fails against the unfixed service and
  passes after the fix — state both results explicitly in `Status:` (L-024,
  L-006: an assertion that cannot fail is not coverage)
- `npm run test -w web` — 266 + N, 0 failures (state N)
- `npm run test -w server` — 88, unchanged
- `npm run build` — both workspaces succeed
- `npm run lint:ci` and `npm run format:check` — clean
- Manual: the draining message and the stuck message both render, verified by
  eye; recovery serves an unanswered card
- `git checkout -- data/spanish/` afterwards (L-002)

**If blocked**
If the cause cannot be established by measurement within two attempts, STOP and
report what was measured — do not apply a speculative fix. Three hypotheses
have already died here (`classify`, the coalescing branch, and a fail-fast unit
repro); a fourth guess is worth less than a clean measurement.

---

### Step 15 — Regression + wrap-up

**Model:** top-level

**Status:** done — all A1–A8 MET, evidence recorded in `Analyst.md` §5.
`AD-029` and `L-028`/`L-029` written to `specs/STATE.md` (after the user ran
`tools/state_rotate.py --apply` to make room — 327 → 299 lines, AD-001–004
moved to `STATE-ARCHIVE.md`); bodies in `specs/LESSONS.md`. Three out-of-scope
findings moved to `specs/BACKLOG.md` (banner wording, rate-limiter/backoff
interaction, `CollectionStore.load()`'s self-guard). Roadmap Phase 3's four
boxes already ticked from an earlier pass; amended the third one with the
Step 17 second-bug finding and final verification date. Full gate re-run
2026-10-11: server 88/14, web 268/23, 0 failures; `npm run build`,
`lint:ci`, `format:check` all clean; `state_rotate.py --check` passes
(299/300); `git status` clean under `data/spanish/`. **Not committed —
awaiting the user's go-ahead**, per this step's own rule.

**Depends on:** Steps 1–14 — walks their acceptance criteria.

**Files**
- MODIFY `specs/023-review-outbox/Analyst.md` — the `## Retrospective` section
- MODIFY `specs/STATE.md` — new `AD-029` (and any `L-NNN` headline earned)
- MODIFY `specs/LESSONS.md` — the body of any `L-NNN` added above
- MODIFY `specs/011-mobile-remote-access/ROADMAP.md` — tick Phase 3's four boxes
- MODIFY `.claude/skills/scheduling-domain/SKILL.md` — only if a *domain* gotcha was found (AD-009)
- DO NOT TOUCH: any source file. If this step finds a code defect, report it; do not fix it here.

**Context**
`CLAUDE.md`'s end-of-feature ritual, steps 1–2. Next free numbers, verified
2026-09-18: **AD-029** and **L-028**.

⚠️ **`specs/STATE.md` is already at its budget — read this before writing a
word into it.** Measured 2026-09-18: `python3 tools/state_rotate.py --check`
reports "300 lines, budget 300 — ok". It passes *now* and will fail the moment
this step adds `AD-029`, and gate 4 runs on **every** push, so the wrap-up
would be blocked at the end with the work already done. Rotation is not this
step's to perform: `CLAUDE.md` is explicit that `--apply` "is run by a human
who has decided to rotate; no hook ever runs it for you."
**So: check the budget FIRST, before editing `specs/STATE.md`.** If adding
`AD-029` would exceed it, stop and ask the user to run
`python3 tools/state_rotate.py --apply`, then continue. Do not silently trim
someone else's entries to make room. `specs/STATE.md` is append-only and never
renumbered. An `L-NNN` needs **both** a headline in `STATE.md` and a body in
`specs/LESSONS.md` or the pre-push gate refuses the push.
AD-009's split: a *process* lesson is an `L-NNN` pair; a *domain* gotcha that
belongs next to the rules it qualifies is appended, dated, to the matching
skill's `## Lessons (auto-appended)` section instead.

**Do**
1. Walk **A1–A8** in `Analyst.md` one by one and record met/unmet with the
   evidence — the actual command output or observed count, not a restatement.
   Any criterion not actually exercised is **unmet**.
2. **Before editing `specs/STATE.md`**, run `python3 tools/state_rotate.py --check`
   and confirm there is room for the new entry. If not, ask the user to rotate
   (see Context) and wait.
3. Write `AD-029` in `specs/STATE.md`: the outbox design, and specifically the
   two decisions a future reader would otherwise re-derive — that `localStorage`
   was chosen over IndexedDB *for its synchronous write*, and that FIFO
   ordering is a correctness requirement because ops carry absolute card state.
4. Add an `L-NNN` pair only if something generalises beyond this feature.
   C-2 (a gate evaluated after an unconditional startup load is no gate) and
   C-10 (an acceptance criterion that cannot be executed) are both candidates;
   judge, do not add both reflexively.
5. Fill in the `## Retrospective` in `Analyst.md`: what `Analyst.md` caught up
   front, and what in `tasks.md` turned out wrong during coding.
6. Tick Phase 3's four checkboxes in the roadmap, **only** those actually done,
   each with a one-line note of the evidence.
7. Report the state of the tree and **ask the user before committing anything**.

**Done when**
- Every one of A1–A8 has an explicit met/unmet verdict with evidence
- `specs/STATE.md` contains `AD-029`; every `L-NNN` added has a body in `specs/LESSONS.md`
- `bash scripts/clean-table-check.sh` passes
- `python3 tools/state_rotate.py --check` passes (`specs/STATE.md` is within its ~300-line budget)
- `git status --short` shows no `data/spanish/` entries
- **Do not commit — ask the user first.**

**If blocked**
If `state_rotate.py --check` reports `specs/STATE.md` over budget, report it and
stop. Rotation (`--apply`) is run by a human who has decided to rotate; no
step here runs it.

---

### Step 16 — Archive

**Model:** top-level

**Status:** not started

**Depends on:** Step 15 — and on the user's explicit go-ahead.

**Files**
- MOVE `specs/023-review-outbox/` → `specs/archive/2026-XX-XX-023-review-outbox/`
- DO NOT TOUCH: any source file.

**Context**
`CLAUDE.md` ritual steps 3–4. Step 3 is the one people skip: **summarize the
spec down to what matters** — the final `Analyst.md`, the decisions, and what
changed from the plan. Delete drafts and long back-and-forth. The pre-push gate
blocks any newly archived file over 20 KB with "Summarize this spec before
archiving", and blocks an archive push with no matching `specs/STATE.md` change.

**Do**
1. Confirm the user has approved archiving.
2. Summarize `CriticReview.md` down to the findings that changed the design
   (C-1, C-2, C-5, C-10) and their outcomes; drop the confirmations that
   changed nothing.
3. `python3 tools/archive_spec.py specs/023-review-outbox` (dry run), read the
   plan, then `--apply`.
4. Push the archive move and the `specs/STATE.md` update **together** — the
   gate requires it.

**Done when**
- `bash scripts/clean-table-check.sh` passes
- No file under the new archive dir exceeds 20 KB
- `git push` succeeds without `--no-verify`

**If blocked**
If the gate rejects the push, read its message and fix the cause. Never reach
for `--no-verify` — it is a reminder for the honest case, and bypassing it is
exactly the dishonest one.
