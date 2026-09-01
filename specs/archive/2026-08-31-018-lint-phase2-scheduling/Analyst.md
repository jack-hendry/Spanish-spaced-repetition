# Analyst — Phase 2: `core/scheduling/` and adjacent state

Phase 2 of [`specs/archive/2026-08-31-015-typescript-lint-rollout/ROADMAP.md`](../2026-08-31-015-typescript-lint-rollout/ROADMAP.md).

Sized **Large**: every file in scope computes or consumes `card.due`, day
numbers, or scheduler state — CLAUDE.md's sizing rule puts that floor
regardless of how mechanical the individual fixes look.

*Archived summary. Full step-by-step execution log and harden-round detail
have been removed; the decisions, fixes, and findings below are the durable
record. See `specs/STATE.md` AD-021 and L-015 for the cross-phase lessons.*

## Problem

Phase 1 took `web/src` from 152 violations to 24 and gated 13 paths in CI.
The 24 remaining are exactly the files the roadmap's non-negotiable #1
quarantined from batch work: scheduling core and the files that do
`card.due` arithmetic. Phase 2's job: clear them by hand, one at a time,
each judged against `.claude/skills/scheduling-domain`, then gate all of
`web/src`.

Baseline (fresh worktree, `npm install` run first — L-013): `web/src` 24,
`server/src` 41, total 65. By file: `pause.service.spec.ts` (13),
`pause.service.ts` (4), `collection.store.ts` (3), `scheduler-factory.ts`,
`sm2.spec.ts`, `pause-shift.ts`, `heatmap.spec.ts` (1 each).

**Phase 2's file list is 24 files, not the roadmap's 16.** The attribution
glob (`core/scheduling/*` + named files, widened by Phase 1's six `card.due`
reassignments) owns 24; 16 was the count of files that had ever *carried a
violation*, which drifts from "Phase 2 owns files, not residual lint hits."
7 of the 24 carry violations; the other 17 are read against domain
invariants and gated, not edited (bounded to 5 by D7, below).

## Scope

**In:** fix all 24 violations across 7 files (none autofixed unattended);
review the 5 `card.due`/day-number files among the 17 clean ones against
`scheduling-domain`; gate all of `web/src` as one path; re-baseline
`INVENTORY.md` and tick `ROADMAP.md`.

**Out:** `server/src` (Phase 3); the full-repo gate (Phase 4); any rule
change — no loosening, no tightening, no `eslint-disable`; any behaviour
change to scheduling — where a violation can't be fixed without one, it's
recorded, not forced; renaming `scheduler-factory.ts` (D4 changes the
export, not the filename); fixing anything the D7 review finds (written to
Discovered, not fixed here — this is a lint phase).

## Decisions

**D1 — No rule relaxed.** All 24 violations are genuine (none is the
"compliant edit is the broken edit" trap L-014 records against `eqeqeq`).
`no-unsafe-*`/`no-explicit-any` stay on in test files — turning them off
would clear 9 of `pause.service.spec.ts`'s 13 for free, but that test pins
the pause/resume `card.due` shift, and an `any`-typed mock is exactly the
mechanism by which it would keep passing after a payload shape drifted.

**D2 — `Map.has()` + `Map.get()!` → one lookup.** Two sites
(`collection.store.ts:227`, `pause.service.ts:92`) mirror server writes into
cached cards via `has(id) ? {...c, x: get(id)!} : c`. The Map's value type
never includes `undefined`, so one `get()` tested against `undefined` is
equivalent and needs no assertion. Same class as Phase 1's
`template-renderer.ts` fix: the guard was live, the type was lying.

**D3 — `pause-shift.ts`'s `pausedAt!` becomes a parameter.**
`computeResumeCardUpdates` asserted a precondition (`coll.pausedAt!`) that
its caller already holds narrowed. Chosen fix: take `pausedAt: number` as a
parameter instead of guarding-and-returning or guarding-and-throwing — both
alternatives add an untested branch for a case that cannot happen. This
mattered: with `pausedAt` null, `todayNumber(coll, null)` and
`resumedAt - null` (coerces to 0) would shift every learning card's `due` by
the *entire epoch* — the worst possible `card.due` corruption, currently
prevented only by the caller's guard and a comment. 8 call sites in
`pause-shift.spec.ts` + 1 in `pause.service.ts` updated; no test's meaning
changed.

**D4 — `SchedulerFactory` (class, one static method) → `schedulerFor()`
(function).** `no-extraneous-class` was pointing at a real deviation from
`angular-conventions` ("scheduling is a plain exported function in
`core/*.ts`"). Two call sites in `features/review/review.ts` updated — the
one edit in this phase that reaches outside the Phase 2 file list,
deliberately: renaming to preserve the class shape would satisfy the rule
while keeping the deviation it caught.

**D5 — Test-file fixes type the mock, not silence the rule.**
`pause.service.spec.ts`'s 9 `no-unsafe-*` hits all trace to
`} as unknown as ApiService`, which erases the mock's real types. Fix: keep
typed handles to the `vi.fn()` mocks, returned from `setup()`, so
`.mock.calls[0][0]` carries the real parameter type. Verified as a real fix
(not a silenced rule) by an actual experiment: renaming
`ApiService.resume`'s payload field broke this spec at compile time.

**D6 — CI gate becomes `web/src`, one path**, replacing the 13-path list —
picks up nine files Phase 1 never gated (clean but never added, since Phase
1 sized batches by violation count) and covers any new file on creation.

**D7 — Zero-violation review bounded to 5 files, produces notes not
edits.** Reading all 17 clean Phase-2 files is an audit this spec isn't
scoped for. Bounded to the 5 doing `card.due`/day-number arithmetic:
`stats.ts`, `heatmap.ts`, `study-queue.service.ts`, `collection.store.ts`,
`scheduling/learning-steps.ts`. Findings go to Discovered/Quick Tasks;
nothing found this way is fixed inside this spec.

## The 24 fixes

| # | Site | Rule | Fix |
|---|---|---|---|
| 1 | `sm2.spec.ts:266` | `array-type` | `Array<T>` → `T[]`. |
| 2 | `heatmap.spec.ts:70` | `no-unsafe-argument` | `Array(12).fill(ts)` (→`any[]`) → `Array.from({length:12}, () => ts)`, typed `number[]`. |
| 3–4 | `pause.service.spec.ts:61,62` | `no-confusing-void-expression` | Add braces around `beforeEach` arrow body. |
| 5 | `collection.store.ts:227` | `no-non-null-assertion` | D2. |
| 6 | `pause.service.ts:92` | `no-non-null-assertion` | D2. |
| 7–8 | `collection.store.ts:208` | `strict-boolean-expressions`, `prefer-nullish-coalescing` | `(id && byId(id)) \|\| deckOptions()[0]` → `(id != null ? byId(id) : undefined) ?? deckOptions()[0]`. |
| 9 | `scheduler-factory.ts:10` | `no-extraneous-class` | D4. |
| 10–11 | `pause.service.ts:47,68` | `prefer-optional-chain` | `!coll \|\| coll.pausedAt == null` → `coll?.pausedAt == null`. |
| 12 | `pause.service.ts:100` | `restrict-plus-operands` | `KEY_PREFIX + pausedAt` → template literal. |
| 13 | `pause-shift.ts:19` | `no-non-null-assertion` | D3. |
| 14–15 | `pause.service.spec.ts:98,147` | `restrict-plus-operands` | Same as #12. |
| 16–24 | `pause.service.spec.ts` (9 sites) | `no-unsafe-*` | D5 — type the mocks. |

Only 5 of the 24 were `--fix`-able; the rest were hand work.

## D7 review pass — the five arithmetic files

Read against `scheduling-domain`: `card.due`'s unit chosen by `card.type`
not `card.queue`; day numbers only via `todayNumber()`; learning `due`
(epoch ms) never compared to a day number; `card.left` clamped before
indexing a steps array. **Nothing found here was fixed** (lint phase, not a
bug-fix phase).

| File | Verdict |
|---|---|
| `core/stats.ts` | No correctness finding. Structural note: day-bucketing helpers take `reviewDays: number[]` that callers must have already mapped through `todayNumber` — nothing in the type distinguishes a day number from an epoch-ms timestamp, so the wrong unit would be silent. Same unenforced-precondition class D3 removed from `pause-shift.ts`, but weaker (convention, not assertion). |
| `core/heatmap.ts` | **Finding (docs).** Correctly keys by local calendar date shifted by `dayCutoffHour`, not `todayNumber` — exactly what `specs/archive/2026-07-14-007-heatmap-date-off-by-one` fixed. But `scheduling-domain` says the opposite ("heatmap buckets... must go through `todayNumber`, never calendar dates"). The code is right; the skill is stale. → skill Lessons append + Quick Tasks. |
| `core/study-queue.service.ts` | No finding. Unit discipline exact (`c.due <= ctx.now` for learning, `c.due <= ctx.today` + `type==='review'` for review). Minor: `start()`/`startAll()` fall back to `today=0` if `collection()` is null — unreachable in practice. |
| `core/collection.store.ts` | No finding. `todayNumber` matches the skill exactly; `ownCounts` uses the same triple-filter as the study queue. |
| `core/scheduling/learning-steps.ts` | No finding; `clampLeft` precondition (`stepCount >= 1`) re-verified — all four call sites still guard the array first. |

**Second finding (dead code).** `stats.ts`'s `yearlyHeat` has no non-test
consumer (`grep -rn "yearlyHeat" web/src` hits only its declaration, two
doc comments, its spec) — the live heatmap goes through `heatmap.ts`'s
`buildHeatGrid`. Not deleted; recorded.

## Result

`web/src` **24 → 0** (stepped 24→20→18→16→15→12→11→0, re-measured each
step); `server/src` unchanged at **41**; repo **65 → 41**. `lint:ci` is the
single path `web/src`; `ci.yml`'s comment updated. 280 tests (71 server +
209 web), build, and `format:check` green throughout — unchanged from first
step to last. 9 source files modified; the only one outside the Phase 2
file list is `features/review/review.ts` (D4's two call sites).
`computeResumeCardUpdates` has no `!` assertion; `pause.service.spec.ts` has
no `as unknown as` cast and the drift experiment (D5) confirmed the fix is
real. No rule in `eslint.config.mjs` changed; no `eslint-disable` added
anywhere in `web/src`.

**Retrospective, condensed:** no `tasks.md` step needed rewriting during
execution — every risky claim (optional-chain narrowing, the mock retype,
a `no-unnecessary-condition` call) was run and reverted during the harden
pass rather than reasoned about, which is why coding produced no surprises
(cf. L-016, recorded from Phase 3 where the opposite happened). The
carry-forward finding: `npm run lint:ci`'s exit code can't prove its own
scope changed — it's 0 whether or not a step actually widens the gate,
since everything already covered stays clean. Both this phase and Phase 1
had to assert on the script's *text* instead. → **L-015**.
