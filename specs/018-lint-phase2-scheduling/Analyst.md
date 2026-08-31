# Analyst — Phase 2: `core/scheduling/` and adjacent state

Phase 2 of [`specs/015-typescript-lint-rollout/ROADMAP.md`](../015-typescript-lint-rollout/ROADMAP.md).

Sized **Large** by the roadmap's own instruction ("its own `Analyst.md` +
`tasks.md` + harden round, sized Large regardless of how few files or how
mechanical the fixes look"), and independently by CLAUDE.md's sizing rule:
every file in scope computes or consumes `card.due`, day numbers, or scheduler
state.

## 1. What problem are we solving?

Phase 1 took `web/src` from 152 violations to 24 and put 13 paths behind
`npm run lint:ci` in CI. The 24 that remain are exactly the files the roadmap's
**non-negotiable #1** quarantined from batch work: scheduling core and the
files that do `card.due` arithmetic.

Those files are therefore the only part of `web/` that is neither clean nor
gated. Until they land, `web/src` cannot be gated as a whole, and Phase 4
cannot collapse the incremental path list.

Phase 2's job is to clear them **by hand, one at a time, each judged against
the invariants in `.claude/skills/scheduling-domain`** — and then gate all of
`web/src`.

### The baseline, re-measured

Measured in a fresh worktree at `origin/main` @ `1e44401`, **after
`npm install`** (L-013 — without `node_modules` type-aware rules silently stop
firing and every number is quietly low):

```
TOTAL 65    web/src 24    server/src 41
```

`web/src`'s 24, by file:

| Violations | File | Rules |
|---|---|---|
| 13 | `core/pause.service.spec.ts` | 5 `no-unsafe-member-access`, 3 `no-unsafe-assignment`, 2 `no-confusing-void-expression`, 2 `restrict-plus-operands`, 1 `no-unsafe-call` |
| 4 | `core/pause.service.ts` | 2 `prefer-optional-chain`, 1 `no-non-null-assertion`, 1 `restrict-plus-operands` |
| 3 | `core/collection.store.ts` | 1 `strict-boolean-expressions`, 1 `prefer-nullish-coalescing`, 1 `no-non-null-assertion` |
| 1 | `core/scheduling/scheduler-factory.ts` | `no-extraneous-class` |
| 1 | `core/scheduling/sm2.spec.ts` | `array-type` |
| 1 | `core/pause-shift.ts` | `no-non-null-assertion` |
| 1 | `core/heatmap.spec.ts` | `no-unsafe-argument` |

This reproduces Phase 1's published exit state exactly (`web/src` 24,
`server/src` 41). No drift; the numbers below are measured, not carried over.

### Phase 2's file list is 24 files, not 16

The roadmap says 16. That number is the count of files that *ever carried a
violation* — 10 from Phase 0's attribution plus the 6 Phase 1 reassigned. But
the attribution rule `INVENTORY.md` settled on is a **glob**: "any file under
`core/scheduling/`, plus `collection.store.*` and `study-queue.service.*`",
widened again by Phase 1 to the six `card.due` files and their specs.

Applied as written, that glob owns 24 files:

| Group | Files |
|---|---|
| `core/scheduling/` (all 12) | `format.ts`, `fsrs-math.ts`, `fsrs-optimize.ts`, `fsrs-optimize.spec.ts`, `fsrs.ts`, `fsrs.spec.ts`, `learning-steps.ts`, `learning-steps.spec.ts`, `scheduler-factory.ts`, `sm2.ts`, `sm2.spec.ts`, `types.ts` |
| Named by Phase 0 | `collection.store.ts`, `collection.store.spec.ts`, `study-queue.service.ts`, `study-queue.service.spec.ts` |
| Reassigned by Phase 1 (+ specs) | `pause-shift.ts`, `pause-shift.spec.ts`, `pause.service.ts`, `pause.service.spec.ts`, `heatmap.ts`, `heatmap.spec.ts`, `stats.ts`, `stats.spec.ts` |

**7 of the 24 carry violations; 17 carry none.** That is not a reason to drop
them — the roadmap's own words are "Phase 2 owns files, not residual lint
hits", written about exactly this. What it changes is what "handling" a
zero-violation file means: it is read against the domain invariants and gated,
not edited. §4 D7 makes that concrete and bounded so it cannot become an
open-ended audit.

### One thing Phase 1 left behind

Nine `web/src` files are clean, are **not** Phase 2, and are **not** in
`lint:ci`: `app/app.config.ts`, `app/app.html`, `app/app.routes.ts`,
`core/deck-color.{ts,spec.ts}`, `core/lifecycle.{ts,spec.ts}`,
`core/search.{ts,spec.ts}`. Phase 1 sized its batches by violation count, so
files that never had one never joined the gate. Verified clean:
`npx eslint <those nine>` exits 0.

They are swept up for free by D6 (gate `web/src` wholesale) and need no code
change.

## 2. What is in scope?

1. **Fix all 24 violations across the 7 files**, each individually reasoned
   about, none autofixed unattended (roadmap Phase 2 bullet 3).
2. **Review the 17 zero-violation Phase 2 files** against the
   `scheduling-domain` invariants, bounded by D7.
3. **Gate all of `web/src`** — replace `lint:ci`'s 13-path list with the single
   path `web/src`, and update the `lint` job comment in `ci.yml` that currently
   describes Phase 2 as pending.
4. **Re-baseline `INVENTORY.md`** with Phase 2's exit numbers and the 24-file
   correction, and tick Phase 2 in `ROADMAP.md`.

## 3. What is OUT of scope?

- **`server/src`** — Phase 3. Its 41 violations are untouched and unmeasured
  beyond confirming they stay at 41.
- **The full-repo gate** — Phase 4. This spec gates `web/src`, not `.`.
- **Any rule change.** No loosening, no tightening, no new rules, no
  `eslint-disable` comments. Phase 1's calibration (D1–D3) stands as-is and is
  the only calibration this roadmap gets before Phase 4. See D1 below —
  the temptation and the refusal.
- **Behaviour changes to scheduling.** Every edit must be behaviour-preserving
  on every reachable path. Where a violation cannot be fixed without changing
  behaviour, it is recorded in §7, not forced.
- **`card.due` semantics, day-number math, ease units, dual scheduler state.**
  Nothing in this spec changes any of them. A diff that does is wrong by
  construction, whatever the linter says.
- **Renaming `scheduler-factory.ts`.** D4 turns the class into a function; the
  filename stays. A rename ripples into `review.ts`'s import path for cosmetic
  gain.
- **Fixing anything the D7 review pass finds.** Findings are written to
  `## Discovered`, per CLAUDE.md's scope-discipline rule. Phase 2 is a lint
  phase, not a bug-fix phase.
- **`web/src/index.html`** — outside the config's `web/src/app/**/*.html` glob,
  so ESLint never sees it. Not a gap this spec closes.

## 4. Decisions

### D1 — No rule is relaxed in Phase 2

All 24 violations are genuine: not one is the "the compliant edit is the
broken edit" trap that L-014 records against `eqeqeq`. Every one has a fix that
is both clean and behaviour-preserving; §5 works through each.

The temptation is real and named here so the refusal is on record.
`no-unsafe-*` and `no-explicit-any` stay on in test files (Phase 1 D3 §5.1
deliberately kept them, and deferred the *question* to Phase 4, not the
enforcement). Turning them off would clear 9 of `pause.service.spec.ts`'s 13
for free. Phase 1 refused the same trade on `strict-boolean-expressions` — its
D4, "making the number go down rather than making the code better" — and this
is the same trade with a smaller prize. `pause.service.spec.ts` is the test
that pins the pause/resume `card.due` shift; an `any`-typed mock there is
exactly the mechanism by which it would keep passing after `ApiService.resume`'s
payload shape drifted.

### D2 — `Map.has()` + `Map.get()!` becomes one lookup

Two sites, same shape, both mirroring server writes into cached cards:

- `collection.store.ts:227` — `updates.has(c.id) ? { ...c, queue: updates.get(c.id)! } : c`
- `pause.service.ts:92` — `byId.has(c.id) ? { ...c, due: byId.get(c.id)! } : c`

Both become a single `get()` into a local, tested against `undefined`. The
Map's value type (`Card['queue']`, `number`) never includes `undefined`, so
`get() === undefined` and `!has()` are equivalent — and the version with one
lookup is the one where the assertion is unnecessary rather than suppressed.

This is the same class of fix as Phase 1's `template-renderer.ts`
`Object.hasOwn` change: the guard was live, the type was lying.

### D3 — `pause-shift.ts`'s `pausedAt!` becomes a parameter

`computeResumeCardUpdates` opens with `const pausedAt = coll.pausedAt!`, and
its JSDoc says "Given the collection (with a non-null `pausedAt`)". The
precondition exists; only the type doesn't know it.

Three candidate fixes:

| Fix | Verdict |
|---|---|
| Guard returning `[]` | Rejected — adds an untested branch and turns a programming error into a silent no-op. |
| Guard throwing | Rejected — changes behaviour in an unreachable branch, and needs a test for a case that cannot happen. |
| **Take `pausedAt: number` as a parameter** | **Chosen.** |

The caller already has it: `pause.service.ts:48` does
`const pausedAt = coll.pausedAt;` immediately after the `== null` guard, so
it is already narrowed to `number` at the call site one line below. Passing it
makes the precondition a type instead of an assertion, and deletes the
unreachable path rather than handling it.

What the `!` is hiding matters here, which is why this gets its own step: with
`coll.pausedAt === null`, `todayNumber(coll, null)` and `resumedAt - null`
(null coerces to 0) would shift every learning card by the **entire epoch** —
`due + resumedAt`. That is the worst possible corruption of a `card.due`, and
it is currently prevented only by the caller's guard and a comment.

New signature — parameter order puts the two timestamps adjacent, in the order
they occur:

```ts
export function computeResumeCardUpdates(
  coll: Collection,
  cards: Card[],
  pausedAt: number,
  resumedAt: number,
): { id: string; due: number }[]
```

8 call sites in `pause-shift.spec.ts` and 1 in `pause.service.ts` update with
it. The spec's cases all set `pausedAt` via the `collection()` factory, so each
call gains the same value the factory already carries — no test's *meaning*
changes. Keeping `coll` is required: `todayNumber(coll, …)` needs `created`
and `dayCutoffHour`.

### D4 — `SchedulerFactory` becomes `schedulerFor()`

`no-extraneous-class` fires on a class whose only member is
`static for(opts)`. The rule is pointing straight at a deviation from this
repo's own documented idiom — `angular-conventions`, "Pure logic first:
anything algorithmic (limits, search, stats, **scheduling**, templating) is a
plain exported function in `core/*.ts`".

So: `export function schedulerFor(opts: DeckOptions): Scheduler`, same body,
same module-level `sm2`/`fsrs` singletons, same file name. The two call sites
in `features/review/review.ts` (lines ~218 and ~271, plus the import) change
from `SchedulerFactory.for(opts)` to `schedulerFor(opts)`.

**This is the one edit in Phase 2 that reaches outside the Phase 2 file list.**
Deliberate, and small: a rename at two call sites in a file that is already
clean and already in the CI gate. The alternative — keeping the name by
exporting an object literal `{ for(opts) {…} }` — satisfies the rule while
preserving the deviation the rule caught. Rejected for that reason.

### D5 — Test-file fixes type the mock, they do not silence the rule

`pause.service.spec.ts`'s 9 `no-unsafe-*` violations all trace to one line:

```ts
} as unknown as ApiService;
```

The double cast erases the mock's real types, so every
`(api.resume as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]` comes
back `any` and each field read off it is a fresh violation.

The fix is to keep typed handles to the `vi.fn()` mocks and return them from
`setup()`, so `.mock.calls[0][0]` carries the implementation's own parameter
type. Phase 1's retrospective records the failure mode to avoid here: an
executor "hand-rolled a mock type that silenced `no-unsafe-*` while removing
the drift-detection it existed for". The test for whether this fix is real:
**changing `ApiService.resume`'s payload type must still break this spec at
compile time.** That is written into the step's *Done when* as an actual
experiment, not an assertion.

### D6 — The gate becomes `web/src`, one path

`lint:ci` currently names 13 paths. After this phase every file under
`web/src` is clean, so the honest gate is the directory. This also picks up the
nine never-gated clean files from §1, and means any new file anywhere under
`web/src` is covered on creation rather than when someone remembers to extend
a list.

`npm run lint` stays full-repo and report-only; Phase 4 collapses the two once
`server/src` is clean.

### D7 — The zero-violation review is bounded to five files and produces notes, not edits

17 Phase 2 files carry no violations. Reading all 17 closely is an audit this
spec is not scoped for, and CLAUDE.md's scope-discipline rule exists to stop
exactly that.

The bounded version: **the five files that perform `card.due` or day-number
arithmetic** get a targeted read against the `scheduling-domain` invariants —
`stats.ts`, `heatmap.ts`, `study-queue.service.ts`, `collection.store.ts`
(`todayNumber`), and `scheduling/learning-steps.ts` (the `clampLeft` invariant
from the skill's own 2026-08-26 lesson). The other 12 are confirmed clean and
gated, nothing more.

Findings are written to `## Discovered` and, if they are real defects, to Quick
Tasks in `specs/STATE.md`. **Nothing found this way is fixed inside this
spec.**

## 5. The 24 fixes, one by one

Grouped as the `tasks.md` steps take them. Every entry is behaviour-preserving
on every reachable path; the two that need argument are D2 and D3 above.

| # | Site | Rule | Fix |
|---|---|---|---|
| 1 | `sm2.spec.ts:266` | `array-type` | `Array<T>` → `T[]` in a type annotation. Syntactic. |
| 2 | `heatmap.spec.ts:70` | `no-unsafe-argument` | `Array(12).fill(ts)` is `any[]`. → `Array.from({ length: 12 }, () => ts)`, typed `number[]`. |
| 3–4 | `pause.service.spec.ts:61,62` | `no-confusing-void-expression` | `beforeEach(() => localStorage.clear())` → braces. Syntactic. |
| 5 | `collection.store.ts:227` | `no-non-null-assertion` | D2. |
| 6 | `pause.service.ts:92` | `no-non-null-assertion` | D2. |
| 7–8 | `collection.store.ts:208` | `strict-boolean-expressions`, `prefer-nullish-coalescing` | `(id && byId(id)) \|\| deckOptions()[0]` → `(id != null ? byId(id) : undefined) ?? deckOptions()[0]`. Equivalent for `''` too: no options group has id `''`, so `find` returns `undefined` either way. |
| 9 | `scheduler-factory.ts:10` | `no-extraneous-class` | D4. |
| 10–11 | `pause.service.ts:47,68` | `prefer-optional-chain` | `!coll \|\| coll.pausedAt == null` → `coll?.pausedAt == null`. Equivalent (`undefined == null` is true) and TS still narrows `coll` afterwards. Line 35's `!coll \|\| coll.pausedAt != null` is a different shape and is not flagged — leave it. |
| 12 | `pause.service.ts:100` | `restrict-plus-operands` | `KEY_PREFIX + pausedAt` → `` `${KEY_PREFIX}${pausedAt}` ``. Legal under Phase 1's D2 (`allowNumber: true`); identical coercion. |
| 13 | `pause-shift.ts:19` | `no-non-null-assertion` | D3. |
| 14–15 | `pause.service.spec.ts:98,147` | `restrict-plus-operands` | `'resume-pending:' + pausedAt` → template literal. Same as #12. |
| 16–24 | `pause.service.spec.ts:82,83,84,149,150,152×2,152,153` | `no-unsafe-*` (9) | D5 — type the mocks. |

Only 5 of the 24 are `--fix`-able. This is hand work throughout, as the
roadmap requires.

## 6. How do we know it is done?

1. `npx eslint web/src` exits 0 — **zero** violations in `web/src`.
2. `npm run lint:ci` is the single path `web/src` and exits 0.
3. `ci.yml`'s `lint` job comment no longer describes Phase 2 as pending, and
   names `server/src` as the remaining Phase 3/4 surface.
4. `npm run test` green at **280** tests (71 server, 209 web) — unchanged from
   this spec's first step to its last. `npm run build` and
   `npm run format:check` green.
5. `server/src` is still at **41** violations — untouched, proving no
   calibration leaked into Phase 3's surface.
6. `git diff --name-only main..HEAD` touches no `server/src` file, and exactly
   one `web/src` file outside the Phase 2 list: `features/review/review.ts`
   (D4).
7. `computeResumeCardUpdates` contains no `!` assertion and takes `pausedAt`
   explicitly; `pause-shift.spec.ts`'s 6 cases still assert the same expected
   `due` values they do today.
8. `pause.service.spec.ts` contains no `as unknown as` cast, and changing
   `ApiService.resume`'s payload type is demonstrated to break it at compile
   time (D5).
9. The D7 review pass has a written result for all five arithmetic files — a
   finding or an explicit "no finding" — in `## Discovered`.
10. `INVENTORY.md` records Phase 2's exit numbers and the 24-file correction;
    `ROADMAP.md`'s Phase 2 boxes are ticked with a dated Discovered entry.
11. No rule in `eslint.config.mjs` changed, and no `eslint-disable` comment
    was added anywhere: `git diff main..HEAD -- eslint.config.mjs` is empty and
    `grep -rn "eslint-disable" web/src` returns nothing.

## 7. Discovered

- (2026-08-31) **Phase 2's file list is 24, not 16.** The roadmap's 16 counted
  files that had carried a violation; the attribution glob
  `INVENTORY.md` settled on owns 24. Corrected here rather than in the
  roadmap's number, because "Phase 2 owns files, not residual lint hits" was
  already the stated principle — 16 was the arithmetic slipping behind the
  rule.
- (2026-08-31) **Nine clean `web/src` files were never gated by Phase 1.**
  Batches were sized by violation count, so a file with none never joined the
  path list. Harmless here (D6 sweeps them up), but the general shape —
  *an incremental allow-list grows by remediation, so it silently omits what
  never needed remediating* — is worth carrying into Phase 3.
- (2026-08-31) **`web/src/index.html` is outside ESLint's reach.** The config's
  template glob is `web/src/app/**/*.html`. Not closed here; a candidate for
  Phase 4.

### D7 review pass — the five arithmetic files (Step 11, 2026-08-31)

Read against the `scheduling-domain` invariants: `card.due`'s unit chosen by
`card.type` not `card.queue`; day numbers only via `todayNumber()`; learning
`due` (epoch ms) never compared to a day number; `card.left` clamped before
indexing a steps array; SM-2 and FSRS state both preserved.

**Nothing found here was fixed** — Phase 2 is a lint phase (CLAUDE.md scope
discipline). Two findings are docs/dead-code, neither is a live defect.

| File | Verdict |
|---|---|
| `core/stats.ts` | **No finding on correctness.** `dueForecast` filters `queue === 'review' && type === 'review'` and does `card.due - today` in day numbers; `formatRelativeDue` branches on `card.type` (never `queue`) and correctly compares learning/relearning against `now` (epoch ms) but review against `today` (day number), with a comment saying why. One structural observation, not a defect: every day-bucketing helper here takes `reviewDays: number[]` that the *caller* must have mapped through `todayNumber`. Nothing in the type distinguishes a day number from an epoch-ms timestamp, so handing one the wrong unit is silent. Same class of unenforced precondition this spec removed from `pause-shift.ts` (D3), but weaker — a convention, not an assertion. |
| `core/heatmap.ts` | **Finding (documentation).** `heatDateKey`/`buildHeatGrid` deliberately key by **local calendar date** shifted by `dayCutoffHour`, *not* by `todayNumber`. That is correct and is exactly what `specs/archive/2026-07-14-007-heatmap-date-off-by-one` fixed — `heatmap.spec.ts`'s regression test states it: "Calendar-date keying must not depend on `created` at all." But `.claude/skills/scheduling-domain` says the opposite: *"Any 'per day' feature (limits, unburying, **heatmap buckets**, forecast) must go through `todayNumber`, never through calendar dates."* Following the skill literally would reintroduce the 007 bug. The code is right; the skill is stale. → skill Lessons append + Quick Tasks. |
| `core/study-queue.service.ts` | **No finding.** Branch 1 uses `c.due <= ctx.now` for `learning`, branch 2 `c.due <= ctx.today` for `review` with the `type === 'review'` co-filter, branch 3 sorts new by position — the unit discipline is exact. Branch 4's no-`due`-comparison fallback is the behaviour already documented in the skill's 2026-08-26 lesson, not a new finding. Minor observation only: `start()`/`startAll()` fall back to `today = 0` when `collection()` is null, which would make `remainingLimits` treat every deck tally as stale; unreachable in practice since a session cannot start before load. |
| `core/collection.store.ts` | **No finding.** `todayNumber` is `floor((now - created - dayCutoffHour*3600_000) / 86_400_000)`, matching the skill exactly. `ownCounts` uses the same `queue === 'review' && type === 'review' && due <= today` triple as the study queue, so the deck-list badge and the queue cannot disagree; a paused collection zeroes all counts before any date maths runs. |
| `core/scheduling/learning-steps.ts` | **No finding; precondition re-verified.** `clampLeft(left, stepCount)` still requires `stepCount >= 1` — `clampLeft(3, 0)` returns `0` and would re-open the out-of-bounds read the function exists to close. The skill's 2026-08-26 lesson says every call site guards the array first; re-checked, and all four still do (`sm2.ts:126,153`, `fsrs.ts:133,165`, each `opts.<x>.steps.length ? … : [1]`/`[10]`). The guard remains outside the function, so a fifth call site must carry it. |

**Second finding (dead code).** `stats.ts`'s `yearlyHeat` has **no non-test
consumer** — `grep -rn "yearlyHeat" web/src` hits only its own declaration, two
doc comments and its spec. The live heatmap goes through
`heatmap.ts`'s `buildHeatGrid`. `yearlyHeat` is the day-number-based variant
that spec 007 moved away from, kept alive only by its own test. Not deleted
here; recorded.

## 8. Acceptance criteria — walked 2026-08-31

| # | Criterion | Result |
|---|---|---|
| 1 | `npx eslint web/src` exits 0 — zero violations | **Pass.** 24 → 0, stepped down 24→20→18→16→15→12→11→0 with a re-measure at every step. |
| 2 | `lint:ci` is the single path `web/src` and exits 0 | **Pass.** `scripts['lint:ci'] === 'eslint web/src'` asserted on the script *text* (CriticReview R7); `npm run lint:ci` exit 0. |
| 3 | `ci.yml`'s `lint` comment no longer calls Phase 2 pending | **Pass.** Rewritten to "gates all of `web/src` (Phases 1 and 2 complete)"; `grep -n "Phase 2" ci.yml` returns nothing. Ruff sentences untouched. |
| 4 | 280 tests, build, `format:check` green | **Pass.** 71 server + 209 web at every checkpoint, first step to last; build exit 0; `format:check` exit 0. |
| 5 | `server/src` still 41 — no calibration leaked | **Pass.** 41 at Steps 1, 5, 10 and the final walk. |
| 6 | No `server/src` file touched; exactly one `web/src` file outside the Phase 2 list | **Pass.** 9 source files modified; the only non-Phase-2 one is `features/review/review.ts` (D4's two call sites). |
| 7 | `computeResumeCardUpdates` has no `!` and takes `pausedAt`; spec expectations unchanged | **Pass.** `grep "pausedAt!"` returns nothing. All 6 spec call sites cross-checked against their own `collection()` factory; the diff is added arguments only — not one `expect(...)` changed. |
| 8 | No `as unknown as` in `pause.service.spec.ts`; drift demonstrated | **Pass.** Renaming `ApiService.resume`'s `expectedPausedAt` produced `pause.service.spec.ts:169 error TS2339`. `api.service.ts` restored and absent from `git status`. |
| 9 | D7 review has a written verdict for all five arithmetic files | **Pass.** §7 table, 5 rows. Two findings (both docs/dead-code), three "no finding". Nothing fixed. |
| 10 | `INVENTORY.md` re-baselined; `ROADMAP.md` Phase 2 ticked | **Pass.** Phase 2 exit section (24 → 0, 24-file correction); all three boxes `- [x]`; four dated Discovered entries. AD-021 and L-015 recorded. |
| 11 | No rule changed, no `eslint-disable` added | **Pass.** `git diff main..HEAD -- eslint.config.mjs` is empty; `grep -rn "eslint-disable" web/src` returns nothing. |

Final: `web/src` **24 → 0**, `server/src` **41** (untouched), repo **65 → 41**.
All 41 remaining are Phase 3's.

## 9. Retrospective

**Did `Analyst.md` catch anything not thought about up front?** Two things, and
both changed the shape of the phase.

The first was arithmetic that had quietly drifted from its own rule. The
roadmap said Phase 2 was 16 files. The attribution glob it had settled on owns
**24** — 16 was the count of files that had ever carried a *violation*, which
is precisely the framing "Phase 2 owns files, not residual lint hits" exists to
reject. The principle was right and the number had stopped matching it.

The second was that Phase 1's incremental gate had a hole nobody would have
found by looking at violation counts: nine `web/src` files were clean, not
Phase 2, and **not gated**, because Phase 1 sized its batches by violations and
a file with none never joined the path list. Gating the directory rather than a
list closes it and cannot recur. That generalises to Phase 3, and it is in the
roadmap's Discovered log.

**Did anything in `tasks.md` turn out wrong during coding?** No step had to be
rewritten — which is worth attributing rather than celebrating. The harden pass
did not reason about the three risky claims, it *ran* them: applied the edit,
compiled it, reverted. Phase 1's retrospective records that two of its four
"confirmed" harden verdicts did not survive execution, and all three of the
ones checked that way here (optional-chain narrowing, the mock retype, the
`no-unnecessary-condition` backfire) held exactly as measured. Prescribing
already-executed code is why fourteen steps produced no surprises.

Two smaller notes:

- **Executor reports needed checking against `git diff`, and one was wrong.**
  Step 2's executor reported modifying a `specs/018-lint-phase2-scheduling/STATE.md`
  that does not exist. The work was correct and the file set was exactly the
  three declared; the *report* was confabulated. Every step's diff was read at
  the top level before the next was dispatched, which is the only reason that
  is a footnote instead of a defect.
- **Step 9's executor exceeded the prescription and it was fine.** It added an
  explicit `Mock<…>` return-type annotation on `setup()` beyond the prescribed
  shape. Additive, and the drift experiment still fired — accepted rather than
  reverted, but noticed rather than assumed.

**The thing worth carrying to Phase 3.** The gate check that cannot fail is
worse than no gate check. `npm run lint:ci` exits 0 whether or not the step
widens it, because everything already covered is clean — Phase 1 shipped a
vacuous Done-when on exactly this and an executor reported a truthful `exit=0`
having skipped the edit. Both phases had to assert on the script's *text*
instead. → **L-015**.
