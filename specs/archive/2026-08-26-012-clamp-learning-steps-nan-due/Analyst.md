# Analyst: Clamp learning/relearning steps to stop `due: NaN`

> Source: `specs/AUDIT-2026-08-26-src.md` finding **B1** (HIGH, VERIFIED).

## Problem

Rating a card "Good" while it is mid-learning (or mid-relearning) can produce
`due: NaN`, which makes the card vanish from the study queue forever with no
error, and corrupts `cards.json` on the next debounced write (`JSON.stringify`
turns `NaN` into `null`).

Root cause, identical in both schedulers:

- `Sm2Scheduler.previewLearning` (`web/src/app/core/scheduling/sm2.ts:125-148`)
  and `.previewRelearning` (`:152-177`), and the FSRS mirrors
  `FsrsScheduler.previewLearning` (`web/src/app/core/scheduling/fsrs.ts:138-167`)
  and `.previewRelearning` (`:171-197`).
- Each computes `curLeft` from the card's **persisted** `card.left`, and reads
  `opts.new.steps` / `opts.lapse.steps` / `opts.fsrs.learningSteps` /
  `opts.fsrs.relearningSteps` from the **current** deck options. If the user
  edits Options and shortens a steps array after a card has already started
  learning against the longer array, `card.left` can exceed `steps.length`.
- The `hard` branch guards this: `stepIndex = Math.max(0, steps.length -
  curLeft)` clamps the index to `>= 0` (all four functions, e.g. `sm2.ts:132`).
  The `good` branch (the common case — user rates "Good") does not:
  ```ts
  const nextLeft = curLeft - 1;
  const nextStep = steps.length - nextLeft;      // no clamp
  good = this.learningStep(card, ctx, nextLeft, steps[nextStep], 'learning');
  ```
  When `curLeft > steps.length`, `nextStep` can be negative, `steps[nextStep]`
  is `undefined`, and `due: ctx.now + undefined * 60_000` is `NaN`.
- Confirmed reproduction (steps `[1,10,60]` shrunk to `[1]`, card mid-learning
  with `left: 3`): both schedulers' `good.due` and `good.label` come back
  `NaN`. `card.left` only feeds `sm2.ts`/`fsrs.ts` (`grep` confirms no other
  consumer in `web/src/app/`), so the blast radius is these two files.
- A `NaN` `due` on a `queue: 'learning'` card fails every comparison in
  `StudyQueueService.next()` (`c.due <= ctx.now` is always `false`), so the
  card is silently unreachable — no error, no crash, just gone from the
  session.
- The live store (`data/spanish/cards.json`, 7,276 cards) has zero corrupted
  cards today — checked directly. The bug requires shortening a steps array
  while a card is actively learning against the old, longer one; that has
  apparently never happened yet on this collection, so there is nothing to
  repair, only something to prevent.

## Goals

- `previewLearning`/`previewRelearning` in **both** `sm2.ts` and `fsrs.ts`
  never produce a `due`, `left`, or any other card field that is `NaN`,
  `undefined`, or otherwise invalid, regardless of the relationship between
  `card.left` and the current steps array's length (shorter, longer, or
  unchanged).
- The fix is symmetric across all four functions (`Sm2Scheduler.previewLearning`,
  `Sm2Scheduler.previewRelearning`, `FsrsScheduler.previewLearning`,
  `FsrsScheduler.previewRelearning`) — one clamping rule, applied uniformly,
  not four ad hoc patches.
- Behaviour when `card.left <= steps.length` (the overwhelmingly common case)
  is **byte-for-byte unchanged** — every existing `sm2.spec.ts` /
  `fsrs.spec.ts` case keeps passing without modification.
- When `card.left > steps.length` (the bug's trigger condition), the card
  behaves as if it had been at the last valid step — i.e. exactly as a card
  whose `left` equals the current `steps.length` behaves. Whether that means
  "step again" or "graduate" then falls out of the existing `curLeft <= 1`
  branch rather than being decided separately, and `card.left` on every
  resulting card is `<= steps.length` so it can never re-exceed it on a later
  review.

## Non-goals (out of scope)

- No `server/` change and no on-disk shape change — this is a pure `web/src/app/core/scheduling/` bug, in scope per `CLAUDE.md`'s "scheduling lives in the frontend" rule.
- No repair/migration pass over `data/spanish/cards.json` — confirmed above there is nothing to repair.
- No change to how Options edits are validated or restricted (e.g. warning a user before they shorten a steps array with cards mid-learning). That is a separate, speculative feature; this spec only stops the corruption the existing gap can cause.
- No change to the `again`/`easy` branches — `again` always resets to `steps.length` (safe, no `curLeft` involved) and `easy` always calls `graduate` (safe, no steps array indexing). Only `hard`'s existing clamp and `good`'s missing one are in scope.
- No change to `MIN_EASE`, FSRS memory-model math, or any other scheduling constant.
- No dependency on `Math.max`/`Math.min` clamping happening anywhere other than the single point where `curLeft` is first computed from `card.left` — i.e. fix it once at the source per function, not by adding a second clamp downstream at each call site (that would leave the same trap for the next person who adds a fifth call site).

## Requirements (numbered, testable)

R1. For every one of the four preview functions, when `card.left <=
    steps.length` (including `card.left` absent/0, which already means
    "start fresh"), all four rating outcomes (`again`, `hard`, `good`, `easy`)
    are numerically identical to their current (pre-fix) output — pin this
    with the existing spec files unmodified plus new cases at the boundary
    (`card.left === steps.length` exactly).

R2. For every one of the four preview functions, when `card.left >
    steps.length` (simulating a steps array shortened after the card started
    learning), rating **any** of the four buttons produces a card whose
    `due`, `left`, `interval`, `ease`/`stability`/`difficulty` are all finite
    numbers (`Number.isFinite`) — never `NaN`, never `undefined`.

R3. The clamp is applied once per function, where `curLeft` is derived from
    `card.left`, and constrains it to the closed range `[1, steps.length]`.
    That range is what makes every steps-array index in all four branches
    valid *by construction*: `stepIndex = max(0, steps.length - curLeft)`
    lands in `[0, steps.length-1]`, and in the `good` branch `curLeft >= 2`
    forces `nextStep = steps.length - (curLeft - 1)` into
    `[1, steps.length-1]`. No second, downstream clamp is added.

    Concretely, with `opts.new.steps` shortened from `[1, 10, 60]` to `[1]`
    and a card at `left: 3` (clamped `curLeft` = 1):
    - `again.card.due === ctx.now + 1 * 60_000`, `again.card.left === 1`
    - `hard.card.due === ctx.now + 1 * 60_000`, `hard.card.left === 1`
    - `good` **graduates** — the clamped `curLeft` is 1, so the existing
      `curLeft <= 1` branch fires: `good.card.type === 'review'`,
      `good.card.interval === opts.new.graduatingInterval`,
      `good.card.due === ctx.today + 1`
    - `easy` graduates with `easyInterval` (unchanged, never indexed `steps`)

    And with steps shortened to `[1, 10]` (more than one step remaining) and
    a card at `left: 3` (clamped `curLeft` = 2): `good` steps to the *last*
    step — `good.card.due === ctx.now + 10 * 60_000`, `good.card.left === 1`.

R4. Every card returned by the four preview functions has
    `left <= steps.length`, so a stale, too-large `left` cannot be carried
    forward into a subsequent review. Under R3's clamp this is automatic
    (`again` passes `steps.length`, `hard` passes `curLeft`, `good` passes
    `curLeft - 1`) and needs no separate code — but it is asserted
    independently, because it is the property that stops the corruption from
    being merely deferred by one review instead of fixed.

R5. `StudyQueueService.next()` and any other `card.due` consumer needs no
    change — R1-R4 make the invalid state unreachable at the source, which is
    the fix the audit recommends over patching every downstream consumer.

## How do we know it is done

- New test cases in `sm2.spec.ts` and `fsrs.spec.ts` (one file already exists
  for each — extend, don't replace) reproducing the audit's exact repro
  shape (steps `[1,10,60]` → `[1]`, `card.left: 3`) for both `previewLearning`
  and `previewRelearning`, asserting R2 and R3 for `again`/`hard`/`good`/`easy`.
  These must **fail against the current code** before the fix lands (the
  planner/critic should confirm this by running them against `main` first, or
  by inspection of the existing unclamped line).
- Full `npm run test -w web` green, with the new cases counted in the total
  (was 187 after the audit's Small fixes; report the new total).
- `npm run build -w web` clean (strict mode is now on — see the audit's T2,
  already applied).
- Manual `grep` confirms the fix is a single clamp per function (four call
  sites total: `sm2.ts` ×2, `fsrs.ts` ×2), not a patch scattered across
  `learningStep`/`stepResult` or the queue service.
- `git status` clean outside the intended files
  (`sm2.ts`, `fsrs.ts`, `sm2.spec.ts`, `fsrs.spec.ts`) before the final
  wrap-up step touches `specs/STATE.md`.

## Retrospective

_Filled in 2026-08-26, after the 8-step run._

**Outcome.** All 8 steps executed in order, no step left the repo red. Web suite
187 → 203 (16 new tests across 4 files); server 38, unchanged — no `server/`
file was touched, as the non-goals required. Final root `npm run test` and
`npm run build` both green. The fix is 6 lines of production code: one 4-line
helper plus one changed line in each of the four preview functions.

**Did `Analyst.md` catch anything not thought about up front?**

Yes — R3's own correction. The original R3 claimed that when `left` is clamped
to a single remaining step, Good should *step* rather than graduate. That is
wrong: clamping to `curLeft = 1` makes the existing `curLeft <= 1` branch fire,
so Good **graduates**. This was caught and corrected before `tasks.md` was
written, and Round 2 of `CriticReview.md` then re-verified it by executing the
arithmetic standalone rather than reasoning about it. Had it shipped as written,
Step 3 would have encoded the wrong expected behaviour into a regression test —
the worst place for it, because the test would then defend the bug.

**Did anything in `tasks.md` turn out to be wrong during coding?**

The steps themselves held up — every literal line quoted in Steps 2 and 4 was
found verbatim, the two `opts()` helper signatures differed exactly as the
**Trap** notes warned, and `setup()` was scoped inside the pause-gate `describe`
exactly as F1 predicted. Three things are worth recording:

1. **Step 3's R4 test was written with a dead branch and had to be sent back.**
   It selected its fixture with `testOpts === opts()`, a reference comparison
   against a freshly-built object — always `false`, so the relearning card was
   never exercised. It still went red under the stash proof (its other two cases
   are genuine), which is precisely what made it look finished. Rewritten as an
   explicit case table. This produced **L-006**; it is the one defect in the run
   that the prescribed verification protocol structurally could not catch.

2. **The Problem section overstates the queue harm.** It says a `NaN` `due`
   "fails every comparison in `StudyQueueService.next()`, so the card is
   silently unreachable". The first half is true; the conclusion is not. `next()`
   has a fourth branch — the "learning cards due later today" fallback — that
   filters on `queue === 'learning'` with no `due` comparison at all, so it hands
   the card back regardless. The real harm is that the card is served but can
   never become *due*, and the `NaN` is persisted to `cards.json` as `null` on
   the next debounced write. Same severity, different mechanism. R5's conclusion
   (the queue needs no change) is unaffected and still correct. Recorded in the
   `scheduling-domain` skill so the claim is not copied forward — cf. **L-001**.

3. **Step 6's scope check needed context the spec did not carry.** The working
   tree already held unrelated modifications from the audit's Small fixes
   (`transform.ts`, `review.ts`, `browser.html`, `tsconfig.json`) before this run
   began, so a literal reading of "`git status --short` lists nothing outside the
   six files" would have produced a false stop. The pre-existing set had to be
   passed to the step explicitly. A future spec that opens on a dirty tree should
   record the baseline `git status` in `Analyst.md` rather than leaving the
   checkpoint step to discover it. `data/spanish/` churn appeared mid-run as
   expected (L-002) and was reverted in Step 6.

**Design decision that held.** One shared `clampLeft` rather than four inline
clamps (AD-010). Step 6's greps confirm exactly 3 `clampLeft` references per
scheduler (one import, two call sites) and only four files mentioning it at all.
The R1 evidence is stronger than "the suite still passes": Round 2 showed that
two of the clamp's input rows *reproduce* the two existing passing tests
(`'Good on a new card advances to the second learning step (10m)'` and
`'Good on the last learning step graduates (1d)'`), so the common path provably
cannot have changed.
