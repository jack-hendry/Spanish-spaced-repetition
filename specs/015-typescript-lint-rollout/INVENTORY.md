# TypeScript Lint Inventory — Phase 0 audit

Phase 0 captured the baseline: all violations in both workspaces, rule by rule and directory by directory.

**Generated:** 2026-08-28 | **Reproduce:** `npm run lint:json`

## Tool versions

```
eslint:             10.9.1
typescript-eslint:  8.68.0
angular-eslint:     22.1.0
@eslint/js:         10.0.1
typescript (root):  6.0.3
typescript (server): 5.9.3
typescript (web):   6.0.3
```

## Totals

| Workspace | Violations |
|-----------|-----------|
| server/src | 102 |
| web/src | 152 |
| **Total** | **254** |

## By rule (25 rules)

| Count | Server | Web | Rule |
|-------|--------|-----|------|
| 79 | 52 | 27 | @typescript-eslint/no-non-null-assertion |
| 43 | 14 | 29 | @typescript-eslint/restrict-template-expressions |
| 20 | 8 | 12 | @typescript-eslint/strict-boolean-expressions |
| 19 | 4 | 15 | @typescript-eslint/no-unnecessary-condition |
| 18 | 13 | 5 | @typescript-eslint/no-confusing-void-expression |
| 11 | 1 | 10 | eqeqeq |
| 8 | 0 | 8 | @typescript-eslint/no-unsafe-member-access |
| 7 | 0 | 7 | @typescript-eslint/no-empty-function |
| 6 | 0 | 6 | @typescript-eslint/unbound-method |
| 4 | 3 | 1 | @typescript-eslint/no-misused-promises |
| 4 | 1 | 3 | @typescript-eslint/restrict-plus-operands |
| 4 | 0 | 4 | @typescript-eslint/require-await |
| 4 | 0 | 4 | @typescript-eslint/no-unsafe-assignment |
| 3 | 3 | 0 | @typescript-eslint/no-misused-spread |
| 3 | 2 | 1 | @typescript-eslint/use-unknown-in-catch-callback-variable |
| 3 | 0 | 3 | @typescript-eslint/prefer-optional-chain |
| 3 | 0 | 3 | @typescript-eslint/prefer-nullish-coalescing |
| 3 | 0 | 3 | @typescript-eslint/no-extraneous-class |
| 2 | 1 | 1 | complexity |
| 2 | 0 | 2 | @typescript-eslint/no-unsafe-call |
| 2 | 0 | 2 | @typescript-eslint/no-explicit-any |
| 2 | 0 | 2 | @typescript-eslint/array-type |
| 2 | 0 | 2 | @angular-eslint/template/eqeqeq |
| 1 | 0 | 1 | @typescript-eslint/no-unsafe-return |
| 1 | 0 | 1 | @typescript-eslint/no-unsafe-argument |

**Rule table sum: 254** ✓

## By directory (14 buckets)

| Violations | Directory |
|-----------|-----------|
| 68 | web/src/app/features/ |
| 44 | web/src/app/core/ (other) |
| 32 | server/src/routes/ |
| 22 | web/src/app/core/scheduling/ |
| 22 | server/src/import/ |
| 17 | server/src/store/ |
| 16 | other server/src/*.ts |
| 10 | server/src/middleware/ |
| 7 | web/src/app/core/templating/ |
| 5 | server/src/cards/ |
| 3 | web/src/app/shared/ |
| 4 | other web/src/app/*.ts |
| 2 | other web/src/*.ts |
| 2 | web/src/app/**/*.html |

**Directory table sum: 254** ✓

## Test files

Test files (`.spec.ts` / `.test.ts`) carry **140 of 254 violations** (55%). The top 5 rules in tests:

| Violations | Rule |
|-----------|------|
| 65 | @typescript-eslint/no-non-null-assertion |
| 12 | @typescript-eslint/no-unnecessary-condition |
| 8 | @typescript-eslint/restrict-template-expressions |
| 8 | @typescript-eslint/no-unsafe-member-access |
| 8 | @typescript-eslint/no-confusing-void-expression |

Non-test files carry **114 violations**. Whether to relax rules for test files is a **Phase 1 and Phase 3 decision**, not made here.

## Phase attribution

| Phase | Files | Violations | Note |
|-------|-------|-----------|------|
| Phase 2 (scheduling core) | 10 | 31 | `core/scheduling/`, `collection.store.*`, `study-queue.service.*` |
| Phase 1 (web/src other) | 25 | 121 | features, other core, shared, app-level components |
| Phase 3 (server/src) | 16 | 102 | routes, store, import, middleware, cards, other |
| **Total** | **51** | **254** | |

### Phase 2 files (by name)

1. **web/src/app/core/scheduling/fsrs.spec.ts** — 11 violations
   - Rules: @typescript-eslint/no-non-null-assertion

2. **web/src/app/core/scheduling/format.ts** — 5 violations
   - Rules: @typescript-eslint/restrict-template-expressions

3. **web/src/app/core/collection.store.ts** — 4 violations
   - Rules: @typescript-eslint/no-non-null-assertion, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions, eqeqeq

4. **web/src/app/core/collection.store.spec.ts** — 3 violations
   - Rules: @typescript-eslint/no-non-null-assertion

5. **web/src/app/core/study-queue.service.ts** — 2 violations
   - Rules: eqeqeq

6. **web/src/app/core/scheduling/fsrs-optimize.spec.ts** — 2 violations
   - Rules: @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions

7. **web/src/app/core/scheduling/sm2.ts** — 1 violation
   - Rules: @typescript-eslint/restrict-template-expressions

8. **web/src/app/core/scheduling/sm2.spec.ts** — 1 violation
   - Rules: @typescript-eslint/array-type

9. **web/src/app/core/scheduling/scheduler-factory.ts** — 1 violation
   - Rules: @typescript-eslint/no-extraneous-class

10. **web/src/app/core/scheduling/fsrs.ts** — 1 violation
    - Rules: @typescript-eslint/restrict-template-expressions

**Phase 2 files are never counted as Phase 1 batch work, no matter how mechanical their violations look (ROADMAP non-negotiable #1).**

### One deliberate widening of the rule

The attribution rule as written in `specs/016-lint-audit/tasks.md` names
`collection.store.ts` and `study-queue.service.ts`. Applied strictly it gives
**9 files / 28 violations**; the table above says 10 / 31. The difference is
`collection.store.spec.ts` (3 violations), pulled into Phase 2 during
execution.

Kept, because the strict reading is the worse one: it would leave a Phase 1
batch free to rewrite the test that pins a Phase 2 file's behaviour, which
defeats the point of quarantining that file. The `*.spec.ts` of a Phase 2
file belongs with its subject.

Recorded rather than absorbed silently, because a mechanical rule that gets
quietly widened stops being mechanical. **For Phases 1–3 the rule now reads:
any file under `core/scheduling/`, plus `collection.store.*` and
`study-queue.service.*` — the glob, not just the `.ts`.** Under that reading
the table above is exact.

## Re-baseline (2026-08-28, Phase 1)

**IMPORTANT:** These counts only reproduce from a tree with `node_modules` installed. Measured from a fresh worktree without them, type-aware rules silently stop firing and the total comes back 249 — plausible, reproducible, and wrong. **Run `npm install` before measuring; a tree without `node_modules` under-reports by 5 in `web/src`.**

The original inventory recorded 254 total violations (152 `web/src` + 102 `server/src`) as of `origin/main` @ 66b1d70. After Step 1's calibration to the ESLint ruleset, that baseline has been re-verified and confirmed.

### Post-calibration violations by phase

Step 1 (calibration) and the widening of Phase 2's attribution rule (documented below) result in the following re-distribution:

| Phase | Baseline | After calibration | After Phase 2 reassignment |
|---|---|---|---|
| Phase 1 | 121 | — | **50** |
| Phase 2 | 31 | — | **24** |
| Phase 3 | 102 | 41 | 41 |
| Total | 254 | 115 | 115 |

(`web/src` post-calibration total is 74; the Phase 1 / Phase 2 split of that 74 appears in the last column.)

### Second widening of the attribution rule

The Phase 2 attribution rule was initially: files under `core/scheduling/`, plus `collection.store.*` and `study-queue.service.*`. Applied mechanically, this gave 10 files / 31 violations. As documented in the section above ("One deliberate widening"), the spec widened it during execution to include test files (`*.spec.ts`) of Phase 2 subjects.

The rule now widens again. CLAUDE.md's task-sizing language states that anything touching `card.due` or day-number math is **at least** Large regardless of file count. This enlarges the Phase 2 surface to include files whose lint hits are directly about card scheduling arithmetic:

| File | Baseline | After calibration |
|---|---|---|
| `core/pause.service.spec.ts` | 19 | 13 |
| `core/pause.service.ts` | 8 | 4 |
| `core/stats.ts` | 2 | 0 |
| `core/pause-shift.ts` | 1 | 1 |
| `core/heatmap.ts` | 1 | 0 |
| `core/heatmap.spec.ts` | 1 | 1 |
| **Reassigned subtotal** | **32** | **19** |

Note: `core/pause-shift.ts`'s single violation is the `coll.pausedAt!` non-null assertion, guarding a `card.due` calculation. Additionally, `core/stats.ts` and `core/heatmap.ts` have **zero** violations after calibration and are reassigned for their content — both perform `card.due` and day-number arithmetic — not for their lint hits. This exemplifies why Phase 2 owns files rather than violation counts.

These six files move entirely into Phase 2. The reassignment is a reporting change, not remediation; Phase 2 will review these files for correctness, not work down the residual lint hits.

**Reconciliation against the headline numbers:**
- Baseline decomposition: Phase 1 121 − 32 = 89; Phase 2 31 + 32 = 63.
- After calibration: Phase 1 50 + Phase 2 24 = 74 = the `web/src` post-calibration total.

**Phase 2's file list is now 16 files, not 10.** Phase 0 did count all six — its totals are correct and unchanged — but attributed them to Phase 1, because its attribution rule was textual (`core/scheduling/` plus two named files) rather than behavioural. The ROADMAP's Phase 2 checkpoint must reflect this expansion before Phase 2 opens.

## Final (2026-08-31, Phase 3 complete)

Every phase has landed. Measured with `node_modules` installed (see the
2026-08-28 warning above — a tree without them under-reports):

| Workspace | Baseline | After calibration | Final |
|---|---|---|---|
| `web/src` | 152 | 74 | **0** |
| `server/src` | 102 | 41 | **0** |
| **Total** | **254** | **115** | **0** |

Phase attribution, closed out:

| Phase | Spec | Surface | Result |
|---|---|---|---|
| 0 | `016-lint-audit` | audit only, no code | baseline 254 recorded |
| 1 | `017-lint-phase1-web` | non-scheduling `web/src` | 121 → 0 (139 of the 254 removed repo-wide by calibration alone) |
| 2 | `018-lint-phase2-scheduling` | `core/scheduling/` + adjacent, 24 files | 24 → 0 |
| 3 | `019-lint-phase3-server` | `server/src`, 11 files | 41 → 0 |

**Phase 3's 11 files** (post-calibration counts): `import/transform.ts` 10,
`routes/index.ts` 6, `app.ts` 5, `middleware/auth.test.ts` 5,
`app.integration.test.ts` 3, `index.ts` 3, `middleware/auth.ts` 3,
`routes/notes.integration.test.ts` 2, `routes/resume.integration.test.ts` 2,
`import/cli.ts` 1, `store/seed.test.ts` 1.

The five files Phase 0 attributed to Phase 3 that calibration alone took to
zero — including `store/file-store.ts`, the roadmap's "extra care" file — were
never edited. They are gated now regardless, because the gate names the
directory rather than a list of remediated files (Phase 2's D6, carried into
Phase 3's D3).

**The gate is `eslint web/src server/src`.** Phase 4 owns what is left: the
repo root, `tools/`, and `web/src/index.html`.

## Phase 2 exit (2026-08-31)

Phase 2 completed all 14 steps, fixing violations across the seven scheduling-core files carrying them. Final counts:

| Workspace | Phase 1 → Phase 2 | Phase 2 exit |
|-----------|---|---|
| `web/src` | 24 | **0** |
| `server/src` | 41 | **41** (unchanged) |
| **Total** | **65** | **41** |

All of `web/src` is now gateable via a single directory path `eslint web/src` in CI, replacing the incremental 13-path list from Phase 1. Notably, Phase 2's file list expanded to **24 files, not 16** as initially stated in the roadmap. The difference: the attribution glob `core/scheduling/*` plus named files owns 24 files total; only 7 of those carried violations. Phase 2 reviews files, not residual lint hits, so the other 17 zero-violation files are confirmed clean and gated as part of the `web/src` gate. The roadmap's 16-file number was the count of files that *ever carried a violation* (10 from Phase 0, plus 6 reassigned by Phase 1); this inventory now records the correct count that the glob actually owns.

