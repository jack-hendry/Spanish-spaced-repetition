# Analyst — Phase 1: non-scheduling `web/` lint remediation

Phase 1 of [`specs/015-typescript-lint-rollout/ROADMAP.md`](../015-typescript-lint-rollout/ROADMAP.md).
Sized **Large** — it changes shared lint configuration (affecting all three
phases), edits ~14 files across `core/` and `features/`, and adds a CI gate.

## 1. What problem are we solving?

Phase 0 stood ESLint up report-only and produced an inventory: 254 violations,
of which 121 in 25 non-scheduling `web/src` files were attributed to Phase 1.
Nothing is gated in CI yet, so none of it is enforced.

Phase 1's job is to make the non-scheduling half of `web/` actually clean and
put it behind a CI gate, without either (a) letting a mechanical fix change
behaviour, or (b) shipping a red gate.

### What re-measuring the baseline found

The inventory was taken as read and then re-derived from a clean checkout
before planning. Four things came out of that, and they reshape the phase:

**(a) The published baseline is 5 violations high.** `npm run lint:json` on a
clean `origin/main` (66b1d70) reports **249**, not 254. The difference is
uncommitted work-in-progress in the checkout Phase 0 ran in —
`review.spec.ts` (+4) and `deck-list.spec.ts` (+1). Phase 1's real committed
baseline is **116**, not 121. Every number below is measured on a clean
checkout.

**(b) `npm run lint` lints stale worktrees.** `eslint.config.mjs`'s `ignores`
list has no `.claude/worktrees/**` entry, so a leftover worktree gets linted as
a second copy of the repo. At time of writing that inflated a local run by 102
phantom violations. CI is unaffected (fresh checkout), but every local run and
every count taken from one is wrong while a worktree exists.

**(c) Three rules are miscalibrated for this codebase, and one of them makes a
behaviour-changing "fix" the officially correct action.** Detail in §4 (D1).
This is the finding that matters most: `eqeqeq: ['error', 'always']` flags
`coll.pausedAt != null` in `pause.service.ts`, `app.ts`, `review.ts`,
`deck-list.ts` and `deck-list.html`. Every single `eqeqeq` violation in
non-test Phase 1 code is the deliberate null-and-undefined idiom. An executor
told to "fix the eqeqeq violations" produces `!== null`, which stops matching
`undefined` — a live bug in the pause toggle, introduced by a lint fix, in
exactly the mechanical-batch way the roadmap's non-negotiable #1 was written to
prevent. It just happens to sit in a file the textual attribution rule did not
label scheduling-core.

**(d) Phase 0's phase-attribution rule under-captures the scheduling
surface.** The rule is textual — `core/scheduling/` plus `collection.store.*`
and `study-queue.service.*`. But CLAUDE.md's own sizing rule says *anything*
touching `card.due` or day-number math is at least Large. Files sitting in the
Phase 1 list that do exactly that:

| File | What it does | Phase 1 violations |
|---|---|---|
| `core/pause-shift.ts` | Computes new `card.due` for every card on resume — day-number for `review`, epoch-ms for `learning`/`relearning` | 1 (`pausedAt!`) |
| `core/pause.service.ts` | Orchestrates the resume write; reads/writes `pausedAt` | 8 |
| `core/pause.service.spec.ts` | Pins the above | 19 |
| `core/heatmap.ts` | `dayCutoffHour` date-key math — subject of `2026-07-14-007-heatmap-date-off-by-one` | 1 |
| `core/heatmap.spec.ts` | Pins the above | 1 |
| `core/stats.ts` | `card.due - today` arithmetic; already the subject of one `card.type`-vs-`card.queue` bug (Quick Tasks, 2026-08-26 B2) | 2 |

`pause-shift.ts`'s single violation is the `pausedAt!` non-null assertion — the
exact thing a batch would be told to remove.

## 2. What is in scope?

1. **Calibrate the ruleset** (`eslint.config.mjs`), on evidence, before any
   code edit. Decisions D1–D3 in §4.
2. **Re-baseline `INVENTORY.md`** so the recorded numbers match a clean
   checkout under the calibrated ruleset, for all three phases — not just
   Phase 1's.
3. **Reassign the six files in §1(d) to Phase 2**, and record the widened
   attribution rule in `INVENTORY.md` alongside the existing widening it
   already documents.
4. **Fix the residual Phase 1 violations** — 45 across 13 files after
   calibration and reassignment — in directory batches.
5. **Gate each batch's directory in CI** as it goes clean, via an explicit
   path list mirroring `ruff.toml`'s `include`.
6. Add `.claude/worktrees/**` to the ESLint `ignores` list.

## 3. What is OUT of scope?

- **Any file reassigned to Phase 2**, and any file already in Phase 2. They
  are not edited by this spec at all. Their violation counts changing as a
  side effect of D1–D3 is expected and is re-baselined in `INVENTORY.md`, but
  no scheduling file's *code* is touched here.
- **`server/src`** — Phase 3. D1–D3 change its counts (102 → 41); that is
  re-baselined, not remediated.
- **The full-repo gate** — Phase 4. This spec gates only directories it makes
  clean.
- **a11y / `templateAccessibility`** — explicitly deferred by the roadmap.
- **New rules.** Calibration here only ever *loosens* an existing rule's
  options or scopes it away from test files. Adding rules is Phase 4.
- **Behaviour changes.** Every edit must be behaviour-preserving. Where a
  violation cannot be fixed without changing behaviour, it is recorded, not
  fixed.
- **Refactoring beyond the violation.** `review.ts`'s `onKey` complexity fix is
  a decomposition, not a redesign of the key handling.

## 4. Decisions

### D1 — `eqeqeq` gets `{ null: 'ignore' }` (both the TS and template rules)

**Non-optional.** All 7 non-test `eqeqeq` violations and both
`@angular-eslint/template/eqeqeq` violations are `== null` / `!= null`.
`x != null` deliberately matches null *and* undefined; `x !== null` does not.
Leaving the rule as-is makes the behaviour-changing edit the compliant one.
`{ null: 'ignore' }` keeps the rule's real value (catching `==` between
non-null operands) and drops the trap.

Applies to `@angular-eslint/template/eqeqeq` too, via
`{ allowNullOrUndefined: true }` — `deck-list.html` has the same idiom in a
binding, and the template rule is configured separately from the TS one.

### D2 — `restrict-template-expressions` gets `{ allowNumber: true }`

All 43 violations repo-wide (21 of them Phase 1) are `Invalid type "number"` —
i.e. `${someNumber}` in a template literal. `strictTypeChecked` sets
`allowNumber: false`; typescript-eslint's own default is `true`. Rewriting 43
sites to `${String(n)}` adds noise and removes no ambiguity: number→string
interpolation has exactly one sensible meaning. The rule keeps its teeth on
the cases that matter (`any`, nullish, objects, `never`).

### D3 — Five rules off for `*.spec.ts` / `*.test.ts` only

`no-non-null-assertion`, `unbound-method`, `no-empty-function`,
`no-extraneous-class`, `require-await`.

Each is a rule whose premise doesn't hold in a test: `x!.y` in a test *is* an
assertion and fails loudly when wrong; `unbound-method` fires on spy
references; `() => {}` is a stub; a stub component is a class with no members;
an `async` test with no `await` is normal. 55% of the repo's violations are in
test files and this is the honest part of that.

**Deliberately kept on in tests** — the ones where the premise *does* hold:
`no-unsafe-*` and `no-explicit-any` (an `any`-typed mock hides a real contract
drift), `no-unnecessary-condition` (a redundant guard in a test signals a
misunderstanding of the type), `strict-boolean-expressions`, `eqeqeq`. See
§5.1 for the open question this leaves.

### D4 — `strict-boolean-expressions` is NOT relaxed

Tempting (11 non-test violations, all `string | undefined` or nullable-boolean
conditionals) and it would clear them for free. Rejected: the roadmap names
this rule explicitly as a Phase 0 target, and loosening a named rule
immediately after adopting it is making the number go down rather than making
the code better. The 11 sites are few and each fix is a small, genuine
gain in explicitness. One of them (`review.ts:135`, "condition is always
true") is a real finding — a runtime guard the type system thinks is dead.

### D5 — Calibration is global, but Phase 2's file list is not

D1–D3 are single edits to a shared config; they cannot be scoped to Phase 1's
files. They drop Phase 2 from 31 violations to 5. That is *not* Phase 1 doing
Phase 2's work: a relaxation removes a report, it cannot introduce a defect,
and no scheduling file is edited. **Phase 2 still owns its full file list —
now 16 files, not 10 — and reviews those files, not just their remaining lint
hits.** Recorded in `INVENTORY.md` so the drop is never mistaken for progress.

### D6 — CI gating uses an explicit path list, not a config `include`

ESLint flat config has no `include`. The analogue is a `lint:ci` script naming
the clean directories, run in `ci.yml`. Directory paths, so a new file in a
gated directory is covered automatically. `npm run lint` stays full-repo and
report-only until Phase 4 collapses the two.

## 5. Measured effect

Clean checkout, `origin/main` @ 66b1d70:

| Config | Phase 1 | Phase 2 | Phase 3 | Total |
|---|---|---|---|---|
| Baseline (as committed) | 116 | 31 | 102 | 249 |
| + D1 (`eqeqeq`) | 109 | 28 | 101 | 238 |
| + D2 (`allowNumber`) | 95 | 23 | 88 | 206 |
| + D3 (test relaxations) | 94 | 16 | 56 | 166 |
| **D1+D2+D3 combined** | **64** | **5** | **41** | **110** |
| …minus Phase 2 reassignment | **45** | **24** | 41 | 110 |

Calibration alone takes `app.ts`, `deck-list.ts`, `deck-list.html`,
`features/stats/stats.ts` and `shared/heatmap/heatmap.ts` to zero without a
single code edit — enough for three directories (`core/models`,
`features/stats`, `shared/`) to join the CI gate before any code is touched.

### 5.1 Open question — `no-unsafe-*` in test files

D3 keeps `no-unsafe-*` and `no-explicit-any` on in tests. Most of the fallout
lands in files reassigned to Phase 2 (`pause.service.spec.ts` alone has 13, and
`heatmap.spec.ts` 1), so it is not this spec's problem. Phase 1 keeps 4: two in
`type-answer.ts` (not a test — a real `any` leak from a regex `match`) and two
`no-explicit-any` in `review.spec.ts`. They come from `any`-typed mocks, and
fixing them properly means typing the mocks — genuinely better test code, but
real work rather than a lint tidy.

Turning them off in tests as well would drop Phase 1's residual from 45 to 43
— i.e. almost nothing, which is itself the argument for keeping them on.
Kept on, because an `any`-typed mock is the mechanism by which a test
keeps passing after the contract it mocks has changed — the one failure mode
the test suite exists to prevent. Revisit if the mock-typing work proves
disproportionate.

## 6. Residual work after calibration

45 violations, 13 files, in four batches:

| Batch | Directory | Files | Violations |
|---|---|---|---|
| B1 | `core/templating/` + `core/` leaves (`api.service.ts`, `daily-limits.ts`) | 6 | 9 |
| B2 | `features/browser/`, `features/options/` | 2 | 5 |
| B3 | app shell — `app.spec.ts`, `main.ts`, `deck-list.spec.ts` | 3 | 6 |
| B4 | `features/review/` — incl. the `onKey` complexity decomposition | 2 | 25 |

Only 8 of the 116 baseline violations are `--fix`-able, so this is hand work
throughout; no unattended autofix run is planned anywhere in this phase.

## 7. How do we know it is done?

1. `eslint.config.mjs` carries D1, D2, D3 and a `.claude/worktrees/**` ignore,
   each with a comment saying *why*, not just what.
2. `INVENTORY.md` is re-baselined: clean-checkout numbers under the calibrated
   ruleset, per phase, reconciling to the measured total; the 5-violation
   discrepancy and its cause recorded; the widened Phase 2 attribution rule
   (16 files) recorded alongside the existing widening note.
3. `npm run lint` reports **zero** violations for every directory named in
   §6's batch table.
4. `npm run lint:ci` exists, covers exactly the directories cleaned by this
   spec, and exits 0.
5. `ci.yml` runs `npm run lint:ci` in the `lint` job, and that job is green.
6. No file under `core/scheduling/`, `collection.store.*`,
   `study-queue.service.*`, or any file reassigned by §1(d) is modified —
   `git diff --name-only main..HEAD` proves it.
7. `npm run test` green: 280 tests (71 server, 209 web). `npm run build` and
   `npm run format:check` green.
8. Every behaviour-preserving claim in a batch is backed by the suite. Where a
   fix could not be made behaviour-preserving, it was left and recorded in
   §Discovered rather than forced.
9. `ROADMAP.md` Phase 1 checkboxes ticked; Phase 2's revised scope noted in its
   Discovered log.

## 8. Discovered

- (2026-08-28) The Phase 0 inventory's 254 was measured against a dirty
  checkout; clean `origin/main` gives 249. Not a Phase 0 error in method —
  `lint:json` does reproduce it — but a reminder that a baseline taken from a
  working tree is a baseline of that working tree. → **L-013**.
- (2026-08-28) `eslint.config.mjs` `ignores` was missing `.claude/worktrees/**`,
  so a local `npm run lint` linted every stale worktree as a second copy of the
  repo. Fixed in this spec's batch 0.
- (2026-08-28) The `eqeqeq`/`== null` finding (§1c) is the concrete instance of
  the risk the roadmap's non-negotiable #1 names, and it landed *outside* the
  file list that non-negotiable protects. → **L-014**.

## 9. Retrospective

*(filled in before archiving)*
