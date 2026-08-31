# tasks — Phase 2: `core/scheduling/` and adjacent state

**14 steps, in order, do not skip ahead.** Every step ends at a green build.

Read `.claude/skills/scheduling-domain` before Steps 3, 4, 8 and 11. The
invariants that matter throughout: `card.due` is overloaded by queue (position
/ epoch-ms / day-number), `ease` is permille, day numbers come from
`todayNumber()` and honour `dayCutoffHour`, and both SM-2 and FSRS state live
on every card. **No edit in this spec may change any of them.**

Two standing rules for every step:

- **If a count does not match what the step predicts, STOP and report it.**
  Do not adjust the number and continue. Phase 1 found this instruction was
  worth more than any check in the file.
- **Never run `eslint --fix` unattended.** Roadmap Phase 2, bullet 3. Every
  edit in this phase is made by hand and read before it is kept.

Baseline, measured 2026-08-31 in a worktree with `node_modules` installed:
`web/src` **24** violations in 7 files, `server/src` **41**, tests **280**
(71 server + 209 web).

---

### Step 1 — Re-measure the baseline and confirm it before touching anything

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 24 across the 7 named files, `server/src` 41, `npm run test` 71 + 209)

**Files**
- DO NOT TOUCH: anything. This step only measures.

**Context**
Type-aware lint counts taken in a tree without `node_modules` are silently low,
not an error — they are well-formed, reproducible and wrong (L-013). Every
number in this spec assumes dependencies are installed. Establish that first or
every later count is meaningless.

**Do**
1. Run `npm install` at the repo root if `node_modules/` is absent.
2. Run `npx eslint web/src` and count the violations.
3. Run `npx eslint server/src` and count the violations.
4. Run `npm run test`.

**Done when**
- `npx eslint web/src` reports exactly **24 problems** across exactly these 7
  files: `core/pause.service.spec.ts` (13), `core/pause.service.ts` (4),
  `core/collection.store.ts` (3), `core/scheduling/scheduler-factory.ts` (1),
  `core/scheduling/sm2.spec.ts` (1), `core/pause-shift.ts` (1),
  `core/heatmap.spec.ts` (1).
- `npx eslint server/src` reports exactly **41 problems**.
- `npm run test` → **71 passed** (server) and **209 passed** (web).

**If blocked**
If `web/src` is not 24 or `server/src` is not 41, STOP and report both numbers.
Either `node_modules` is missing (re-run `npm install` and re-measure) or the
branch is not at `origin/main` @ `1e44401`. Do not proceed on different numbers.

---

### Step 2 — Three self-contained syntactic fixes in test files

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 20 problems, the two named files exit 0, `npm run test -w web` 209 passed; diff limited to the 3 declared test files)

**Depends on:** Step 1 — the confirmed baseline these counts subtract from.

**Files**
- MODIFY `web/src/app/core/scheduling/sm2.spec.ts` — anchor: `const cases: Array<{ subject: Card; options: DeckOptions; stepCount: number }> = [` (~line 266)
- MODIFY `web/src/app/core/heatmap.spec.ts` — anchor: `const reviewTimestamps = Array(12).fill(` (~line 68)
- MODIFY `web/src/app/core/pause.service.spec.ts` — anchor: `beforeEach(() => localStorage.clear());` (~line 61)
- DO NOT TOUCH: any non-test file. No production code changes in this step.

**Context**
Three unrelated violations that happen to share "purely syntactic, no
scheduling semantics". Grouped so the interesting steps stay uncluttered. None
of these changes what any test asserts.

**Do**
1. In `sm2.spec.ts`, change the `cases` annotation from `Array<{...}>` to
   `{ subject: Card; options: DeckOptions; stepCount: number }[]`. The array
   literal below it is unchanged.
2. In `heatmap.spec.ts`, replace the single line
   `const reviewTimestamps = Array(12).fill(new Date(2024, 0, 1, 12).getTime());`
   with exactly these two lines (`Array(n).fill(x)` is typed `any[]`;
   `Array.from` infers `number[]`):
   ```ts
   const jan1Noon = new Date(2024, 0, 1, 12).getTime();
   const reviewTimestamps = Array.from({ length: 12 }, () => jan1Noon);
   ```
3. In `pause.service.spec.ts`, give both the `beforeEach` and `afterEach`
   arrows braces:
   ```ts
   beforeEach(() => {
     localStorage.clear();
   });
   afterEach(() => {
     localStorage.clear();
   });
   ```

**Done when**
- `npx eslint web/src` reports **20 problems** (was 24).
- `npx eslint web/src/app/core/scheduling/sm2.spec.ts web/src/app/core/heatmap.spec.ts` → exit 0.
- `npm run test -w web` → **209 passed**.

**If blocked**
If `web/src` is not exactly 20, STOP and report which file still reports.

---

### Step 3 — Replace both `Map.has()` + `Map.get()!` pairs with one lookup

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 18 problems, `grep 'get(c.id)!'` returns nothing, `npm run test -w web` 209 passed; diff limited to the 2 declared files, both guards preserved)

**Depends on:** Step 2 — runs on the 20-violation tree it leaves.

**Files**
- MODIFY `web/src/app/core/collection.store.ts` — anchor: `private setQueues(updates: Map<string, Card['queue']>): void {` (~line 225)
- MODIFY `web/src/app/core/pause.service.ts` — anchor: `const byId = new Map(payload.cardUpdates.map((u) => [u.id, u.due]));` (~line 90)
- DO NOT TOUCH: `pause-shift.ts` (Step 8 owns it), any `*.spec.ts`.

**Context**
Both sites mirror a just-persisted server write into the cached cards, and both
use `has()` to prove `get()` is safe, then assert it with `!`. The Map's value
type never includes `undefined` in either case (`Card['queue']`, `number`), so
one `get()` compared against `undefined` is exactly equivalent and needs no
assertion. Read `.claude/skills/scheduling-domain` first: `pause.service.ts`'s
map carries `card.due` values, so a wrong edit here silently corrupts
scheduling.

**Do**
1. In `collection.store.ts`, replace the body of `setQueues` with:
   ```ts
   this.cards.update((cards) =>
     cards.map((c) => {
       const queue = updates.get(c.id);
       return queue === undefined ? c : { ...c, queue };
     }),
   );
   ```
2. In `pause.service.ts`, replace the `this.store.cards.update(...)` call inside
   `applyResume` with:
   ```ts
   this.store.cards.update((cards) =>
     cards.map((c) => {
       const due = byId.get(c.id);
       return due === undefined ? c : { ...c, due };
     }),
   );
   ```
   Leave the `if (payload.cardUpdates.length) {` guard and the `byId`
   construction above it exactly as they are.

**Done when**
- `npx eslint web/src` reports **18 problems** (was 20).
- `grep -n '!' web/src/app/core/collection.store.ts | grep -c 'get(c.id)!'` → `0`.
- `npm run test -w web` → **209 passed**.

**If blocked**
If either file's violation count did not drop by exactly 1, STOP and report.
Do not add a `!` back or an `eslint-disable` — Analyst.md D1 forbids both.

---

### Step 4 — Make `defaultDeckOptions()`'s fallback explicit

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 16 problems, `collection.store.ts` exits 0, `npm run test -w web` 209 passed)

**Depends on:** Step 3 — the same file, edited in a different method.

**Files**
- MODIFY `web/src/app/core/collection.store.ts` — anchor: `defaultDeckOptions(): DeckOptions | undefined {` (~line 206)
- DO NOT TOUCH: anything else.

**Context**
`return (id && this.deckOptionsById(id)) || this.deckOptions()[0];` carries two
violations: `strict-boolean-expressions` on the nullable-string `id`, and
`prefer-nullish-coalescing` on the `||`. The rewrite is exactly equivalent,
including for `id === ''`: no options group has the id `''`, so
`deckOptionsById('')` returns `undefined` either way, and both forms fall
through to position 0. Verified in CriticReview R3 — it introduces no
`no-unnecessary-condition`.

**Do**
1. Replace that one `return` line with:
   ```ts
   return (id != null ? this.deckOptionsById(id) : undefined) ?? this.deckOptions()[0];
   ```
2. Leave the JSDoc above it unchanged — it already describes this behaviour
   correctly.

**Done when**
- `npx eslint web/src` reports **16 problems** (was 18).
- `npx eslint web/src/app/core/collection.store.ts` → exit 0 (this file is now clean).
- `npm run test -w web` → **209 passed**.

---

### Step 5 — Checkpoint

**Model:** haiku

**Status:** done (2026-08-31, build exit 0, 71 + 209 tests, `web/src` 16, `server/src` 41, `format:check` clean, 5 source files modified as declared)

**Depends on:** Steps 2–4 — re-confirms their Done whens against the tree, not
against their reports.

**Files**
- DO NOT TOUCH: anything. No new code in this step.

**Context**
Cheap drift check before the four structural steps. Phase 1 found four separate
cases of an executor reporting all checks green over work that was wrong, every
one caught by re-deriving the artifact rather than re-reading the report.

**Do**
1. Run `npm run build`.
2. Run `npm run test`.
3. Run `npx eslint web/src` and `npx eslint server/src`.
4. Run `npm run format:check`.
5. Run `git diff --name-only main..HEAD`.

**Done when**
- `npm run build` → exit 0.
- `npm run test` → **71 passed** (server) and **209 passed** (web).
- `npx eslint web/src` → **16 problems**; `npx eslint server/src` → **41 problems**.
- `npm run format:check` → exit 0.
- `git diff --name-only main..HEAD` lists **only** these four files (plus
  `specs/018-lint-phase2-scheduling/*`): `web/src/app/core/collection.store.ts`,
  `web/src/app/core/heatmap.spec.ts`, `web/src/app/core/pause.service.spec.ts`,
  `web/src/app/core/pause.service.ts`, `web/src/app/core/scheduling/sm2.spec.ts`.

**If blocked**
If `server/src` is not still 41, a calibration change has leaked into Phase 3's
surface — STOP and report. Analyst.md D1 changes no rule.

---

### Step 6 — `SchedulerFactory` becomes a plain exported function

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 15 problems, `grep SchedulerFactory` returns nothing repo-wide, `schedulerFor` 4 lines, build exit 0, 209 tests)

**Depends on:** Step 5 — starts from the verified 16-violation tree.

**Files**
- MODIFY `web/src/app/core/scheduling/scheduler-factory.ts` — anchor: `export class SchedulerFactory {`
- MODIFY `web/src/app/features/review/review.ts` — anchors: `import { SchedulerFactory }` (~line 17), `SchedulerFactory.for(opts).preview(` (~line 218), `SchedulerFactory.for(opts).answer(` (~line 271)
- DO NOT TOUCH: `scheduling/sm2.ts`, `scheduling/fsrs.ts`, `scheduling/types.ts`. The strategy classes and the `Scheduler` interface are unchanged. Do **not** rename the file.

**Context**
`no-extraneous-class` fires on a class whose only member is a static method,
and here it is pointing straight at a deviation from this repo's own documented
idiom — `.claude/skills/angular-conventions`, "Pure logic first: anything
algorithmic (limits, search, stats, **scheduling**, templating) is a plain
exported function in `core/*.ts`". The module-level `sm2` / `fsrs` singletons
stay exactly as they are, so the dispatch keeps returning the same two shared
instances it returns today.

`review.ts` is the only consumer in the whole repo — verified,
4 grep hits total. It is a Phase 1 file, already clean and already gated; this
is the one edit in Phase 2 that reaches outside the Phase 2 file list, and it
is a rename at two call sites.

**Do**
1. In `scheduler-factory.ts`, replace the class with a function, keeping the
   doc comment and both `const` singletons above it:
   ```ts
   /** Returns the scheduler strategy selected by the deck options. */
   export function schedulerFor(opts: DeckOptions): Scheduler {
     switch (opts.scheduler) {
       case 'fsrs':
         return fsrs;
       case 'sm2':
       default:
         return sm2;
     }
   }
   ```
2. In `review.ts`, change the import to
   `import { schedulerFor } from '../../core/scheduling/scheduler-factory';`
   and both call sites from `SchedulerFactory.for(opts)` to `schedulerFor(opts)`.

**Done when**
- `npx eslint web/src` reports **15 problems** (was 16).
- `grep -rn "SchedulerFactory" web/src server/src` returns **nothing**.
- `grep -rn "schedulerFor" web/src` returns exactly 3 hits (1 declaration,
  1 import, 2 calls → 4 lines; accept 4).
- `npm run build` → exit 0 and `npm run test -w web` → **209 passed**.

**If blocked**
If `grep -rn "SchedulerFactory"` still finds a hit outside the two files above,
STOP and report it — an unexpected consumer means this rename is not the small
change the plan assumed.

---

### Step 7 — Optional chains and a template literal in `pause.service.ts`

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 12 problems, `pause.service.ts` exits 0, the `pause()` `!= null` guard still exactly 1 hit, 209 tests)

**Depends on:** Step 3 — same file; that step's `applyResume` edit must already
be in place.

**Files**
- MODIFY `web/src/app/core/pause.service.ts` — anchors: `async resume(): Promise<void> {` (~line 45), `async recoverOnLoad(): Promise<void> {` (~line 66), `private storageKey(pausedAt: number): string {` (~line 99)
- DO NOT TOUCH: `pause-shift.ts` (Step 8), `pause.service.spec.ts` (Step 9).

**Context**
Three violations, all behaviour-preserving. The optional-chain rewrites are the
subtle ones: `coll?.pausedAt == null` is true when `coll` is nullish *and* when
`pausedAt` is nullish, which is exactly what `!coll || coll.pausedAt == null`
meant. CriticReview R1 confirmed by compiling it that TypeScript still narrows
`coll` to non-nullish afterwards, so the lines below still typecheck.

**Note the one that is NOT flagged:** `pause()`'s guard at ~line 35 is
`if (!coll || coll.pausedAt != null) return;` — a different shape (`!=`, not
`==`), not reported, and **not** expressible as the same optional chain. Leave
it exactly as it is. Rewriting it would invert the pause guard.

**Do**
1. In `resume()`, change `if (!coll || coll.pausedAt == null) return;` to
   `if (coll?.pausedAt == null) return;`. Leave the `const pausedAt = coll.pausedAt;`
   line below it unchanged.
2. In `recoverOnLoad()`, make the same change to its
   `if (!coll || coll.pausedAt == null) return;`.
3. In `storageKey()`, change `return KEY_PREFIX + pausedAt;` to
   ``return `${KEY_PREFIX}${pausedAt}`;``. (Legal under the `allowNumber: true`
   calibration in `eslint.config.mjs`; the coercion is identical.)

**Done when**
- `npx eslint web/src` reports **12 problems** (was 15).
- `npx eslint web/src/app/core/pause.service.ts` → exit 0 **except** for the
  one `no-non-null-assertion` this step does not own — expect **0 problems**,
  because Step 3 already cleared line 92. If it reports anything, STOP.
- `grep -n "coll.pausedAt != null" web/src/app/core/pause.service.ts` → still
  exactly 1 hit (the `pause()` guard, deliberately untouched).
- `npm run test -w web` → **209 passed**.

---

### Step 8 — `computeResumeCardUpdates` takes `pausedAt` instead of asserting it

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` 11 problems, `grep pausedAt!` returns nothing, build exit 0, 209 tests; all 6 spec call sites cross-checked against their own `collection()` factory, no `expect(...)` changed. Left one over-long line for Step 10's `npm run format`.)

**Depends on:** Step 7 — same caller file; its `resume()` guard rewrite must be
in place first.

**Files**
- MODIFY `web/src/app/core/pause-shift.ts` — anchor: `export function computeResumeCardUpdates(`
- MODIFY `web/src/app/core/pause.service.ts` — anchor: `const cardUpdates = computeResumeCardUpdates(coll, this.store.cards(), Date.now());` (~line 50)
- MODIFY `web/src/app/core/pause-shift.spec.ts` — 6 call sites at ~lines 50, 66, 81, 95, 107, 121
- DO NOT TOUCH: `collection.store.ts`, `heatmap.ts`, `stats.ts`.

**Context**
**Read `.claude/skills/scheduling-domain` before this step.** This is the
highest-risk edit in the phase.

`const pausedAt = coll.pausedAt!;` asserts a precondition that only the JSDoc
knows about. What the `!` hides: with `coll.pausedAt === null`,
`resumedAt - null` is `resumedAt` (null coerces to 0), so every learning and
relearning card would be shifted by the entire epoch — `due + resumedAt`. The
caller's guard is the only thing preventing it.

Making it a parameter turns the precondition into a type and deletes the
unreachable path rather than handling it. The caller already has the value
narrowed to `number` one line above the call.

Parameter order puts the two timestamps adjacent in the order they occur:
`(coll, cards, pausedAt, resumedAt)`. `coll` is still needed — `todayNumber`
reads `created` and `dayCutoffHour` from it.

**Do**
1. In `pause-shift.ts`, change the signature to:
   ```ts
   export function computeResumeCardUpdates(
     coll: Collection,
     cards: Card[],
     pausedAt: number,
     resumedAt: number,
   ): { id: string; due: number }[] {
   ```
   and delete the line `const pausedAt = coll.pausedAt!;`. Everything below it
   — `dayDelta`, `msDelta`, the loop, the `card.type` branches — is unchanged.
2. Update the JSDoc's opening: it currently says "Given the collection (with a
   non-null `pausedAt`) and the current set of cards". Change it to say the
   pause start is passed explicitly, so the comment no longer documents a
   precondition the signature now enforces. Leave the rest of the JSDoc —
   especially the `card.type` (never `card.queue`) note — untouched.
3. In `pause.service.ts`, change the call to:
   ```ts
   const cardUpdates = computeResumeCardUpdates(coll, this.store.cards(), pausedAt, Date.now());
   ```
   (`pausedAt` is the local already declared on the line above.)
4. In `pause-shift.spec.ts`, add the pause timestamp as the third argument at
   all 6 call sites. Each test already has the value the `collection()` factory
   was given — e.g. the first case builds `collection({ pausedAt: 100 * DAY })`,
   so its call becomes
   `computeResumeCardUpdates(coll, [c], 100 * DAY, resumedAt)`. **Pass the same
   value that test's collection already carries — do not change any test's
   expected `due`.**

**Done when**
- `npx eslint web/src` reports **11 problems** (was 12).
- `grep -c '!' web/src/app/core/pause-shift.ts` finds no `coll.pausedAt!` —
  specifically `grep -n "pausedAt!" web/src/app/core/pause-shift.ts` returns nothing.
- `npm run build` → exit 0.
- `npm run test -w web` → **209 passed**, and specifically
  `npm run test -w web` shows `pause-shift.spec.ts` still passing all its cases
  with unchanged expectations.
- `git diff main..HEAD -- web/src/app/core/pause-shift.spec.ts` shows **only**
  added arguments — no changed `expect(...)` line.

**If blocked**
If any `pause-shift.spec.ts` assertion now fails, STOP and report which case.
A failing expectation means a wrong `pausedAt` was passed at that call site —
do **not** change the expected value to match.

---

### Step 9 — Type `pause.service.spec.ts`'s mocks, and prove the typing is real

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` **0 problems**, no `as unknown as` remains, 209 tests, `format:check` clean. Drift experiment fired: `pause.service.spec.ts:169 error TS2339: Property 'expectedPausedAt' does not exist`; `api.service.ts` restored and absent from `git status`. Executor additionally annotated `setup()`'s return type with `Mock<…>` — additive to the prescribed shape, drift detection unaffected.)

**Depends on:** Step 2 — same file; its `beforeEach`/`afterEach` braces are
already in.

**Files**
- MODIFY `web/src/app/core/pause.service.spec.ts`
- DO NOT TOUCH: `api.service.ts` — it is edited **temporarily** in the Done-when
  experiment below and must be restored. `pause.service.ts` is not edited here at all.

**Context**
All 9 remaining `no-unsafe-*` violations trace to one line — `} as unknown as ApiService;`
— which erases the mock's types, making every `.mock.calls[0][0]` an `any`.

Phase 1's retrospective records the exact failure to avoid: an executor
"hand-rolled a mock type that silenced `no-unsafe-*` while removing the
drift-detection it existed for". Silencing the rule is easy. The point of the
fix is that the spec must still break when `ApiService`'s contract moves — so
that is the Done when, run as an actual experiment.

The shape below was applied and verified in CriticReview R2: it clears all 9,
keeps 209 tests passing, and breaks at compile time on a renamed payload field.

**Do**
1. Change the rxjs import to `import { of, type Observable } from 'rxjs';`.
2. Above `setup()`, add:
   ```ts
   /**
    * The resume payload's type is read off `ApiService` rather than restated, so
    * a change to that contract breaks this spec at compile time instead of
    * leaving it green over a mock that no longer matches (Analyst.md D5).
    */
   type ResumePayload = Parameters<ApiService['resume']>[0];
   ```
3. Replace `setup()` entirely with:
   ```ts
   function setup() {
     const patchCollection = vi.fn((patch: Partial<Collection>) => of({ ...collection(), ...patch }));
     const resume = vi.fn<(payload: ResumePayload) => Observable<{ applied: boolean }>>(() =>
       of({ applied: true }),
     );
     const api = { patchCollection, resume } satisfies Pick<ApiService, 'patchCollection' | 'resume'>;

     TestBed.configureTestingModule({
       providers: [{ provide: ApiService, useValue: api }],
     });
     const store = TestBed.inject(CollectionStore);
     const service = TestBed.inject(PauseService);
     return { store, service, patchCollection, resume };
   }
   ```
4. In each of the 6 tests, destructure `patchCollection` / `resume` instead of
   `api`, and replace every
   `(api.X as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]` with
   `X.mock.calls[0][0]`, and every `expect(api.X)` with `expect(X)`.
5. Replace both `'resume-pending:' + pausedAt` occurrences with
   `` `resume-pending:${pausedAt}` ``.
6. In the last test, `sent.cardUpdates.find(...)` no longer needs its inline
   `(u: { id: string })` annotation — the callback parameter is now inferred.
   Use `sent.cardUpdates.find((u) => u.id === 'c1')` and change the final
   assertion's `shifted.due` to `shifted?.due`.

**Done when**
- `npx eslint web/src` reports **0 problems**. `web/src` is clean.
- `grep -n "as unknown as" web/src/app/core/pause.service.spec.ts` returns **nothing**.
- `npm run test -w web` → **209 passed**.
- **The drift experiment.** In `web/src/app/core/api.service.ts`, temporarily
  rename `resume`'s payload field `expectedPausedAt` to `expectedPausedAtRENAMED`.
  Run `npx tsc -p web/tsconfig.spec.json --noEmit`. It **must** report
  `error TS2339: Property 'expectedPausedAt' does not exist` at
  `pause.service.spec.ts`. Then restore `api.service.ts` exactly
  (`git checkout -- web/src/app/core/api.service.ts`) and confirm
  `git status --short` no longer lists it.

**If blocked**
If the drift experiment does **not** produce a `pause.service.spec.ts` error,
the retype is cosmetic and has removed the protection it was supposed to keep.
STOP and report — do not accept a green lint as sufficient. Restore
`api.service.ts` before reporting either way.

---

### Step 10 — Checkpoint: `web/src` is clean

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint web/src` **exit 0, 0 problems**; `server/src` still 41; 71 + 209 tests; build and `format:check` exit 0; exactly the 9 declared source files modified, `api.service.ts` absent)

**Depends on:** Steps 6–9.

**Files**
- DO NOT TOUCH: anything.

**Do**
1. Run `npm run build`, `npm run test`, `npm run format:check`.
2. Run `npx eslint web/src` and `npx eslint server/src`.
3. Run `git status --short` and `git diff --name-only main..HEAD`.

**Done when**
- `npx eslint web/src` → **exit 0, 0 problems**.
- `npx eslint server/src` → still exactly **41 problems**.
- `npm run test` → **71 passed** (server), **209 passed** (web).
- `npm run build` → exit 0; `npm run format:check` → exit 0.
- `git status --short` shows no unexpected modified file — in particular
  `web/src/app/core/api.service.ts` is **not** listed (Step 9's experiment
  restored it).
- `git diff --name-only main..HEAD`, excluding `specs/`, lists exactly these 8
  files: `web/src/app/core/collection.store.ts`, `core/heatmap.spec.ts`,
  `core/pause-shift.spec.ts`, `core/pause-shift.ts`, `core/pause.service.spec.ts`,
  `core/pause.service.ts`, `core/scheduling/scheduler-factory.ts`,
  `core/scheduling/sm2.spec.ts`, plus `web/src/app/features/review/review.ts`
  (9 with it — the one deliberate Phase 1 file, Analyst.md D4).

**If blocked**
If `format:check` fails, run `npm run format` and re-run the suite; a Prettier
diff is expected after hand edits and is not a defect. Anything else — STOP.

---

### Step 11 — The bounded invariant review of the five arithmetic files

**Model:** top-level

**Status:** done (2026-08-31, `Analyst.md` §7 carries the 5-row table, every row with a verdict; no source file edited — `git status` unchanged from Step 10. Two findings, both recorded not fixed: the `scheduling-domain` skill's "heatmap buckets must go through `todayNumber`" line contradicts the live calendar-date implementation and spec 007's fix; and `stats.ts`'s `yearlyHeat` has no non-test consumer.)

**Depends on:** Step 10 — reviews the tree as it will ship.

**Files**
- MODIFY `specs/018-lint-phase2-scheduling/Analyst.md` — section `## 7. Discovered` only
- READ ONLY: `web/src/app/core/stats.ts`, `web/src/app/core/heatmap.ts`,
  `web/src/app/core/study-queue.service.ts`, `web/src/app/core/collection.store.ts`,
  `web/src/app/core/scheduling/learning-steps.ts`
- DO NOT TOUCH: all five files above, and every other source file. **This step
  edits no code at all.**

**Context**
Roadmap Phase 2: "Phase 2 owns files, not residual lint hits." 17 of the 24
Phase 2 files carry zero violations; Analyst.md D7 bounds the review to the
five that actually perform `card.due` or day-number arithmetic, so this cannot
become an open-ended audit.

CLAUDE.md's scope-discipline rule governs the output: anything found is
**written down, not fixed**. Phase 2 is a lint phase.

**Do**
1. Re-read `.claude/skills/scheduling-domain`.
2. Read each of the five files against these invariants specifically:
   - `card.due`'s unit is chosen by `card.type`, never `card.queue`
   - day numbers always come from `todayNumber()`, never calendar dates
   - learning `due` (epoch ms) is never compared against a day number
   - `card.left` is clamped before indexing a steps array (`clampLeft`)
   - SM-2 and FSRS state are both preserved, never zeroed
3. Append one table to `Analyst.md` §7 with **one row per file** and a verdict
   in every row — either a finding or the literal words "no finding". A missing
   row is a failed step.

**Done when**
- `Analyst.md` §7 contains a table with exactly 5 rows, one per file named
  above, each with a non-empty verdict.
- `git diff --name-only main..HEAD -- web/ server/` is **unchanged** from
  Step 10's list — this step added no source edit.
- If any row is a real defect, it also has a Quick Tasks row in
  `specs/STATE.md`, and the row here says so.

---

### Step 12 — Gate all of `web/src` in CI

**Model:** haiku

**Status:** done (2026-08-31, `lint:ci` is literally `eslint web/src` — asserted on the script text, not its exit code; `npm run lint:ci` exit 0; `grep -c "features/browser" package.json` → 0; `ci.yml` comment rewritten, ruff sentences preserved)

**Depends on:** Step 10 — `web/src` must already be at 0 before it is gated.
Roadmap non-negotiable #2: a directory joins the gate once it is clean, never
before.

**Files**
- MODIFY `package.json` — anchor: `"lint:ci":`
- MODIFY `.github/workflows/ci.yml` — anchor: the comment block starting `# Ruff and ESLint linting gates.` in the `lint` job
- DO NOT TOUCH: `eslint.config.mjs` (Analyst.md D1 — no rule changes), the
  `tests`, `clean-table-gate` and `hooks` jobs.

**Context**
`lint:ci` currently names 13 explicit paths, grown one batch at a time through
Phase 1. Every file under `web/src` is now clean, so the honest gate is the
directory — which also picks up nine clean files Phase 1 never gated (it sized
batches by violation count, so a file with no violations never joined the
list), and covers any new file on creation.

**The trap in this step**, from Phase 1's retrospective and CriticReview R7:
`npm run lint:ci; echo $?` exits 0 whether or not you make the edit, because
the 13 old paths are all still clean. **A green exit code proves nothing here.**
The Done when asserts on the script's text instead.

**Do**
1. In `package.json`, replace the entire `lint:ci` value with exactly
   `eslint web/src`.
2. In `ci.yml`'s `lint` job comment, rewrite the ESLint sentences: `lint:ci` now
   gates **all of `web/src`** (Phase 1 + Phase 2 complete); `server/src` is the
   remaining surface and joins at Phase 3; the full-repo gate is Phase 4. Keep
   the ruff sentences and the `format:check` sentence as they are.
3. Leave `"lint": "eslint ."` and `"lint:json"` untouched — full-repo and
   report-only until Phase 4.

**Done when**
- `node -e "process.exit(require('./package.json').scripts['lint:ci'] === 'eslint web/src' ? 0 : 1)"` → exit 0.
- `npm run lint:ci` → exit 0.
- `grep -c "features/browser" package.json` → `0` (the old path list is gone).
- `grep -n "Phase 2" .github/workflows/ci.yml` no longer describes Phase 2 as
  pending or upcoming.

**If blocked**
If `npm run lint:ci` is non-zero after the change, `web/src` is not actually
clean — STOP and report which file. Do not narrow the path to make it pass.

---

### Step 13 — Re-baseline `INVENTORY.md`, tick `ROADMAP.md`, record the decisions

**Model:** haiku

**Status:** done (2026-08-31, `state_rotate.py --check` exit 0 at 297/300 lines, `clean-table-check.sh` exit 0, all three ROADMAP Phase 2 boxes `- [x]`, AD-021 + L-015 recorded with L-015 paired in `specs/LESSONS.md`, `scheduling-domain` skill Lessons corrected)

**Depends on:** Steps 10 and 12 — records the numbers they produced.

**Files**
- MODIFY `specs/015-typescript-lint-rollout/INVENTORY.md` — append a new dated section
- MODIFY `specs/015-typescript-lint-rollout/ROADMAP.md` — the `## Phase 2` checkboxes and the `## Discovered` log
- MODIFY `specs/STATE.md`
- MODIFY `specs/LESSONS.md`
- DO NOT TOUCH: `Analyst.md`, `tasks.md`, `CriticReview.md` (top-level owns
  those, and a subagent is blocked from writing them). Do not renumber any
  existing `AD`/`B`/`L` entry.

**Context**
`specs/STATE.md` is append-only and has a ~300-line budget enforced on every
push by `tools/state_rotate.py --check`; it is at 283 lines, so there is room
for roughly one decision and two lesson headlines, not more. **Every `L-NNN`
headline in `specs/STATE.md` must have a matching body in `specs/LESSONS.md`**
or the pre-push gate refuses the push — write both or neither.

**Do**
1. Append a `## Phase 2 exit (2026-08-31)` section to `INVENTORY.md` recording:
   `web/src` **24 → 0**; `server/src` unchanged at **41**; total **65 → 41**;
   and the correction that Phase 2's file list is **24 files, not 16** (16 was
   the count that ever carried a violation; the attribution glob owns 24).
2. Tick all three Phase 2 checkboxes in `ROADMAP.md` and add a short
   "**Phase 2 is done** (2026-08-31)" paragraph in the same shape as Phase 1's.
3. Add dated entries to `ROADMAP.md`'s `## Discovered` for: the 24-vs-16
   correction; the nine clean-but-never-gated Phase 1 files (an incremental
   allow-list grown by remediation silently omits what never needed
   remediating — a warning for Phase 3); and `web/src/index.html` sitting
   outside the config's `web/src/app/**/*.html` glob.
4. In `specs/STATE.md`: update the "Current work" section for Phase 2, and add
   **one** new `AD-NNN` (next free number) recording that Phase 2 changed no
   rule and added no `eslint-disable` — remediation only — and that the gate is
   now the whole `web/src` directory rather than a path list.
5. Add **one** new `L-NNN` headline in `specs/STATE.md` with its body in
   `specs/LESSONS.md`: *a gate's exit code cannot verify a change to the gate's
   own scope* — `npm run lint:ci` exits 0 whether or not the step widened it,
   because what it already covered is clean. Both Phase 1 (Step 9) and Phase 2
   (Step 12) had to assert on the script's text instead. Cite both.

**Done when**
- `python3 tools/state_rotate.py --check` → exit 0 (`specs/STATE.md` under 300 lines).
- `bash scripts/clean-table-check.sh` → exit 0.
- `grep -c "^- \[x\]" specs/015-typescript-lint-rollout/ROADMAP.md` has
  increased by 3 from its pre-step value.
- Every new `L-NNN` headline in `specs/STATE.md` has a body in
  `specs/LESSONS.md`.

**If blocked**
If `state_rotate.py --check` fails because `specs/STATE.md` is over budget,
STOP and report. CLAUDE.md reserves `--apply` for a human who has decided to
rotate — do not run it.

---

### Step 14 — Regression, acceptance walk, wrap-up

**Model:** top-level

**Status:** done (2026-08-31, `lint:ci` exit 0, `server/src` 41, 71 + 209 tests, build and `format:check` exit 0, `eslint.config.mjs` diff empty, no `eslint-disable` in `web/src`, `data/spanish/` clean; Analyst.md §8 walked with 11 rows and §9 written; run marker removed)

**Depends on:** Steps 11, 12 and 13.

**Files**
- MODIFY `specs/018-lint-phase2-scheduling/Analyst.md` — sections `## 8. Acceptance criteria — walked` and `## 9. Retrospective`
- MODIFY `specs/018-lint-phase2-scheduling/tasks.md` — the `**Status:**` lines
- MODIFY root `STATE.md` — remove the `## Executing:` run marker
- DO NOT TOUCH: any source file. This step writes no code.

**Context**
The closing step. Analyst.md §6 has 11 numbered acceptance criteria; each gets
a walked verdict with the evidence that proves it, not a restatement.

**Do**
1. Run the full battery: `npm run build`, `npm run test`,
   `npm run format:check`, `npx eslint web/src`, `npx eslint server/src`,
   `npm run lint:ci`.
2. Run the two D1 discipline checks: `git diff main..HEAD -- eslint.config.mjs`
   must be **empty**, and `grep -rn "eslint-disable" web/src` must return
   **nothing**.
3. Check `git status` for changes under `data/spanish/` and
   `git checkout -- data/spanish/` if the dev server dirtied it (L-002).
4. Fill in Analyst.md §8 as a table: one row per criterion 1–11, each Pass/Fail
   with its evidence.
5. Fill in Analyst.md §9 — the two TEMPLATE.md questions: did `Analyst.md`
   catch anything not thought about up front, and did anything in `tasks.md`
   turn out wrong during coding.
6. Set every step's `**Status:**` in this file to
   `done (2026-08-31, <the evidence that step's own Done when names>)`.
7. Remove the `## Executing: 018-lint-phase2-scheduling` line from the root
   `STATE.md`.
8. **Do not commit — ask the user first.**

**Done when**
- `npx eslint web/src` → 0 problems; `npx eslint server/src` → 41;
  `npm run lint:ci` → exit 0.
- `npm run test` → **71 passed** + **209 passed**; `npm run build` → exit 0;
  `npm run format:check` → exit 0.
- `git diff main..HEAD -- eslint.config.mjs` is empty and
  `grep -rn "eslint-disable" web/src` returns nothing.
- Analyst.md §8 has 11 rows; §9 answers both questions.
- `grep -c "^\*\*Status:\*\* not started" specs/018-lint-phase2-scheduling/tasks.md` → `0`.
- `bash scripts/clean-table-check.sh` → exit 0.
- Root `STATE.md` contains no `## Executing:` line.
- The user has been asked before any commit.
