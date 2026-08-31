# Roadmap — TypeScript lint rollout

Status: pre-spec — this is a living planning doc, not yet `Analyst.md` +
`tasks.md`. Per the [task sizing rule](../../CLAUDE.md#task-sizing-rule-sdd)
this initiative is **Large** (new tooling across both `web/` and `server/`,
plus remediation that reaches into `core/scheduling/`), so each phase below
gets its own proper spec (`Analyst.md` + `tasks.md` + harden pass) when it's
ready to execute — this doc is the map, not the plan.

## Goal

Enforce this repo's documented code-quality and house-style rules
(`.claude/skills/angular-conventions`, plus general TypeScript
maintainability) mechanically in CI, so violations are caught automatically
instead of depending on a reviewing session remembering to check them by
hand. The total remediation scope is known up front — from Phase 0's
inventory — rather than discovered incrementally, batch by batch, which is
how this kind of initiative normally turns into permanent scope creep.

## Two non-negotiables

Every phase below is judged against these.

1. **Scheduling-core fixes are never batch-mechanized.** Anything Phase 0's
   inventory flags inside `core/scheduling/`, `collection.store.ts`, or
   `study-queue.service.ts` gets pulled out of the batch work and treated as
   its own Large task — full spec, harden round, manual review — no matter
   how trivial the individual lint violation looks. This is the same rule
   CLAUDE.md already applies to any change touching scheduling, the study
   queue, or `card.due`.
2. **No red CI gate, ever.** A directory only enters the CI gate once it is
   already clean, same mechanism `ruff.toml`'s `include` list uses today. A
   lint job that's red from its first run teaches everyone to ignore it —
   see the SCOPE comment in `ruff.toml` and the Quick Tasks row in
   `specs/STATE.md` about widening it.

**Ordering rule:** Phase 0 must land before any batch remediation starts —
batch sizing in Phases 1 and 3 depends on its inventory. Phase 2
(scheduling-core) is never satisfied by Phase 1 or Phase 3's batch work,
regardless of how small it looks in the inventory.

## Phase 0 — Audit, non-gating

Stand up `typescript-eslint` for `server/`, plus `typescript-eslint` +
`angular-eslint` for `web/`, using the **full** target ruleset from the
start:

- House-style rules that encode `angular-conventions` directly —
  `angular-eslint`'s `prefer-standalone`, `prefer-inject`, no-NgModule
  rules, naming-without-suffixes if a rule covers it.
- General maintainability rules — `no-explicit-any`, `no-unused-vars`,
  complexity/cognitive-complexity caps, `strict-boolean-expressions`, or
  whatever `typescript-eslint`'s `recommended-type-checked` gives for free.

- [x] Add the eslint config and dependencies to both workspaces. Not wired
      into `ci.yml` yet — report-only.
- [x] Run it repo-wide and capture one written inventory: violation counts
      by rule and by file, for `web/` and `server/` separately.
- [x] From the inventory, explicitly flag every file under
      `core/scheduling/` (plus `collection.store.ts`,
      `study-queue.service.ts`) as Phase 2 — these never get counted as
      Phase 1 batch work, even if the fix looks like a one-line change.
- [x] Done when: the inventory is written down somewhere durable (this
      roadmap's Discovered log, or a linked file) and every remaining
      violation is attributed to a phase below — nothing left unaccounted
      for.

Inventory: [INVENTORY.md](./INVENTORY.md) — generated 2026-08-28 by `npm run lint:json`.

## Phase 1 — Non-scheduling `web/` batches

Using the Phase 0 inventory, fix violations directory-by-directory across
`web/src/app/features/` and routing/templates — deliberately excluding
anything Phase 0 flagged as scheduling-core.

- [x] Batch plan TBD — depends entirely on what Phase 0's inventory shows.
      Don't guess batch count or size here; size each batch against the
      real inventory when Phase 0 lands.
      → Executed as `specs/017-lint-phase1-web/`. Four batches, sized against
      the inventory: templating + core leaves (9), browser + options (5), app
      shell (7), review (29). Preceded by a calibration pass that removed 139
      violations with no code edited.
- [x] Gate CI incrementally per directory via the same `include`-list
      scoping `ruff.toml` uses — a directory joins the gate the moment it's
      clean, not before.
      → `npm run lint:ci` in `ci.yml`'s `lint` job. ESLint flat config has no
      `include`, so the analogue is an explicit path list in a script. It
      started at three directories (clean on calibration alone, before any
      code edit) and grew per batch to 13 paths covering all of Phase 1.

**Phase 1 is done** (2026-08-29). `web/src` 152 → 24, and the 24 that remain
are exactly the seven Phase 2 files. 280 tests unchanged throughout; no Phase 2
file edited, verified mechanically at each checkpoint.

## Phase 2 — `core/scheduling/` and adjacent state

Everything Phase 0 flagged under the first non-negotiable above.

- [x] Its own `Analyst.md` + `tasks.md` + harden round, sized Large
      regardless of how few files or how mechanical the fixes look.
- [x] **Scope widened by Phase 1: 16 files, not 10.** Six files that compute or
      write `card.due` were reassigned out of Phase 1 — `core/pause-shift.ts`,
      `core/pause.service.ts` (+spec), `core/heatmap.ts` (+spec),
      `core/stats.ts`. Two of them (`stats.ts`, `heatmap.ts`) now carry **zero**
      violations and still belong here, which is the whole point: Phase 2 owns
      files, not residual lint hits.
- [x] No autofixer run unattended here — every change reviewed against the
      invariants in `.claude/skills/scheduling-domain` (day-number math,
      permille ease, dual SM-2/FSRS state, `card.due` overloading).

**Phase 2 is done** (2026-08-31). `web/src` 24 → 0, all 14 steps executed. `server/src` unchanged at 41. The whole `web/src` directory is now gateable; CI gate moves from a 13-path list to `eslint web/src`. Total violations across both workspaces: 254 → 41 (Phase 1 + Phase 2 combined).

## Phase 3 — `server/` batches

Same batching approach as Phase 1, applied to `server/src/`.

- [x] Batch plan TBD, same caveat as Phase 1 — size against Phase 0's
      inventory, not a guess made now.
      → Executed as `specs/019-lint-phase3-server/`. 41 violations, 11 files,
      seven code steps sized by concern rather than by directory: autofix (13),
      scattered source (5), scattered test (7), `routes/index.ts` (6),
      `transform.ts` mechanical (9), `transform.ts` complexity (1), plus a
      corpus-equivalence proof step that changed no production code.
- [x] Extra care flag (not a Large-task trigger, just attention) on
      `store/file-store.ts` — debounced writes, atomic temp-file+rename —
      don't let a mechanical lint fix change write timing or ordering.
      → **Discharged by not editing it.** Phase 1's calibration had already
      taken it to zero violations, so no fix touched it. Recorded rather than
      left silent, since "the flag never fired" and "the flag was ignored" look
      identical afterwards.

**Phase 3 is done** (2026-08-31). `server/src` 41 → 0; the repo total across
both workspaces is **0**. `lint:ci` is now `eslint web/src server/src`. 280
tests unchanged from the spec's first step to its last, and the importer
refactor was proven byte-identical over the real 3,638-card corpus rather than
on the strength of its 9 unit tests.

## Phase 4 — Full gate

- [x] Once every directory in `web/` and `server/` is clean, drop the
      incremental `include`-list scoping and gate the full ruleset on every
      push, the same way `ci.yml`'s Python `lint` job already gates
      `tools/state_rotate.py`.
      → Executed as `specs/020-lint-phase4-full-gate/`. `lint:ci` is now
      `eslint .` (was `eslint web/src server/src`); `ci.yml`'s comment
      updated to match.
- [x] Confirm zero known violations remain across both workspaces before
      flipping this on. → **Confirmed 2026-08-31**: `web/src` 0 (Phase 2),
      `server/src` 0 (Phase 3).

**Phase 4 is done** (2026-08-31). `lint:ci` gates the whole repo (`eslint .`)
with zero violations, closing out `specs/015-typescript-lint-rollout/`.
Remediation was zero-diff: `eslint.config.mjs` and `tools/shoot.mjs` — the
only two JS/TS-family files at the repo root and in `tools/` — were the sole
newly-covered files, and both were clean the moment they were given a
ruleset (`js.configs.recommended` plus four hand-declared Node globals; no
type-checked preset applies since neither is covered by any `tsconfig.json`).
280 tests, the build, and `format:check` all unchanged. Of the four open
questions this phase inherited: **`web/src/index.html` is now a closed
decision** — it stays outside the gate because it is the Angular CLI's
static host shell, not a component template, and `angular-eslint`'s
template ruleset has nothing in it to check there. `noUncheckedIndexedAccess`
and the test-file `no-unsafe-*`/`no-explicit-any` question remain
deliberately open, unchanged from Phases 1 and 3 — no new evidence surfaced
here to reopen either. `templateAccessibility` remains excluded by Phase 0's
original design, also unchanged. Full reasoning:
`specs/020-lint-phase4-full-gate/Analyst.md`.

**What Phase 4 inherits**, now that both workspaces are clean:

- The **repo root and `tools/`** — the only surface `lint:ci` still does not
  name. `npm run lint` (`eslint .`) already covers it report-only.
- **`web/src/index.html`** — outside the config's `web/src/app/**/*.html`
  template glob (Phase 2's finding).
- **`noUncheckedIndexedAccess` is off** (`server/tsconfig.json`). Four of Phase
  3's violations existed *only* because an out-of-bounds array index is typed
  as present; `.at(0)` fixed them one site at a time, the flag would fix the
  class. Re-types every array index in both workspaces, so it is its own spec.
- **`no-unsafe-*` / `no-explicit-any` in test files** stay ON, unresolved from
  Phase 1 §5.1. Phase 3 inherited none of this debt — `server/src` had zero of
  those — so it is entirely a `web/` question.
- **`templateAccessibility`** — excluded from the Phase 0 ruleset by design.

## Discovered (append here as we find things)

- (2026-08-28) Roadmap created out of a discussion about whether
  `npm run lint` belongs in CI for `web/`/`server/` TypeScript alongside the
  existing `ruff` job for the Python content pipeline. Landed on: yes, but
  as a phased roadmap rather than one spec, specifically to avoid scope
  creep — Phase 0's inventory is what makes the total remediation scope
  knowable up front instead of discovered incrementally.
- (2026-08-28) Phase 0 landed as `specs/016-lint-audit/`: ESLint installed and report-only, deliberately **not** in `ci.yml`. Total violations: **254** (server 102, web 152) across 51 files and 25 distinct rules. Phase split: Phase 1 = 25 files / 121 violations; Phase 2 = 10 files / 31 violations; Phase 3 = 16 files / 102 violations. Test files carry 140 violations (55%); non-test code 114.
- (2026-08-28) **TypeScript 7 is an upgrade blocker for this whole roadmap.** `typescript@7.0.2` (the Go port) is the registry's current `latest`, and no `typescript-eslint` release supports it — `typescript-eslint@latest` still declares `typescript: >=4.8.4 <6.1.0`. The root now pins `typescript@~6.0.3` so npm cannot resolve an unconstrained peer to 7.x. Anyone moving this repo to TS 7 must check typescript-eslint support first, or the lint job dies at install time.
- (2026-08-28) `eslint-plugin-sonarjs` (cognitive-complexity) was considered and left out — core ESLint `complexity` covers the same ground at a third of the dependency surface. Revisit at Phase 4 if the `complexity` counts suggest it would add something.
- (2026-08-28) `angular-eslint`'s `templateAccessibility` config was deliberately excluded from the Phase 0 ruleset: a11y is real work but is outside what this roadmap scoped, and folding it in would have inflated the inventory with violations no phase below is written to fix. A candidate for its own spec, or for Phase 4.
- (2026-08-29) **Phase 1 landed as `specs/017-lint-phase1-web/`.** `web/src`
  152 → 24, the remaining 24 being exactly the seven Phase 2 files. 280 tests
  unchanged from first step to last; no Phase 2 file edited, checked
  mechanically by a `git diff --name-only | grep` at each checkpoint rather
  than by intention.
- (2026-08-29) **Calibrate before enforcing (AD-020).** Phase 1's first act was
  not remediation but calibration: three of 25 rules were miscalibrated for this
  codebase and carried 139 of 254 violations. `eqeqeq` → `{ null: 'ignore' }`,
  `restrict-template-expressions` → `{ allowNumber: true }`, five rules off for
  `*.spec.ts`. That alone took the repo 254 → 115 **with no code edited**, and
  made three directories gateable immediately. `strict-boolean-expressions` was
  deliberately *not* relaxed though it would have cleared 11 more free — the
  counter-example that keeps calibration from being score-gaming.
- (2026-08-29) **A lint rule made a behaviour-changing edit the compliant one
  (L-014).** Every non-test `eqeqeq` violation was the deliberate `x != null`
  idiom; the "fix" `!== null` stops matching `undefined` and breaks the pause
  toggle. It sat in `pause.service.ts` — *outside* the file list non-negotiable
  #1 protects, because Phase 0's attribution rule was textual. Phase 3 should
  assume the same class of trap exists in `server/src`.
- (2026-08-29) **`no-unnecessary-condition` is not mechanical.** Two guards in
  this phase, four steps apart, presented identically and resolved in opposite
  directions: `template-renderer.ts:63`'s guard was live and the *type* was
  lying (fixed with `Object.hasOwn`), while `review.ts:135`'s guard was
  genuinely unreachable (made honest with `audios.at(i)`, keeping it as
  defence). Only reading the call sites distinguishes them. `server/src` has 4
  of these waiting.
- (2026-08-29) **Type-aware lint counts require installed dependencies
  (L-013).** Measured from a fresh worktree with no `node_modules`, `npx eslint`
  runs but silently under-reports by 5 in `web/src` — rules needing type
  information stop firing. Phases 2 and 3 will measure from fresh worktrees:
  run `npm install` first, or every number is quietly wrong.
- (2026-08-29) **Deferred to Phase 4, unchanged:** `no-unsafe-*` and
  `no-explicit-any` remain ON in test files (Analyst.md §5.1). Phase 1 typed its
  mocks rather than relaxing them; `pause.service.spec.ts` still carries 13 such
  violations and is Phase 2's to type.
- (2026-08-31) **Phase 2's file list is 24, not 16.** The roadmap's 16 counted
  files that had carried violations; the attribution glob
  (`core/scheduling/*` plus named files) owns 24. Recorded in `INVENTORY.md`;
  "Phase 2 owns files, not residual lint hits" was already the stated principle.
- (2026-08-31) **Nine clean `web/src` files were never gated by Phase 1.**
  Batches were sized by violation count, so `app.config.ts`, `app.html`,
  `app.routes.ts`, `core/deck-color.*`, `core/lifecycle.*`, `core/search.*` (6
  files, 9 with specs) never joined `lint:ci` despite being clean. An
  incremental allow-list grown by remediation silently omits what never needed
  remediating — a pattern-level warning for Phase 3. Swept up by D6 (gate
  `web/src` wholesale).
- (2026-08-31) **`web/src/index.html` is outside ESLint's reach.** The config's
  template glob is `web/src/app/**/*.html`. The root `index.html` is not
  covered. Not closed in Phase 2; a candidate for Phase 4.
- (2026-08-31) **Phase 3 landed as `specs/019-lint-phase3-server/`.**
  `server/src` 41 → 0; repo total 0; `lint:ci` is now
  `eslint web/src server/src`. 280 tests unchanged throughout.
- (2026-08-31) **The prediction in the 2026-08-29 note held exactly.**
  `server/src` did have 4 `no-unnecessary-condition` traps, and all four were
  the "type is lying" kind rather than the "guard is genuinely dead" kind:
  three `req.body as {...}` casts asserting more than an untrusted client can
  send, and one array-index chain that `noUncheckedIndexedAccess` being off
  types as always-present. Every one was fixed by narrowing the type, never by
  deleting the guard. The `/collection/resume` case is the sharpest: deleting
  its `?? []` would throw mid-loop with `card.due` already mutated in memory.
- (2026-08-31) **A harden pass must re-derive, not re-reason (L-016).** Phase
  3's own Analyst draft prescribed a fix that cannot work — a
  `const x: T | undefined = arr[0]` annotation, which TypeScript narrows back
  to the initializer's type — and applying it took the file from 2 violations
  to 4. Phase 1 had already recorded that exact wall (its R8/R12) and the repo
  already contained the working instrument (`.at(0)`, from `review.ts:135`).
  Reasoning reproduced a known-bad answer; running it refuted it in under a
  minute. Every one of Phase 3's 41 fixes was consequently executed and
  reverted *before* `tasks.md` was written, and no step needed rewriting during
  the run.
- (2026-08-31) **`eslint --fix` output is prettier-dirty.** 13 of Phase 3's 41
  were autofixable (all one rule). The fixer emits `{ f(); return; }` on one
  line and `npm run format:check` then fails on exactly the files `--fix`
  touched. A step that verifies only ESLint reports success over a tree that
  fails CI — so autofix must be followed by `npm run format` in the same step.
- (2026-08-31) **Deleting `?? []` from a `card.due` writer is a data-loss bug,
  not a style change** — recorded because the lint rule actively recommends it
  and only reading the call site distinguishes the cases.
