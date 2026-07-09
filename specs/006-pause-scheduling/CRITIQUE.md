# CRITIQUE: 006-pause-scheduling
- **Mode:** drift
- **Date:** 2026-07-09
- **Verdict:** PASS WITH NOTES

## Findings

1. **[WARN]** `data/spanish/collection.json` is modified in the working tree
   (`modified` timestamp bumped, `lastUnburyDay` 14→15) but the change is
   **not** the addition of `pausedAt` — the on-disk file still has no
   `pausedAt` key at all — and it isn't in PLAN.md's "Files affected" list.
   This reads as incidental churn from running `npm run dev` locally while
   testing, not feature work. Runtime-harmless (`pausedAt != null` treats a
   missing key the same as `null`, since `undefined != null` is `false`), but
   it shouldn't be part of this feature's commit — revert/checkout it before
   committing.

2. **[NIT]** T005's endpoint returns `{ applied: boolean }`; SPEC R5/R6 only
   specifies "returns success" for the no-op case and doesn't define a
   response shape. STATE.md already logs this as an intentional, harmless
   addition — noted here only so the human gate sees it, not as scope creep.

3. **[NIT]** STATE.md's "Discovered" entry (untyped `.json()` responses and a
   duplicate-key test fixture breaking `npm run build -w server`) was fixed
   inline rather than deferred, which is technically what the harness's scope
   discipline asks to log-not-fix. The fix was test-file-only, required to
   keep `npm run build` green (the testing-playbook's definition of done),
   and was transparently logged with rationale — a defensible exception, not
   silent drift.

## Verification performed
- `git diff --stat` / file list: all 22 touched source files match PLAN.md's
  "Files affected" list exactly (models ×2, seed.ts, routes/index.ts,
  file-store.ts, pause-shift.ts, pause.service.ts, api.service.ts,
  study-queue.service.ts, collection.store.ts, deck-list.{ts,html,scss},
  app.{ts,html}, review.{ts,html}, SKILL.md, plus colocated specs). No
  planned file was left untouched; no unplanned source file was touched
  (only the `data/` churn in finding 1, which is data not source).
- Cross-checked every STATE.md Decisions-log entry (T001–T011) against the
  actual diff: `pausedAt: number | null` added identically to both
  `Collection` interfaces + seed default; `pause-shift.ts`'s shift rules
  (gated on `card.type`, day-delta for review, ms-delta for
  learning/relearning, `new` never included, no-op on `<=0` deltas) match
  R7–R10 exactly; the resume endpoint's cards-then-collection write order is
  real and covered by an event-order integration test, not just asserted;
  the `expectedPausedAt` guard matches R11b; `PauseService`'s
  snapshot-before-POST / re-send-never-recompute design matches D3/R11/R11a;
  the study-queue and `ownCounts` gates match R12–R14; deck-list toggle,
  app-shell banner, and review empty state match R15–R17.
- `npm run build` (server tsc + `ng build`) and `npm run test` both green:
  server 24/24 (including the new `resume.integration.test.ts`, 6 tests, and
  `seed.test.ts`), web 172/172 (including the 5 new/extended spec files).
  STATE.md's claimed test counts match what actually runs.
- Read `pause-shift.spec.ts` and `resume.integration.test.ts` in full: T1–T7b
  assertions genuinely exercise the claimed behavior (T2 explicitly asserts
  against both a ÷1000 and ×1000 unit mistake; the write-order test wraps
  `saveCards`/`saveCollection` to observe on-disk state at each write, not
  just call sequence).
- `.claude/skills/scheduling-domain/SKILL.md`: both stale "epoch seconds"
  mentions for learning-queue `due` are now "epoch milliseconds" (R19), grep
  confirms none remain.
- No STATE.md Decision contradicts a SPEC requirement or non-goal. D3's
  crash-recovery redesign was the critic's own prior plan-mode BLOCKER,
  resolved via human-directed spec revision before implementation began —
  documented, not drift.
- Checked off tasks all have present "done when" evidence: build green, the
  named spec files exist and pass, the SKILL.md grep returns nothing.
