# CriticReview — Phase 2

Harden pass over `Analyst.md` before `tasks.md` was written. Run 2026-08-31 in
the worktree `worktree-lint-phase2-scheduling` at `origin/main` @ `1e44401`,
with `node_modules` installed.

Phase 1's retrospective recorded that **two of its four "confirmed" harden
verdicts did not survive execution** — both were reasoned about rather than
run. So this pass does not reason about the risky claims: it applies the
proposed edit, runs the compiler and the linter, records the result, and
reverts. Every R below marked **verified** was executed, not argued.

The tree was returned to clean afterwards: `git status --short` shows only the
untracked `specs/018-lint-phase2-scheduling/`.

---

## R1 — `coll?.pausedAt == null` must still narrow `coll`. **Verified.**

`Analyst.md` D-table entry 10–11 replaces `if (!coll || coll.pausedAt == null) return;`
with `if (coll?.pausedAt == null) return;`. Line 48 immediately after reads
`coll.pausedAt`, and line 50 passes `coll` to `computeResumeCardUpdates`. If
TypeScript did not narrow the *base* of the optional chain, both would fail to
compile and the fix would be unusable.

Applied to `pause.service.ts:47` and ran `npx tsc -p web/tsconfig.app.json --noEmit`
→ **exit 0**. Narrowing holds. ESLint then reported the `:47` violation gone
and only `:68` remaining (the site not yet edited), confirming the rewrite is
what the rule wanted.

Reverted.

## R2 — the `pause.service.spec.ts` mock retype must clear 9 violations *and* keep detecting drift. **Verified, both halves.**

This is the one Phase 1 explicitly warns about: an executor "hand-rolled a mock
type that silenced `no-unsafe-*` while removing the drift-detection it existed
for". Silencing the rule is easy; the acceptance criterion is that the spec
still breaks when the contract moves.

Half one — does it clear them? Applied the D5 shape:

```ts
type ResumePayload = Parameters<ApiService['resume']>[0];

function setup() {
  const patchCollection = vi.fn((patch: Partial<Collection>) => of({ ...collection(), ...patch }));
  const resume = vi.fn<(payload: ResumePayload) => Observable<{ applied: boolean }>>(() =>
    of({ applied: true }),
  );
  const api = { patchCollection, resume } satisfies Pick<ApiService, 'patchCollection' | 'resume'>;
  ...
  return { store, service, patchCollection, resume };
}
```

ESLint on the file afterwards reported **only the two `no-confusing-void-expression`
hits at 72/73** — the `beforeEach`/`afterEach` lines, which this edit does not
touch. All 9 `no-unsafe-*` and both `restrict-plus-operands` cleared. `npm run test -w web`
→ **209 passed**, unchanged.

Half two — does it still catch drift? Renamed `ApiService.resume`'s payload
field `expectedPausedAt` → `expectedPausedAtRENAMED` and ran
`npx tsc -p web/tsconfig.spec.json --noEmit`:

```
web/src/app/core/pause.service.spec.ts:161:17 - error TS2339:
  Property 'expectedPausedAt' does not exist on type
  '{ expectedPausedAtRENAMED: number; cardUpdates: {...}[] }'.
```

The spec breaks at compile time on the assertion itself. Under the current
`as unknown as ApiService` code that same line is `any` and would have compiled
silently. The retype is a real gain, not a suppression.

Reverted both files.

**Consequence for `tasks.md`:** this experiment is not a nice-to-have, it is
the step's *Done when*. Written in as an executable check, because "I typed the
mock properly" is exactly the kind of claim Phase 1 found four executors making
falsely.

## R3 — the `??` rewrite could re-trigger `no-unnecessary-condition`. **Verified clear.**

Phase 1's retrospective names `no-unnecessary-condition` as the rule that is
"not mechanical" — two guards four steps apart presented identically and
resolved in opposite directions. `collection.store.ts:208`'s rewrite introduces
both a new ternary condition (`id != null`) and a new `??`, either of which
could be judged redundant by the type system and trade one violation for
another.

Applied entries 5 and 7–8 together (the `??` rewrite and the `Map.get` rewrite)
and ran ESLint over `collection.store.ts` and `heatmap.spec.ts` → **exit 0**.
No new violation of any rule. `id` is genuinely `Id | undefined` and
`deckOptionsById` genuinely returns `DeckOptions | undefined`, so both
conditions are load-bearing.

Reverted.

## R4 — the template-literal fixes depend on a Phase 1 calibration. **Confirmed by reading the config.**

Entries 12 and 14–15 fix `restrict-plus-operands` by moving to
`` `${KEY_PREFIX}${pausedAt}` ``. That is only clean because Phase 1's D2 set
`'@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }]`
— `eslint.config.mjs:43` (server) and `:67` (web). Under the
`strictTypeChecked` default (`allowNumber: false`) these fixes would trade
`restrict-plus-operands` for `restrict-template-expressions` one-for-one.

No action: D2 is in place and Phase 2 changes no rule (D1). Recorded so that
whoever revisits calibration at Phase 4 knows these sites are downstream of it.

## R5 — `schedulerFor`'s blast radius. **Confirmed by grep.**

`grep -rn "SchedulerFactory" web/src server/src` returns exactly 4 hits: the
declaration in `scheduling/scheduler-factory.ts:10`, and in
`features/review/review.ts` the import (`:17`) plus two call sites (`:218`,
`:271`). No server usage, no template usage, no other feature. D4's claim that
this reaches exactly one file outside the Phase 2 list is correct.

## R6 — `computeResumeCardUpdates`'s call sites. **Confirmed by grep, count corrected.**

`Analyst.md` D3 says "8 call sites in `pause-shift.spec.ts`". That is the raw
grep count and it is wrong as a count of *calls*: of the 8 occurrences, one is
the `import` on line 3 and one is the `describe(...)` string on line 44. There
are **6 actual calls** — lines 50, 66, 81, 95, 107, 121 — plus the single call
in `pause.service.ts:50`. Seven call sites total.

`tasks.md` uses the corrected numbers. Left uncorrected in `Analyst.md`'s prose
would have given the executor a count that never matches what it finds, which
is the kind of mismatch that makes an executor "adjust" rather than stop.

## R7 — the step that cannot verify itself. **Structural finding.**

Phase 1's retrospective: "The `lint:ci` Done-when was vacuous. `npm run lint:ci; echo $?`
exits 0 whether or not the step adds its paths, because the gate only lints what
its script names. Step 9 reported a truthful `exit=0` having skipped the edit
entirely."

Phase 2 has the same hazard in D6, and worse — the new gate is a *single* path,
so an executor that edits nothing still sees a green `lint:ci` (the old 13
paths are all still clean). The Done-when for that step therefore asserts on
the script's **text**, not its exit code:

```
node -e "process.exit(require('./package.json').scripts['lint:ci'] === 'eslint web/src' ? 0 : 1)"
```

Same trap, same shape, and it is the second time this roadmap has hit it. That
generalises: **a gate's exit code cannot verify a change to the gate's own
scope.** Flagged for a lesson in the wrap-up step.

## R8 — "no rule changed" needs a mechanical check, not a promise.

D1 is the phase's central discipline claim and nothing enforces it. Added to
the acceptance criteria as two commands rather than an assertion:
`git diff main..HEAD -- eslint.config.mjs` must be empty, and
`grep -rn "eslint-disable" web/src` must return nothing. Both are in the
wrap-up step's Done when.

## R9 — the D7 review pass is the step most likely to sprawl.

"Review 5 files against the domain invariants" has no natural stopping point,
and CLAUDE.md's scope-discipline rule names drift as the main failure mode this
harness exists to prevent. `tasks.md` constrains it three ways: the file list is
fixed at five and named, the output is a fixed-shape table with one row per file
(so "no finding" is a required answer rather than an omission), and the step's
**Files** section lists every one of the five as read-only with the spec doc as
the only writable target. An executor that edits a source file in that step has
visibly broken the step.

---

## Verdict

`Analyst.md` is sound. Two corrections fed into `tasks.md` rather than back into
it: R6's call-site count (7, not 8), and R7's non-vacuous gate check. R4, R8 and
R9 added checks that did not exist.

The three claims that could have failed twelve steps in — optional-chain
narrowing, the mock retype, and a `no-unnecessary-condition` backfire — were all
executed rather than argued, and all three hold.
