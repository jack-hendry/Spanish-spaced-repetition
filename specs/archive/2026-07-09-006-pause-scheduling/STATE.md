# STATE: 006-pause-scheduling

> **Archived 2026-07-09, summarized 2026-08-26** during the harness migration
> (AD-009). The verbatim ~15 KB original request and the per-task decisions log
> (T001–T011, ~215 lines) were cut to bring this file under the 20 KB archive
> summary gate; `SPEC.md`, `PLAN.md` and `CRITIQUE.md` are unchanged and hold
> the full design. The request's load-bearing constraints are restated below.

## Status
- **Phase:** done
- **Last updated:** 2026-07-09

## Original request (summarized)
A **global** (not per-deck) pause toggle. While paused no cards are served for
study from any deck; browsing/editing/adding notes still works. On unpause every
eligible card's `due` shifts forward by exactly the paused duration, so studying
resumes as if no time had passed. The constraints the request pinned:

- **Architecture invariant:** the server never computes scheduling. It only
  writes the `due` values the client hands it.
- **Shift once on resume, not a second clock.** FSRS derives elapsed time as
  `ctx.today - (card.due - card.interval)`, so shifting `due` makes elapsed-time
  math, interval spacing and FSRS decay all come out right with **zero** changes
  to `todayNumber()`, `ReviewContext`, or anything under `core/scheduling/`.
- **Two delta representations,** because `due` is overloaded by queue: day-count
  (`todayNumber(resumedAt) - todayNumber(pausedAt)`) for `type === 'review'`;
  raw millisecond delta (`resumedAt - pausedAt`, no unit conversion) for
  `learning`/`relearning`. `new` cards are **never** shifted — their `due` is a
  position index. A zero or negative delta is a no-op; never decrease a `due`.
- **Dispatch on `card.type`, never `card.queue`** — `queue` becomes
  `'suspended'` on suspension, which erases the review/learning distinction, so
  a suspended review card must shift identically to a non-suspended one.
- **Same delta for every card**, not a snap-to-resume-day, so relative spacing
  is preserved. `revlog`, `interval`, `stability`, `difficulty` are untouched —
  revlog stays on real wall-clock time.
- **Ordered single endpoint.** `POST /api/collection/resume` writes cards
  **first**, then clears `pausedAt`. A crash between the two leaves `pausedAt`
  set with cards already shifted, which is the recoverable direction: the client
  retries, recomputing from the same unchanged `pausedAt`. Payloads carry
  absolute `due` values, not deltas, so re-applying converges. The reverse order
  is explicitly forbidden — it looks resumed with cards unshifted and no signal
  left to retry. Two separate HTTP calls were ruled out for the same reason.
- **Out of scope:** timezone-aware day-cutoff logic (deferred; became 010).

## Completed
- [x] Spec written / approved (human)
- [x] Plan written / approved (human)
- [x] T001 — Add `pausedAt` to the data model + seed
- [x] T002 — Pure due-shift function + spec
- [x] T003 — Study-queue pause gate + spec
- [x] T004 — Collection-store `ownCounts` gate while paused
- [x] T005 — Server resume endpoint + spec
- [x] T006 — Pause service (compute + snapshot + recover) + spec
- [x] T007 — Deck-list header toggle
- [x] T008 — App-shell banner + recovery-on-load wiring
- [x] T009 — Review paused empty state
- [x] T010 — Streak-gap test (no code change to `dayStreak`)
- [x] T011 — SKILL.md unit fix (docs only)
- [ ] Reviewed & verified (/code-review + /verify after last task)

## Drift audit (critic, 2026-07-09)
Verdict **PASS WITH NOTES** (0 blockers, 1 WARN, 2 NITs). Every touched file
matches PLAN's "Files affected" list; every Decisions-log claim cross-checked
against the actual diff and holds up; `npm run build` + `npm run test` green
(server 24/24, web 172/172). Full findings in `CRITIQUE.md`.

WARN resolved: `data/spanish/collection.json` had unrelated local-dev churn
(bumped `modified` / `lastUnburyDay` timestamps from running the dev server
during manual testing, not a code change) — reverted with `git checkout --`
before closing the feature. → **L-002**.

## Feature complete
Pause/resume implemented end-to-end: `pausedAt: number | null` on `Collection`;
pure due-shift calc (`pause-shift.ts`); study-queue + collection-store pause
gates; ordered `POST /api/collection/resume` (cards written before `pausedAt`
cleared, crash-safe via a localStorage-snapshot retry); deck-list pause/resume
toggle; app-shell "Scheduling paused" banner; paused empty state in review;
streak-gap test; SKILL.md epoch-unit fix. All 11 tasks done, colocated specs
added throughout, full suite green.

## Discovered
- `npm run build -w server` (bare `tsc -p tsconfig.json`) failed on
  `server/src/routes/resume.integration.test.ts` (added in T005) with several
  `TS2571 'Object is of type unknown'` errors (untyped `.json()` responses) and
  one duplicate-key (`id` set both explicitly and via `...over` spread in the
  `card()` test factory). Found while verifying T008; fixed directly rather than
  deferred, since `npm run build` must stay green per the testing-playbook
  definition of done. `npm run build` (full workspace) and
  `npm run test -w server` (24 tests) green afterward. Test-file-only fix.
  → **L-003**: `vitest` passing does not mean `tsc` passes; the workspace build
  type-checks test files the test runner transpiles without checking.
