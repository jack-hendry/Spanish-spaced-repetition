# Critic review — Phase 3

Harden pass over `Analyst.md` + `tasks.md`, 2026-08-31.

## What this pass could and could not add

Unusually for this repo, the *code* prescriptions arrived pre-verified: every
one of the 41 fixes was applied, linted, type-checked, formatted and tested
before `tasks.md` was written (`Analyst.md` §4). So the usual harden job —
"open the file and confirm the type/signature the step assumes" — was already
done by execution.

That moves the risk somewhere else. What execution did **not** verify is the
*plan around* the code: step boundaries, the running-count assertions, the
recipes a delegated executor types verbatim, and the numbers in Done-when
clauses. Phase 1 shipped a Done-when that could not fail (L-015) and Phase 2
caught an executor confabulating a file it had modified — neither is a code
defect. This pass therefore re-derived the plan's own claims.

Findings below are what that produced. R1 is the one real defect, and it was
found during the Analyst pass rather than here.

---

## R1 — CONFIRMED, fixed before `tasks.md` was written

**The first draft's fix for `routes/index.ts:175` could not work, and repeated a
documented lesson.**

Prescribed: `const firstExisting: Card | undefined = existing[0]`. Applied, the
file went from 2 violations to **4** — TypeScript narrows a `const` to its
initializer's type regardless of the annotation, so `firstExisting?.deckId`
then drew "Unnecessary optional chain on a non-nullish value" on top of the
original `??` complaints.

Phase 1 hit this exact wall (its Analyst §10: "R8 … prescribed an annotation
that cannot work — TypeScript narrows a `const` to its initializer's type") and
the repo already contained the working instrument: `.at(0)`, used at
`review.ts:135`. Verified: `.at(0)` takes `routes/index.ts` to zero with `tsc`
clean.

**Disposition:** `tasks.md` Step 5 prescribes `.at(0)` and explicitly names the
annotation as the thing not to try. → `Analyst.md` §10, and the L-016 headline
Step 11 records.

---

## R2 — Step 1's count assertion, re-derived

Step 1 tells the executor to stop unless `--fix` leaves exactly 28. That number
was arithmetic (41 − 13), not a measurement, and it is the first assertion a
delegated run hits — a wrong one halts the run on step one.

**Re-derived from a clean baseline:** `npx eslint --fix server/src` →
`✖ 28 problems`, touching exactly the six files Step 1 declares in `Files`, no
others. Confirmed, then reverted.

The rest of the running-count table follows from the per-step fix counts in
`Analyst.md` §6, which sum to 41 and reconcile per rule against the measured
distribution (13 + 8 + 4 + 6 + 3 + 3 + 2 + 1 + 1).

---

## R3 — Step 8's `git show` recipe, re-derived

Step 8 tells the executor to reconstruct the pre-change transformer with
`git show origin/main:server/src/import/transform.ts`. The Analyst's own
equivalence harness was built with a `cp` from a scratch copy, so the recipe in
the step was never the one actually run.

**Verified:** the `git show` output is byte-identical to the pre-change file
(`diff -q`, no differences). The step is safe as written.

---

## R4 — `DeckRegistry.order` retype is file-local

Step 6 changes `order: string[]` → `order: Deck[]`. Worth confirming nothing
outside the file consumes it, since a shape change is broader than a lint fix.

**Verified:** `grep -rn "DeckRegistry" server/src/` returns hits only in
`import/transform.ts`, and the interface is not exported. Both use sites
(`reg.order.push`, the `decks` construction) are edited in the same step.

---

## R5 — Step 10's gate will actually pass

Step 10 widens `lint:ci` to `eslint web/src server/src`. Its Done-when requires
exit 0, which depends on `web/src` genuinely being at zero rather than merely
having been declared so by Phase 2.

**Verified in this worktree:** `npx eslint web/src` produces no output and
exits 0. Combined with `server/src` at 0 after Step 7, the widened gate passes.

Note the Done-when deliberately greps `package.json` for the literal paths as
well: `npm run lint:ci` exits 0 whether or not the edit is made, because
everything already named is clean. That is L-015's vacuous-check failure, and
it is the reason the text assertion is there.

---

## R6 — Step 11's lesson number pinned

The pre-push gate requires every `L-NNN` headline in `specs/STATE.md` to have a
body in `specs/LESSONS.md`. A step that says "add a lesson" without a number
invites a collision or a mismatch.

**Verified:** L-015 is the highest in use in both files. Step 11 now names
**L-016** explicitly.

---

## R7 — The three `api()` helpers are not identical

Step 3 applies the same `Headers` fix to three files. Two take `(path, init)`
and close over a module-level `base`; `app.integration.test.ts` takes
`(base, path, init)`.

An executor copy-pasting one prescription into all three would break that
file's signature. Step 3 calls the difference out in its `Do` and tells the
executor to keep the existing signature. No change needed beyond that note —
recorded so it is not "simplified" later.

---

## R8 — What this pass still cannot catch

Two things, stated rather than papered over:

1. **Step 8's harness is only as good as its negative control.** The step
   requires reporting *both* the perturbed run (expect 2 of 3 failing) and the
   restored run (3 of 3), because a harness that passes unconditionally would
   otherwise look like success. The Analyst pass ran exactly this and got 2/3
   and 3/3. If an executor reports 3/3 for both, the harness is hollow and the
   step has failed regardless of what it claims.

2. **Executor reports must be checked against `git diff`, not believed.**
   Phase 1 saw four reports of "all checks passing" over wrong work; Phase 2
   saw a confabulated file path in an otherwise-correct step. Every step here
   has a `git diff`-shaped or `grep`-shaped Done-when for that reason, and the
   orchestrator should read each step's diff before dispatching the next.
   `verified-remediation.patch` makes that cheap: the diff should match it.

## Verdict

`tasks.md` is ready to execute. Five claims were re-derived (R2–R6), one defect
was found and fixed before the plan was written (R1), and two residual risks
are named with the check that catches each (R8).
