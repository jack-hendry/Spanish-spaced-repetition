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

- [ ] Batch plan TBD — depends entirely on what Phase 0's inventory shows.
      Don't guess batch count or size here; size each batch against the
      real inventory when Phase 0 lands.
- [ ] Gate CI incrementally per directory via the same `include`-list
      scoping `ruff.toml` uses — a directory joins the gate the moment it's
      clean, not before.

## Phase 2 — `core/scheduling/` and adjacent state

Everything Phase 0 flagged under the first non-negotiable above.

- [ ] Its own `Analyst.md` + `tasks.md` + harden round, sized Large
      regardless of how few files or how mechanical the fixes look.
- [ ] No autofixer run unattended here — every change reviewed against the
      invariants in `.claude/skills/scheduling-domain` (day-number math,
      permille ease, dual SM-2/FSRS state, `card.due` overloading).

## Phase 3 — `server/` batches

Same batching approach as Phase 1, applied to `server/src/`.

- [ ] Batch plan TBD, same caveat as Phase 1 — size against Phase 0's
      inventory, not a guess made now.
- [ ] Extra care flag (not a Large-task trigger, just attention) on
      `store/file-store.ts` — debounced writes, atomic temp-file+rename —
      don't let a mechanical lint fix change write timing or ordering.

## Phase 4 — Full gate

- [ ] Once every directory in `web/` and `server/` is clean, drop the
      incremental `include`-list scoping and gate the full ruleset on every
      push, the same way `ci.yml`'s Python `lint` job already gates
      `tools/state_rotate.py`.
- [ ] Confirm zero known violations remain across both workspaces before
      flipping this on.

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
