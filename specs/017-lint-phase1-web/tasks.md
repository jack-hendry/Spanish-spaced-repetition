# tasks — Phase 1: non-scheduling `web/` lint remediation

**14 steps, in order, do not skip ahead.** Scope, decisions and acceptance
criteria live in [`Analyst.md`](./Analyst.md); everything an executor needs is
repeated in the step itself.

Baseline for every count below: clean `origin/main` @ 66b1d70, measured with
`npx eslint web/src` **from a tree with `node_modules` installed**. Phase 1
starts at **121** violations and ends at **0**.

> **Counts are only valid after `npm install`.** In a worktree without
> dependencies, type-aware rules silently stop firing and every total below
> comes out ~5 low — a well-formed, reproducible, wrong number. See Step 0 and
> `Analyst.md` §1a.

## Step 0 — prerequisite, do this before Step 1

A git worktree has no `node_modules` of its own. `npx eslint` and the server's
vitest resolve upward to the parent checkout, but the Angular test builder is
resolved from `web/node_modules` and is **not** found — `npm run test -w web`
fails with `Could not find the '@angular/build:unit-test' builder's node
package`. Every step from Step 4 onward runs the web suite.

Run `npm install` once in the worktree root, then confirm
`npm run test -w web` reports **209 passed**. Do not start Step 1 until it does.
(CriticReview R9.)

## Standing rules for every step

- **Line numbers in these steps are a baseline map, not live coordinates.**
  They were measured on `origin/main` @ 66b1d70. In any step that edits several
  lines of one file, work **highest line number first** so earlier edits never
  shift later targets, and re-run `npx eslint <file>` between edits to re-derive
  positions. (CriticReview R1.)
- **Never edit a file under `web/src/app/core/scheduling/`, or any of
  `collection.store.*`, `study-queue.service.*`, `pause-shift.*`,
  `pause.service.*`, `heatmap.*` (in `core/`), `stats.ts` (in `core/`).** These
  are Phase 2. If a step seems to require it, STOP and report.
- **Every fix is behaviour-preserving.** `npm run test` must show the same
  pass count after as before. A fix that needs a test changed is not
  behaviour-preserving — STOP and report it instead.
- **No `eslint --fix` runs.** Only 9 of the 74 are auto-fixable; a blanket
  autofix would touch files this phase does not own.
- Run `npm run format` on any file you edit before declaring a step done —
  `format:check` is a CI gate.
- **Any table you write must reconcile against a number stated elsewhere, and
  you must recompute it by command before reporting.** A `grep` proving a
  heading exists says nothing about the numbers beneath it. Where a step gives
  you measured values, use them verbatim — do not re-derive or adjust them.
  (L-012, which has now recurred once.)

---

### Step 1 — Calibrate the ESLint ruleset

**Model:** haiku

**Status:** done (2026-08-28, `npx eslint web/src` → 74 problems,
`npx eslint server/src` → 41, the three clean directories and
`deck-list.html` all exit 0, `git status --short` limited to
`eslint.config.mjs`). The executor reported 74 against a predicted 69 and
stopped rather than adjusting options to hit the number — the correct call.
The prediction was wrong, not the work: see the note under the title above and
`Analyst.md` §1a. Predicted value corrected to 74 below.

**Depends on:** nothing.

**Files**
- MODIFY `eslint.config.mjs` — anchors: `ignores: [`, `eqeqeq: ['error', 'always'],` (appears **twice** — server block and web block), `complexity: ['error', 15],` (also **twice**), `files: ['web/src/app/**/*.html'],`
- DO NOT TOUCH: anything under `web/src/`, `server/src/`, `.github/`, `specs/`.

**Context**
Four changes, all loosening. Analyst.md D1–D3 has the reasoning; the short
version for each goes in a code comment *in the config*, because the next
person to read the config is the one who needs it. The `== null` one is not a
style preference: `x != null` matches null and undefined, `x !== null` does
not, so the current rule makes a behaviour-breaking edit the compliant one.

**Do**
1. Add `'.claude/worktrees/**',` to the `ignores` array. Comment: a stale
   worktree is a second copy of the repo and gets linted as one.
2. Replace **both** occurrences of `eqeqeq: ['error', 'always'],` with
   `eqeqeq: ['error', 'always', { null: 'ignore' }],`. Comment (once, on the
   web-block occurrence is fine): `== null` / `!= null` is the deliberate
   null-or-undefined idiom; flagging it invites a behaviour-changing "fix".
3. After **both** occurrences of `complexity: ['error', 15],` add:
   `'@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],`
   Comment: all 43 baseline hits were `${aNumber}`; `String()` wrappers add
   noise, not safety.
4. In the `files: ['web/src/app/**/*.html'],` block, replace `rules: {},` with
   a `rules` object containing
   `'@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],`
   Comment: same idiom as (2); the template rule is configured separately.
5. Append a **new final config block**, immediately before the closing `);`:
   ```js
   {
     // Test-only relaxations. Each of these rules has a premise that does not
     // hold in a spec: `x!.y` in a test IS an assertion and fails loudly when
     // wrong, `unbound-method` fires on spy references, `() => {}` is a stub,
     // a stub component is a class with no members, and an `async` test with
     // no `await` is normal. Rules whose premise DOES still hold in a test --
     // no-unsafe-*, no-explicit-any, no-unnecessary-condition,
     // strict-boolean-expressions, eqeqeq -- stay on deliberately (Analyst.md
     // D3 and §5.1).
     files: ['**/*.spec.ts', '**/*.test.ts'],
     rules: {
       '@typescript-eslint/no-non-null-assertion': 'off',
       '@typescript-eslint/unbound-method': 'off',
       '@typescript-eslint/no-empty-function': 'off',
       '@typescript-eslint/no-extraneous-class': 'off',
       '@typescript-eslint/require-await': 'off',
     },
   },
   ```

**Done when**
- `npx eslint web/src 2>&1 | tail -3` reports exactly **74 problems**
  (was 152: 121 Phase 1 + 31 Phase 2).
- `npx eslint server/src 2>&1 | tail -3` reports exactly **41 problems**
  (was 102).
- `npx eslint web/src/app/features/stats web/src/app/shared web/src/app/core/models`
  exits **0** with no output.
- `npx eslint web/src/app/features/deck-list/deck-list.html` exits **0**.
- `git diff --name-only` lists **only** `eslint.config.mjs`.

**If blocked**
If either total differs from the number above, do NOT adjust the rule options
to hit the number — STOP and report the actual counts. The numbers are
measured, not estimated, and a mismatch means the config edit differs from
what was specified.

---

### Step 2 — Re-baseline `INVENTORY.md`

**Model:** haiku

**Status:** done (2026-08-28, `INVENTORY.md` +45 lines; `grep -c 'Re-baseline'`
→ 1, `grep -c 'npm install'` → 1, `16 files` present at L190; `git status
--short` limited to `INVENTORY.md`). Took two attempts: the first wrote a
correct headline table over a **fabricated** six-file decomposition
(`pause.service.spec.ts` 5 vs. 13 actual, `heatmap.ts` 1 vs. 0, `stats.ts` 3
vs. 0; the list summed to 16 against a Phase 2 total of 24 stated in its own
table three paragraphs above). Caught by the orchestrator re-measuring, not by
the executor's checks — the same defect as L-012, in the same file. Corrected
version carries both baseline and post-calibration columns plus two
reconciliation lines.

**Depends on:** Step 1 — reads the post-calibration counts it produced.

**Files**
- MODIFY `specs/015-typescript-lint-rollout/INVENTORY.md`
- DO NOT TOUCH: `specs/017-lint-phase1-web/*` (Analyst.md and tasks.md are
  off-limits to subagents), any source file.

**Context**
The inventory's 254 is **correct** and stays. Step 1's calibration changes every
phase's count, and Phase 2's file list widens — both need recording, and the
Phase 2 drop especially must not read as progress.

One warning belongs in the file: these counts only reproduce from a tree with
`node_modules` installed. Measured from a fresh worktree without them,
type-aware rules silently stop firing and the total comes back 249 — plausible,
reproducible, and wrong. That cost this spec a withdrawn finding
(`Analyst.md` §1a, L-013), and Phases 2 and 3 will measure from fresh worktrees.

**Do**
1. Add a `## Re-baseline (2026-08-28, Phase 1)` section near the top, opening
   with the reproducibility warning above: **run `npm install` before measuring;
   a tree without `node_modules` under-reports by 5 in `web/src`.** State that
   the original 254 (152 `web/src` + 102 `server/src`) was re-verified at
   `origin/main` @ 66b1d70 and is confirmed.
2. Add the post-calibration table:

   | Phase | Baseline | After calibration | After Phase 2 reassignment |
   |---|---|---|---|
   | Phase 1 | 121 | — | **50** |
   | Phase 2 | 31 | — | **24** |
   | Phase 3 | 102 | 41 | 41 |
   | Total | 254 | 115 | 115 |

   (`web/src` post-calibration is 74 in total; the Phase 1 / Phase 2 split of
   that is the last column.)

3. Add a subsection **"Second widening of the attribution rule"**, in the same
   spirit as the one already in this file. Content: the textual rule
   (`core/scheduling/` + `collection.store.*` + `study-queue.service.*`)
   under-captures the scheduling surface, because CLAUDE.md's own sizing rule
   covers *anything* touching `card.due` or day-number math. Six files move
   from Phase 1 to Phase 2: `core/pause-shift.ts`, `core/pause.service.ts`,
   `core/pause.service.spec.ts`, `core/heatmap.ts`, `core/heatmap.spec.ts`,
   `core/stats.ts`. Note that `pause-shift.ts`'s single violation is the
   `coll.pausedAt!` assertion — i.e. a Phase 1 batch would have been told to
   remove a non-null assertion guarding `card.due` arithmetic.
4. State explicitly that **Phase 2's file list is now 16 files, not 10**, and
   that its violation count dropping 31 → 24 is a reporting change from
   calibration, not remediation — Phase 2 reviews its files, not its residual
   lint hits.
5. Leave the original Phase 0 tables intact and unedited. This is an appended
   re-baseline, not a rewrite.

**Done when**
- `grep -c 'Re-baseline' specs/015-typescript-lint-rollout/INVENTORY.md` ≥ 1.
- `grep -c 'npm install' specs/015-typescript-lint-rollout/INVENTORY.md` ≥ 1
  (the reproducibility warning is present).
- All six reassigned filenames appear in the file:
  `for f in pause-shift pause.service heatmap stats; do grep -q "$f" specs/015-typescript-lint-rollout/INVENTORY.md || echo "MISSING $f"; done` prints nothing.
- `grep -n '16 files' specs/015-typescript-lint-rollout/INVENTORY.md` returns a hit.
- `git diff --name-only` lists only `specs/015-typescript-lint-rollout/INVENTORY.md`.

**If blocked**
If the numbers in Step 1's Done when did not match, do not write this file —
STOP. An inventory recording unverified numbers is worse than no re-baseline.
Do **not** "correct" the 254 to some other figure without first confirming
`npm install` has been run in this tree.

---

### Step 3 — Add `lint:ci` and wire it into CI

**Model:** haiku

**Status:** done (2026-08-28, `npm run lint:ci` exit 0 with no output;
`lint:ci` present in `package.json:20` and `ci.yml:68`; `grep -c 'undecided
step'` → 0; `git status --short` limited to `package.json` and
`.github/workflows/ci.yml`). Verified independently by the orchestrator. Gate
covers `core/models`, `features/stats`, `shared`. One nit deferred to Step 13:
the `lint` job comment still opens "Scoped to `tools/state_rotate.py`", which
now under-describes a job running both ruff and ESLint.

**Depends on:** Step 1 — the three directories below are clean only after calibration.

**Files**
- MODIFY `package.json` — anchor: `"lint:json":`
- MODIFY `.github/workflows/ci.yml` — anchor: the `lint:` job's `- run: ruff format --check tools/state_rotate.py`
- DO NOT TOUCH: `eslint.config.mjs`, anything under `web/src/`.

**Context**
ESLint flat config has no `include` list, so the ruff-style incremental gate is
an explicit path list in a script. `npm run lint` stays full-repo and
report-only; `npm run lint:ci` is the gate and must always be green. A
directory joins it only once it is already clean — roadmap non-negotiable #2.
Paths are directories, so a new file in a gated directory is covered
automatically.

**Do**
1. Add to `package.json` scripts, after `lint:json`:
   ```json
   "lint:ci": "eslint web/src/app/core/models web/src/app/features/stats web/src/app/shared"
   ```
2. In `.github/workflows/ci.yml`, the `lint` job currently only sets up Python.
   Add a Node setup + `npm ci` + `- run: npm run lint:ci` step to that job.
   Match the Node setup already used by the `tests` job (`actions/setup-node@v4`,
   `node-version: "24"`, `cache: npm`).
3. Update the `lint` job's leading comment: it currently says "an ESLint pass
   for web/ and server/ is still a separate, undecided step." Replace that
   sentence with a note that `lint:ci` gates the directories cleaned so far and
   grows per batch, mirroring `ruff.toml`'s `include`, and that the full-repo
   gate is Phase 4.

**Done when**
- `npm run lint:ci` exits **0** and prints no violations.
- `grep -n 'lint:ci' package.json .github/workflows/ci.yml` returns hits in both.
- `grep -c 'undecided step' .github/workflows/ci.yml` returns 0.
- `git diff --name-only` lists only `package.json` and `.github/workflows/ci.yml`.

**If blocked**
If `npm run lint:ci` reports anything, Step 1 did not land as specified —
STOP, do not remove a directory from the list to make it pass.

---

### Step 4 — Checkpoint: calibration landed, nothing else moved

**Model:** haiku

**Status:** done (2026-08-28, all 8 checks green). `npm run build` succeeds;
`npm run test` → **71 server + 209 web = 280**, unchanged from the pre-spec
baseline; `format:check` clean; `lint:ci` exit 0; `npx eslint web/src` → 74,
`server/src` → 41, both matching Step 1. `git diff --name-only 64c7e4c^..HEAD`
lists 10 files — `eslint.config.mjs`, `package.json`,
`.github/workflows/ci.yml`, `STATE.md`, `INVENTORY.md`, the three
`017-lint-phase1-web/` docs, `LESSONS.md`, `specs/STATE.md` — with **zero**
paths under `web/src/`, `server/src/` or `data/spanish/`. Calibration is
confirmed behaviour-neutral: 139 violations removed, no test moved.

**Depends on:** Steps 1–3.

**Files** — none. Verification only.

**Do**
1. `npm run build`
2. `npm run test`
3. `npm run format:check`
4. `npm run lint:ci`
5. `git status --short`

**Done when**
- Build succeeds.
- `npm run test` passes with the **same** counts as before this spec started:
  71 server + 209 web = 280. Record the actual numbers in this step's Status
  line. If they differ from 280, that is a finding — report it, do not adjust.
- `format:check` clean, `lint:ci` exit 0.
- `git status --short` shows changes **only** to `eslint.config.mjs`,
  `package.json`, `.github/workflows/ci.yml`,
  `specs/015-typescript-lint-rollout/INVENTORY.md`, and
  `specs/017-lint-phase1-web/`. Zero paths under `web/src/`, `server/src/`, or
  `data/spanish/`.

**If blocked**
Any red result here means a config-only change altered behaviour, which should
be impossible. STOP and report rather than fixing forward.

---

### Step 5 — Batch 1a: `core/templating/` implementation files

**Model:** haiku

**Status:** done (2026-08-28). `npx eslint` on the three files exits 0; web
tests **209 passed**, unchanged; build succeeds; diff limited to the three
files. `npx eslint web/src` **74 → 69**, exactly the 5 this step owns —
verified by the orchestrator. All four fixes landed as prescribed, including
`Object.hasOwn` for the L63 dead-guard case and `new Array<number>` for the
`any[]` leak.

**Depends on:** Step 1 — these 5 violations are what survives calibration.

**Files**
- MODIFY `web/src/app/core/templating/cloze.ts` — anchor: `const placeholder = hint ?`
- MODIFY `web/src/app/core/templating/template-renderer.ts` — anchors: `function isEmpty(`, `ctx.fields[field] !== undefined`
- MODIFY `web/src/app/core/templating/type-answer.ts` — anchor: `const dp: number[][] = Array.from(`
- DO NOT TOUCH: `template-renderer.spec.ts` (Step 6), any other `core/` file.

**Context**
Five violations, three files. Each fix must preserve behaviour exactly,
including the treatment of the empty string — these functions all currently
lean on `''` being falsy, and that is intentional in two of the three.

**Do**
1. `cloze.ts` L28 (`strict-boolean-expressions`, nullable string): `hint` is
   `string | undefined` and `''` must keep behaving as "no hint". Change
   `hint ? \`[${hint}]\` : '[...]'` to
   `hint != null && hint !== '' ? \`[${hint}]\` : '[...]'`.
2. `template-renderer.ts` L26 (`strict-boolean-expressions`): inside
   `isEmpty(value: string | undefined)`, change `if (!value) return true;` to
   `if (value == null || value === '') return true;`.
3. `template-renderer.ts` L63 (`no-unnecessary-condition`, "types have no
   overlap"): `ctx.fields` is typed `Record<string, string>`, so TypeScript
   believes `ctx.fields[field]` is never `undefined` — but at runtime a
   template can reference a field the note type does not have, and the guard is
   live. Make the check one the type system cannot rule out, without changing
   what happens: replace `ctx.fields[field] !== undefined ? value : whole` with
   `Object.hasOwn(ctx.fields, field) ? value : whole`. An absent key returns
   `whole` in both the old and new form.
4. `type-answer.ts` L19 (`no-unsafe-assignment` + `no-unsafe-return`):
   `new Array(m + 1).fill(0)` is `any[]`. Add the type argument:
   `new Array<number>(m + 1).fill(0)`. Both violations come from this one
   expression.

**Done when**
- `npx eslint web/src/app/core/templating/cloze.ts web/src/app/core/templating/template-renderer.ts web/src/app/core/templating/type-answer.ts`
  exits **0**.
- `npm run test -w web` passes with 209 tests — unchanged.
- `npm run build` succeeds.

**If blocked**
If any templating test goes red, the empty-string handling in (1) or (2) was
changed, or (3) altered which fields resolve. Revert that single edit and
report which one — do not adjust the test.

---

### Step 6 — Batch 1b: `template-renderer.spec.ts` + the two `core/` leaves

**Model:** haiku

**Status:** done (2026-08-28). `npx eslint` exits 0 on all three paths; build
succeeds; web tests **209 passed**; `lint:ci` exit 0; `npx eslint web/src`
**69 → 65**, exactly the 4 this step owns — verified by the orchestrator. The
`daily-limits.ts` local binding was required as predicted (CriticReview R1's
sibling case); `??` conversion confirmed safe per R5. `lint:ci` now also gates
`core/templating`, `api.service.ts` and `daily-limits.ts`.

**Depends on:** Step 5 — same directory; keeps the two steps' edits from
racing in one file's neighbourhood.

**Files**
- MODIFY `web/src/app/core/templating/template-renderer.spec.ts` — L110, L125
- MODIFY `web/src/app/core/api.service.ts` — anchor: `getCards(deckId?: string)`
- MODIFY `web/src/app/core/daily-limits.ts` — anchor: `export function dailyForToday(`
- DO NOT TOUCH: any other file under `core/` — in particular `heatmap.ts`,
  `stats.ts`, `pause.service.ts`, `pause-shift.ts`, `collection.store.ts`
  (all Phase 2).

**Context**
Four violations. The `daily-limits.ts` one needs a specific shape: the obvious
optional-chain rewrite loses TypeScript's narrowing of `deck.daily`, so bind it
to a local first.

**Do**
1. `template-renderer.spec.ts` L110 and L125 (`prefer-nullish-coalescing`):
   both are `(someString.match(/<audio/g) || []).length`. `String.match`
   returns `RegExpMatchArray | null`, and an array is always truthy, so `||`
   and `??` are behaviourally identical here — verified, this is a safe
   conversion (CriticReview R5). Replace `|| []` with `?? []` in both.
2. `api.service.ts` L33 (`strict-boolean-expressions`): `deckId` is
   `string | undefined` and `''` must keep meaning "no deck filter". Change the
   ternary condition from `deckId` to `deckId != null && deckId !== ''`,
   keeping both branches exactly as they are.
3. `daily-limits.ts` L14 (`prefer-optional-chain`): rewrite
   ```ts
   return deck.daily && deck.daily.day === today ? deck.daily : EMPTY(today);
   ```
   as
   ```ts
   const daily = deck.daily;
   return daily?.day === today ? daily : EMPTY(today);
   ```
   The local binding is required — `deck.daily?.day === today` does not narrow
   `deck.daily` itself, so returning `deck.daily` directly fails to compile.

**Done when**
- `npx eslint web/src/app/core/templating web/src/app/core/api.service.ts web/src/app/core/daily-limits.ts`
  exits **0**.
- `npm run build` succeeds (this is the step most likely to surface a narrowing
  error — do not skip it).
- `npm run test -w web` passes with 209 tests.
- Add `web/src/app/core/templating web/src/app/core/api.service.ts web/src/app/core/daily-limits.ts`
  to the `lint:ci` script in `package.json`, and `npm run lint:ci` exits 0.

**If blocked**
If (3) will not compile even with the local binding, leave the original line
and report — `prefer-optional-chain` is not worth a type-safety regression.

---

### Step 7 — Batch 2: `features/browser/` and `features/options/`

**Model:** haiku

**Status:** done (2026-08-28). `npx eslint` exits 0 on both directories; web
tests **209 passed**; build succeeds; `lint:ci` exit 0; `npx eslint web/src`
**65 → 60**, exactly the 5 this step owns — verified by the orchestrator. The
`options.ts` `!` assertion became a throwing guard documenting the invariant,
per R7. Both feature directories join the gate.

**Depends on:** Step 1.

**Files**
- MODIFY `web/src/app/features/browser/browser.ts` — L37, L150, L190
- MODIFY `web/src/app/features/options/options.ts` — L84, L151
- DO NOT TOUCH: the `.html` or `.spec.ts` files in either directory; they are
  already clean and must stay untouched.

**Context**
Five violations. Four are `strict-boolean-expressions` on nullable strings, all
following the same pattern: an id or a found value that is `string | undefined`
or `string | null`, used as a truthiness guard where `''` and absent mean the
same thing. One is a non-null assertion on a field set during `init()`.

**Do**
1. `browser.ts` L37: `values.find(...)` yields `string | undefined`; the
   predicate already guarantees a non-empty match, so the empty case cannot
   arise. Change `if (clozeField)` to `if (clozeField !== undefined)`.
2. `browser.ts` L150 (inside `editingRow`): change `if (!id) return undefined;`
   to `if (id == null || id === '') return undefined;`.
3. `browser.ts` L190 (inside `saveEdit`): change `if (!id || this.busy()) return;`
   to `if (id == null || id === '' || this.busy()) return;`.
4. `options.ts` L84: change
   `const opts = id ? this.store.deckOptionsById(id) : undefined;` to
   `const opts = id != null && id !== '' ? this.store.deckOptionsById(id) : undefined;`.
5. `options.ts` L151 (`no-non-null-assertion`): `buildPatch()` opens with
   `const o = this.original!;`. The field is declared at L75 as
   `private original: DeckOptions | null = null;` (verified — CriticReview R7),
   so the guard below narrows properly.
   Replace the assertion with an explicit guard that throws:
   ```ts
   const o = this.original;
   if (!o) throw new Error('buildPatch() called before init() resolved options');
   ```
   `buildPatch` is private and only reachable after `init()` sets `original`,
   so the throw is unreachable in practice — that is the point: it documents
   the invariant instead of asserting it away.

**Done when**
- `npx eslint web/src/app/features/browser web/src/app/features/options` exits **0**.
- `npm run test -w web` passes with 209 tests.
- `npm run build` succeeds.
- Add both directories to `lint:ci`; `npm run lint:ci` exits 0.

**If blocked**
If a browser or options test goes red, one of the `''` cases was not in fact
equivalent to absent. Revert that single edit and report which line.

---

### Step 8 — Checkpoint: batches 1 and 2

**Model:** haiku

**Status:** done (2026-08-28, all checks green). Build succeeds; `npm run test`
→ **71 server + 209 web = 280**, unchanged; `format:check` clean; `lint:ci`
exit 0; `npx eslint web/src` → **60**, matching 74 − 9 − 5 exactly. The scope
check — `git diff --name-only 64c7e4c^..HEAD` filtered for
`core/scheduling/|collection.store|study-queue|pause-shift|pause.service|core/heatmap|core/stats`
— printed nothing (grep exit 1), re-run independently by the orchestrator. 18
files changed so far, 8 of them source, **zero** of them Phase 2.

**Depends on:** Steps 5–7.

**Files** — none. Verification only.

**Do**
1. `npm run build`
2. `npm run test`
3. `npm run format:check` (run `npm run format` first if it fails, then re-check)
4. `npm run lint:ci`
5. `npx eslint web/src 2>&1 | tail -3`
6. `git diff --name-only main..HEAD` (or `git status --short` if uncommitted)

**Done when**
- Build green; tests 280 (71 server + 209 web); `format:check` clean;
  `lint:ci` exit 0.
- `npx eslint web/src` reports **60 problems** (74 after Step 1, minus 9 from
  Batch 1 and 5 from Batch 2).
- The changed-file list contains **no** path matching
  `core/scheduling/|collection\.store|study-queue|pause-shift|pause\.service|core/heatmap|core/stats`.

**If blocked**
If the eslint total is not 60, report the actual number and the per-file
breakdown from `npx eslint web/src --format json` before continuing.

---

### Step 9 — Batch 3: app shell and remaining spec files

**Model:** haiku

**Status:** done (2026-08-28). `npx eslint` exits 0 on all three paths; web
tests **209 passed**; build succeeds; `lint:ci` exit 0; `npx eslint web/src`
**60 → 53**, exactly the 7 this step owns — verified by the orchestrator.

**Deviation, accepted.** The step said to delete the `?` and keep the property
access. In the four spec-file cases the executor deleted the `?` *and* added a
`!` on the binding (`querySelector(...)!`, `rows.find(...)!`). Permitted —
`no-non-null-assertion` is off in specs by D3 — and an improvement rather than
a shortcut: `btn?.click()` in a test means "click it if it exists", so a broken
selector makes the test pass **vacuously**, whereas `btn!.click()` throws. This
is D3's own stated rationale ("`x!.y` in a test *is* an assertion and fails
loudly when wrong") applied where the step's wording had not anticipated it.

The `no-misused-promises` fix replaced `pauseService.resume.mockImplementation(…)`
with a direct `pauseService.resume = vi.fn(async () => …)`. Checked by the
orchestrator: `pauseService` is a plain object literal supplied via
`useValue`, the component resolves `.resume` at call time, `setup()` rebuilds
it per test, and this test asserts on `btn.disabled` rather than on the spy —
so replacing the spy loses no assertion.

**Depends on:** Step 1.

**Files**
- MODIFY `web/src/main.ts` — L5
- MODIFY `web/src/app/app.spec.ts` — L102, L105
- MODIFY `web/src/app/features/deck-list/deck-list.spec.ts` — L71, L88, L105
- DO NOT TOUCH: `web/src/app/app.ts` (already clean), `deck-list.ts`,
  `deck-list.html`.

**Context**
Seven violations. `main.ts` has two on one line. Four spec-file ones are all
`no-unnecessary-condition: "Unnecessary optional chain on a non-nullish value"`
— an `?.` where the type says the value is never nullish. Read each line and
delete just the `?`, leaving the property access. If removing it makes the
expression fail to compile, the type is nullable after all and the rule is
wrong about that line: leave it and report.

**Do**
1. `main.ts` L5: change
   `bootstrapApplication(App, appConfig).catch((err) => console.error(err));`
   to
   ```ts
   bootstrapApplication(App, appConfig).catch((err: unknown) => {
     console.error(err);
   });
   ```
   The explicit `: unknown` fixes `use-unknown-in-catch-callback-variable`; the
   braces fix `no-confusing-void-expression`.
2. `app.spec.ts` L102 and L105: remove the unnecessary `?.` optional chains.
3. `deck-list.spec.ts` L71 and L88: same.
4. `deck-list.spec.ts` L105 (`no-misused-promises`, "Promise returned in
   function argument where a void return was expected"): an `async` callback is
   being passed where a `void`-returning one is expected, so a rejection would
   go unhandled. Read the call site. If it is a test-harness callback that can
   take a promise (e.g. an `it(...)` body), hoist the `await` to the enclosing
   test instead; otherwise wrap the call so the promise is explicitly consumed
   (`void someAsyncFn();` when the result is genuinely not awaited, or `await`
   it if the test should wait). Do not silence it with a disable comment.

**Done when**
- `npx eslint web/src/main.ts web/src/app/app.spec.ts web/src/app/features/deck-list`
  exits **0**.
- `npm run test -w web` passes with 209 tests.
- `npm run build` succeeds.
- Add `web/src/main.ts web/src/app/app.ts web/src/app/app.spec.ts web/src/app/features/deck-list`
  to `lint:ci`; `npm run lint:ci` exits 0.

**If blocked**
If a test assertion changes meaning when the `?.` is removed (e.g. it was
guarding a genuinely absent DOM node), leave that occurrence and report it.

---

### Step 10 — Batch 4a: `review.ts`, everything except the complexity rule

**Model:** haiku

**Status:** not started

**Depends on:** Step 1.

**Files**
- MODIFY `web/src/app/features/review/review.ts` — L89, L90, L125, L132, L135, L138, L142, L144, L165, L172, L210, L261, L311
- DO NOT TOUCH: `review.spec.ts` (Step 12), `review.html`, and **do not touch
  `onKey` at L299** — that is Step 11.

**Context**
Fourteen violations in the app's busiest component. It drives the review loop
but does not itself compute scheduling — it calls into `core/scheduling/`,
which this step must not enter. Read the whole file before editing; several of
these sit inside one `effect()` block and the fixes interact.

L135 carries **two** rules at once (`no-unnecessary-condition: value is always
falsy` and `strict-boolean-expressions: condition is always true`). That pair
means the type of `audios[i]` is non-nullable while the runtime guard `if (!el)
return;` is real — the array is indexed without `noUncheckedIndexedAccess`.
This is a genuine finding, not noise.

**Do**

Thirteen edits in one file — apply them **bottom-up (L311 first, L89 last)** and
re-run `npx eslint web/src/app/features/review/review.ts` between edits, per the
standing rule. The numbering below is by topic, not execution order.

1. L90, L165, L210, L261 (`no-non-null-assertion`): replace each `!` with an
   explicit guard appropriate to its context — an early `return` where the
   function can bail, or a `throw new Error('<invariant>')` where it cannot.
   Read each site; do not apply one shape blindly.
2. L89, L172 (`strict-boolean-expressions`, nullable string): use
   `x != null && x !== ''`, preserving current behaviour for `''`.
3. L125 (`strict-boolean-expressions`, nullable boolean): the expression is
   `!s?.isListeningFront`. Make the nullish case explicit:
   `s?.isListeningFront !== true`.
4. L132 (`array-type`): the line is `const detachers: Array<() => void> = [];`.
   The parentheses are required — `() => void[]` is a *different type* and will
   not compile. Change it to exactly:
   ```ts
   const detachers: (() => void)[] = [];
   ```
5. L135 (both rules): `audios` is `HTMLAudioElement[]`, so `audios[i]` types as
   non-nullable and ESLint calls the `if (!el) return;` guard dead — but the
   guard is live at runtime, because the `ended` handler calls
   `playAt(i + 1)` with `i + 1 === audios.length`. Make the type honest instead
   of removing the guard: change the binding to
   `const el: HTMLAudioElement | undefined = audios[i];` and leave
   `if (!el) return;` exactly as it is. Do **not** delete the guard.
6. L138 (`no-empty-function`): the line is `el.play().catch(() => {});`, and
   the comment above it already explains the no-op. A comment does **not**
   satisfy this rule (that is `no-empty`, a different rule), so give the arrow
   an expression body: `el.play().catch(() => undefined);`. Leave the existing
   two-line comment above it in place.
7. L142, L144 (`no-confusing-void-expression`): wrap both arrow-shorthand
   bodies in braces —
   `const onEnded = () => { playAt(i + 1); };` and
   `detachers.push(() => { el.removeEventListener('ended', onEnded); });`
8. L311 (`no-unnecessary-condition`): remove the unnecessary `?.`, per Step 9's
   rule — if it will not compile without it, leave it and report.

**Done when**
- `npx eslint web/src/app/features/review/review.ts 2>&1 | tail -3` reports
  exactly **1 problem** — the `complexity` error on `onKey`, which Step 11
  fixes. No other rule remains.
- `npm run test -w web` passes with 209 tests.
- `npm run build` succeeds.

**If blocked**
If any review test goes red, a guard added in (1) is bailing where the original
`!` let execution through. Revert that single guard and report the site — the
review loop's behaviour is not something to adjust a test around.

---

### Step 11 — Batch 4b: decompose `onKey` under the complexity cap

**Model:** haiku

**Status:** not started

**Depends on:** Step 10 — edits the same file; must run after it, never beside it.

**Files**
- MODIFY `web/src/app/features/review/review.ts` — anchor: `onKey` (~L299)
- DO NOT TOUCH: any other method in the file, `review.spec.ts`, `review.html`.

**Context**
`onKey` has cyclomatic complexity 19; the cap is 15. This is a **decomposition,
not a redesign** — extract cohesive branches into private helpers and have
`onKey` delegate. Key handling is covered by existing tests, including four
regression tests added in 2026-08-26 for the type-in-answer case (`-` and other
keys must reach the input while an unrevealed type-in answer has focus; Enter
reveals, Escape blurs without navigating). Those tests are the contract: do not
change them, and do not reorder the guards they pin.

**Do**
1. Read `onKey` in full and list its branches before editing.
2. Extract two or three private methods along the branch groupings already
   present — e.g. the typing/type-in-answer early-return path, the rating keys,
   and the navigation/action keys. Name them for what they handle
   (`handleTypeInKey`, `handleRatingKey`, …).
3. Each helper returns a `boolean` meaning "handled" so `onKey` reads as a
   short ordered chain of guarded delegations. Preserve the **existing order**
   of checks exactly — the type-in early return must still come first.
4. Do not change which keys map to which action, or any `preventDefault` /
   `stopPropagation` call.

**Done when**
- `npx eslint web/src/app/features/review/review.ts` exits **0**.
- `npm run test -w web` passes with 209 tests — in particular the four
  type-in-answer key tests in `review.spec.ts` still pass, unmodified.
- `git diff web/src/app/features/review/review.spec.ts` is **empty**.
- `npm run build` succeeds.

**If blocked**
If the complexity is still over 15 after extraction, do not raise the cap in
`eslint.config.mjs` and do not add an inline disable — STOP and report the
remaining count.

---

### Step 12 — Batch 4c: `review.spec.ts`

**Model:** haiku

**Status:** not started

**Depends on:** Step 11 — must not run until `review.ts` is final, so a spec
edit is never blamed for an implementation change.

**Files**
- MODIFY `web/src/app/features/review/review.spec.ts` — L198 (×2), L230, L263, L304, L346, L353, L360, L371, L613, L623, L624, L632, L642
- DO NOT TOUCH: `review.ts`.

**Context**
Fourteen violations: eight `no-unnecessary-condition` optional chains, two
`no-explicit-any` (L613, L632), and four on `vitest` spy handles — L198
(`no-unsafe-call` + `no-unsafe-member-access` on `.mockRestore`), L263 and L304
(`no-unsafe-member-access` on `.mock`). All six of the latter share one root
cause: a spy is being held in an `any`-typed binding, so every use of it is
unchecked.

Analyst.md §5.1 deliberately kept these rules on in tests, because an
`any`-typed mock is how a test keeps passing after the contract it mocks has
drifted. Type them properly rather than suppressing.

**Do**
1. L230, L346, L353, L360, L371, L623, L624, L642: remove the unnecessary `?.`
   optional chains, same rule as Step 9 — if an occurrence will not compile
   without it, leave it and report.
2. L198, L263, L304: find the binding holding the spy and give it vitest's real
   type rather than `any`. `vi.spyOn(obj, 'method')` already returns a typed
   `MockInstance`, so in most cases the fix is to stop annotating (or casting)
   the binding as `any` and let inference do it; import `type MockInstance` from
   `vitest` if an explicit annotation is needed. One correct binding type should
   clear all four violations.
3. L613 and L632: replace `any` with the real type of the thing being mocked.
   Read the surrounding mock setup to find it. If the precise type is genuinely
   unavailable, use `unknown` plus a narrowing cast at the point of use — never
   an `eslint-disable` comment.

**Done when**
- `npx eslint web/src/app/features/review` exits **0**.
- `npm run test -w web` passes with 209 tests.
- `npm run build` succeeds.
- Add `web/src/app/features/review` to `lint:ci`; `npm run lint:ci` exits 0.

**If blocked**
If typing a mock at L198/L263/L304/L613/L632 cascades into more than ~5 further
edits in the file, STOP and report — that is a bigger change than this step is
scoped for, and §5.1 already anticipates revisiting it (turning `no-unsafe-*`
off for tests is the documented fallback, but that is the user's call, not
yours).

---

### Step 13 — Checkpoint: all of `web/src` outside Phase 2 is clean

**Model:** haiku

**Status:** not started

**Depends on:** Steps 5–12.

**Files**
- MODIFY `package.json` — the `lint:ci` script, consolidating the accumulated
  paths.

**Context**
Every Phase 1 directory is now clean, so the per-batch path list can be
replaced by the whole of `web/src` **minus** the Phase 2 files. ESLint has no
negative path arguments, so keep an explicit positive list of the directories
and files Phase 1 owns rather than trying to exclude.

**Do**
1. Rewrite `lint:ci` as an explicit list covering: `web/src/main.ts`,
   `web/src/app/app.ts`, `web/src/app/app.spec.ts`, `web/src/app/core/models`,
   `web/src/app/core/templating`, `web/src/app/core/api.service.ts`,
   `web/src/app/core/daily-limits.ts`, `web/src/app/shared`, and each directory
   under `web/src/app/features/`.
2. Add a comment in `package.json` is not possible (JSON) — instead put the
   explanation in the `ci.yml` `lint` job comment: this list is Phase 1's
   surface; `core/scheduling/` and the six `card.due` files are Phase 2 and
   join at that phase; the whole repo joins at Phase 4.
3. While in that comment, fix its opening line. It currently begins "Scoped to
   `tools/state_rotate.py`", which described the job when ruff was the only
   linter in it; the job now runs ruff *and* ESLint. Reword the opening so it
   names both, then keeps the existing ruff-scope explanation as the
   ruff-specific half.
4. Run the full verification set.

**Done when**
- `npm run lint:ci` exits **0**.
- `npx eslint web/src 2>&1 | tail -3` reports exactly **24 problems** — all in
  Phase 2 files, none in a Phase 1 file.
- `npx eslint server/src 2>&1 | tail -3` still reports **41** (untouched by
  this spec).
- `npm run build`, `npm run test` (280), `npm run format:check` all green.
- `git status --short` shows no path under `data/spanish/`.

**If blocked**
If `npx eslint web/src` reports anything outside the seven known Phase 2 files
(`collection.store.ts`, `heatmap.spec.ts`, `pause-shift.ts`,
`pause.service.spec.ts`, `pause.service.ts`, `scheduler-factory.ts`,
`sm2.spec.ts`), name the file and STOP.

---

### Step 14 — Regression, docs, and wrap-up

**Model:** top-level

**Status:** not started

**Depends on:** Step 13.

**Files**
- MODIFY `specs/015-typescript-lint-rollout/ROADMAP.md` — Phase 1 checkboxes + Discovered log
- MODIFY `specs/STATE.md` — AD/L entries, Quick Tasks if applicable
- MODIFY `specs/LESSONS.md` — bodies for any new `L-NNN`
- MODIFY `specs/017-lint-phase1-web/Analyst.md` — §9 retrospective
- MODIFY root `STATE.md` — remove the `## Executing:` run marker

**Context**
`Analyst.md` is subagent-protected, which is why this step is `top-level`.
Every `L-NNN` headline needs a body in `LESSONS.md` or the pre-push hook
refuses the push.

**Do**
1. Walk all nine acceptance criteria in `Analyst.md` §7 and record the actual
   result of each.
2. Tick the Phase 1 checkboxes in `ROADMAP.md` and append dated Discovered
   entries for: the withdrawn 254→249 "correction" and its real cause
   (type-aware lint under-reports without `node_modules` — L-013), the missing
   `.claude/worktrees/**` ignore, the `eqeqeq`/`== null` trap, and the second
   widening of the phase-attribution rule (Phase 2 is now 16 files).
3. Add to `specs/STATE.md`: an `AD-020` for the calibration decision (a lint
   ruleset is calibrated against the codebase before it is enforced, and
   loosening on evidence is part of adoption, not a retreat from it), and two
   lesson headlines — **L-013** (a baseline measured in a working tree is a
   baseline of that working tree) and **L-014** (a lint rule can make the
   behaviour-changing edit the compliant one; `== null` is not a style
   preference). Write both bodies into `specs/LESSONS.md`.
4. Fill in `Analyst.md` §9 retrospective: what the re-measurement caught that
   the inventory did not, and what in `tasks.md` turned out wrong during
   execution.
5. Confirm `git checkout -- data/spanish/` is unnecessary (nothing dirty there);
   if it is dirty, restore it before finishing.
6. Remove the `## Executing: 017-lint-phase1-web` line from the root
   `STATE.md`.

**Done when**
- All nine §7 criteria recorded with actual results.
- `bash scripts/clean-table-check.sh` passes.
- `python3 tools/state_rotate.py --check` passes — **see the note below; this
  one is expected to fail until a human rotates.**
- Every `### Step` in this file has a `**Status:**` line reading
  `done (<date>, <evidence>)`.
- `git status --short` shows nothing under `data/spanish/`.
- **Do not commit — ask the user first.**

**If blocked**
If `clean-table-check.sh` fails on the `L-NNN` gate, a lesson headline is
missing its body (or vice versa) — fix the pairing, do not `--no-verify`.

**Known blocker — `specs/STATE.md` is over its size budget.** As of 2026-08-28
the file is 320 lines against a 300-line budget, and it was already at ~290
*before* this spec added `AD-020`, `L-013` and `L-014`. The tool names
`AD-014`, `AD-015` and `AD-016` (all 2026-08-27) as due for rotation, freeing
37 lines. **Do not run `python3 tools/state_rotate.py --apply`** — CLAUDE.md
reserves that for a human who has decided to rotate, and no hook ever runs it
for you. Report the `--check` output and stop; the push gate will refuse until
someone rotates.
