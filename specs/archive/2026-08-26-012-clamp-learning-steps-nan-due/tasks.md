# tasks — 012 clamp learning steps / `due: NaN`

_Archived summary — the original was a full 8-step, per-step `Do`/`Context`/
`If-blocked` playbook (haiku-executed, one subagent per step). Condensed here
to what matters after execution; the reasoning that survived is in
`Analyst.md`'s Retrospective and `specs/STATE.md` AD-010 / L-006._

**Design decision (unchanged throughout execution):** a single exported helper
`clampLeft(left, stepCount)` used at all four `curLeft` derivations, rather than
four inline `Math.min`/`Math.max` expressions — the audit found this bug
duplicated across `sm2.ts` and `fsrs.ts` from one being copied from the other,
so the *why* comment lives in exactly one place.

## Steps and outcomes

1. **Create `clampLeft` + unit spec** (haiku) — new
   `web/src/app/core/scheduling/{learning-steps.ts,learning-steps.spec.ts}`.
   6 tests. 187 → 193 tests, 20 → 21 files. Build clean.

2. **Wire into `Sm2Scheduler`** (haiku, depends on 1) — `sm2.ts`
   `previewLearning`/`previewRelearning`, one line each. 193 tests unchanged
   (R1 proof). `grep "card.left || steps.length" sm2.ts` → nothing.

3. **Pin the SM-2 fix** (haiku, depends on 2) — 5 new tests in `sm2.spec.ts`.
   193 → 198. Red/green proof: 5 fail with `sm2.ts` stashed, 198 green after
   `stash pop`. **Sent back once**: the R4 test's fixture selection used
   `testOpts === opts()`, a reference comparison against a freshly-built
   object that is always `false` — the relearning case was never exercised.
   Caught in review, not by the stash proof (the test's other cases failed for
   real reasons and masked the dead branch). Rewritten as an explicit case
   table. → **L-006**.

4. **Wire into `FsrsScheduler`** (haiku, depends on 1) — `fsrs.ts`, same two
   lines, mirrored. 198 tests unchanged (R1 for FSRS). Build clean, grep clean.

5. **Pin the FSRS fix** (haiku, depends on 4) — 4 new tests in `fsrs.spec.ts`.
   198 → 202. Red/green proof: 4 fail stashed, 202 green after pop.

6. **Checkpoint** (haiku, no new code) — root `npm run test` (server 38, web
   202) and `npm run build` both green. `clampLeft` wiring confirmed exactly 3
   references in each of `sm2.ts`/`fsrs.ts` (import + 2 call sites), and
   present in exactly 4 files repo-wide. `data/spanish/` dev-server churn
   reverted (L-002). Pre-existing unrelated diffs from the audit's Small fixes
   (`transform.ts`, `review.ts`, `browser.html`, `tsconfig.json`) were already
   in the tree before this run and are not scope escapes.

7. **Prove queue reachability (R5)** (haiku, depends on 2) — 1 new test in
   `study-queue.service.spec.ts`, local `setup()` copy (module-scoped
   `setup()` in the sibling `describe` is not visible — flagged in advance by
   `CriticReview.md` F1). 202 → 203. Red/green proof: fails with `sm2.ts`
   stashed, 203 green after pop. `study-queue.service.ts` untouched, as R5
   required.

8. **Wrap-up** (top-level, this step) — AD-010 + L-006 written to
   `specs/STATE.md`/`specs/LESSONS.md`; a domain lesson appended to
   `scheduling-domain`'s skill (correcting the audit's "silently unreachable"
   claim — `StudyQueueService.next()`'s 4th branch actually still serves a
   `NaN`-due learning card, it just can never become due); `Analyst.md`
   Retrospective filled in; root `STATE.md` run marker removed.

## Final numbers

Server 38 tests (unchanged), web 187 → 203 (+16, 4 new test files/blocks).
Root `npm run build` clean. `git status` clean outside the six files this spec
owns (plus pre-existing unrelated churn, confirmed at Step 6 and again at
close).
