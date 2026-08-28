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

