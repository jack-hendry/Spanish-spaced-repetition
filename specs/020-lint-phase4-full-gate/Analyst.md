# Analyst — Phase 4: full-repo lint gate

Phase 4 of [`specs/015-typescript-lint-rollout/ROADMAP.md`](../015-typescript-lint-rollout/ROADMAP.md).
Follows Phase 1 (`specs/017-lint-phase1-web`), Phase 2
(`specs/018-lint-phase2-scheduling`) and Phase 3 (`specs/019-lint-phase3-server`),
all landed. `web/src` and `server/src` are both at zero violations; `lint:ci`
is `eslint web/src server/src`.

Sized **Medium.** Unlike Phases 1–3 this phase remediates nothing — the two
files it brings under lint (`eslint.config.mjs`, `tools/shoot.mjs`) carry zero
violations once given a ruleset at all, verified below. The work is CI-gate
config plus three explicit scope decisions the roadmap left open, not code
fixes.

## 1. What problem are we solving?

`lint:ci` names `web/src` and `server/src` explicitly — an incremental
path-list, the same shape `ruff.toml`'s `include` list used before Phase 3's
equivalent for the Python side. Now that both directories are clean, the
roadmap's non-negotiable #2 ("a directory only enters the gate once it is
already clean") no longer needs the path list: the repo has nothing left that
would turn the gate red on day one. Phase 4 drops the incremental scoping and
gates the **full ruleset on every push**, the same way `ci.yml`'s `lint` job
already gates `tools/state_rotate.py` with `ruff check .`.

Dropping the path list surfaces two files ESLint's flat config currently
skips entirely: `eslint.config.mjs` (explicitly listed in its own `ignores`)
and `tools/shoot.mjs` (covered by the `tools/**` ignore, added in Phase 0
because `tools/` is mostly the Python content pipeline). Neither has ever had
a rule apply to it — confirmed by running `eslint eslint.config.mjs
tools/shoot.mjs --no-ignore` today, which parses both files but reports zero
problems because no config block's `files` pattern matches them, not because
they are clean. **This phase gives them real config, not silence.**

## 2. What is in scope?

1. **Un-ignore `eslint.config.mjs` and `tools/**`** from the top-level
   `ignores` block, and add a plain (non-type-checked) config block covering
   `eslint.config.mjs` and `tools/*.mjs` — `js.configs.recommended` plus the
   Node globals these two files actually reference (`process`, `console`,
   `fetch`, `AbortSignal`; verified by grep against `tools/shoot.mjs` — no
   others appear, and `eslint.config.mjs` needs none). No type-checked preset
   applies: no `tsconfig.json` at the repo root or in `tools/` covers these
   files, and `projectService: true` would error on a file outside every
   project's `include`.
   - `tools/state_rotate.py`, `tools/convert_apkg.py`, and
     `tools/__pycache__/` are Python and untouched by this — ESLint only
     processes JS/TS-family extensions regardless of the ignore list, and
     `ruff.toml` already gates `state_rotate.py` separately.
2. **Flip `lint:ci`** from `eslint web/src server/src` to `eslint .`
   (identical to `npm run lint`) so CI runs the same full-repo check the
   local `npm run lint` already reports.
3. **Update `ci.yml`'s `lint` job comment** — it currently says "the
   full-repo ESLint gate for the repo root and `tools/` is Phase 4"; that
   sentence becomes past tense.
4. **Resolve, explicitly, the three open questions Phase 3 left in the
   roadmap's "What Phase 4 inherits" list** — as scope decisions recorded
   here, not as further remediation:
   - `web/src/index.html` — **stays outside the gate.** It is the Angular
     CLI's static host page (`<!doctype html>` shell plus one `<app-root>`
     tag, no bindings, no directives), not a component template.
     `angular-eslint`'s `templateRecommended` config — the ruleset the
     existing `web/src/app/**/*.html` glob applies — checks Angular template
     syntax (structural directives, binding forms, `trackBy`, etc.) that
     this file has none of. Widening the app-template glob to catch a file
     one level up in the tree, for a ruleset with nothing in it to check,
     would be scope for the sake of a checkbox. Recorded as a closed
     decision, not a gap.
   - `noUncheckedIndexedAccess` — **stays out of scope**, unchanged from
     Phase 3 Analyst.md. Turning it on re-types every array index in both
     workspaces and is its own spec, not a line item here.
   - `no-unsafe-*` / `no-explicit-any` in `web/` test files — **stays out of
     scope**, unresolved from Phase 1 §5.1. It is a rule-relaxation question
     (should these stay on in specs at all), which non-negotiable #2 and
     AD-020 both say happens on evidence gathered while looking at the
     violations, and Phase 1 already chose not to relax it without cause.
     Nothing in Phase 4 adds new evidence, so the question stays open for
     whoever next has a reason to reopen it.
   - `templateAccessibility` — **stays out of scope**, unchanged from Phase
     0's deliberate exclusion. Still a candidate for its own spec, not
     folded in here by default.
5. Update `ROADMAP.md`'s Phase 4 checklist and `INVENTORY.md`'s closing line
   once the gate is live.

## 3. What is OUT of scope?

- **Any code remediation.** Verified above: the two newly-covered files carry
  zero violations under the new config. If step 1's real run surfaces any
  (the grep-based Node-globals list turns out incomplete, say), fixing them
  is in scope only if trivial and behavior-preserving; anything else stops
  the run per CLAUDE.md's "two failed attempts" rule rather than being forced
  through.
- **Any rule change to the existing `server/src/**/*.ts` or `web/src/**/*.ts`
  blocks.** Phase 3's D-line holds: calibration happened once, in Phase 1, on
  evidence; this phase adds a new block for new files, it does not touch the
  existing ones.
- **`web/src/index.html`, `noUncheckedIndexedAccess`, test-file
  `no-unsafe-*`/`no-explicit-any`, `templateAccessibility`** — all four
  addressed as explicit "stays out" decisions above, not left silently open.
- **Adding the `globals` npm package.** Four Node globals are hand-listed
  instead — same restraint the roadmap already applied to
  `eslint-plugin-sonarjs` (2026-08-28 Discovered entry): a whole dependency
  for four identifiers is disproportionate, and the list is short enough to
  audit by eye against a `grep`.
- **`data/**` and `specs/**`** — remain ignored; out of scope, not code.

## 4. How do we know it is done?

- `npm run lint:ci` (now `eslint .`) exits 0 from a fresh `npm ci` — matches
  Phase 3's L-013 lesson: measure from an installed tree, not a bare
  checkout, since type-aware rules under-report otherwise (irrelevant to the
  two new files, which carry no type-checked rules, but the full-repo run
  still needs `node_modules` present for `web/src`/`server/src`).
- `git grep -n "web/src server/src" package.json` returns nothing — the path
  list is gone.
- `.github/workflows/ci.yml`'s `lint` job comment no longer says the
  full-repo gate is future work.
- `ROADMAP.md`'s Phase 4 checklist items are all `[x]`, with a closing
  paragraph matching Phases 1–3's style (before → after, test count
  unchanged).
- `npm run test` and `npm run build` both still pass — this phase touches no
  application code, so both should be a no-op confirmation, not a fix.

## Retrospective

- **Did `Analyst.md` catch anything not thought about up front?** Yes, one
  thing: the assumption (before running anything) would have been that
  `eslint.config.mjs` and `tools/shoot.mjs` were "clean" in the same sense
  Phases 1–3 left `web/src`/`server/src` clean. Running
  `eslint --no-ignore` on them first showed the real situation — no rule had
  ever applied to either file — which is why the Analyst frames this phase
  as "give them a ruleset," not "fix their violations." Getting that
  distinction right up front is what kept `tasks.md` from having a
  remediation step that would have found nothing to remediate.
- **Did anything in `tasks.md` turn out to be wrong during coding?** No.
  Every edit in Steps 1–3 was executed once, by the harden pass, before
  `tasks.md` was written (see `CriticReview.md`), so the four Node globals
  (`process`, `console`, `fetch`, `AbortSignal`) and the choice of
  `js.configs.recommended` over a type-checked preset were both proven
  against the real `npx eslint .` output rather than guessed. The delegated
  `haiku` steps reproduced the same diffs and the same passing verification
  on the first attempt, in order, with no step needing rework.
- **What's left, going forward:** the roadmap
  (`specs/015-typescript-lint-rollout/ROADMAP.md`) is now fully closed —
  Phases 0 through 4 all done. `noUncheckedIndexedAccess` and the test-file
  `no-unsafe-*`/`no-explicit-any` question are the two genuinely open
  threads; either would need its own spec, not a re-open of this one.
