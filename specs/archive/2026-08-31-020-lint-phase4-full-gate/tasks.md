# Tasks — Phase 4: full-repo lint gate

5 steps, in order, do not skip ahead. See `Analyst.md` for the four scope
decisions (index.html, `noUncheckedIndexedAccess`, test-file
`no-unsafe-*`/`no-explicit-any`, `templateAccessibility`) this run does not
touch.

### Step 1 — Add a config block for `eslint.config.mjs` and `tools/*.mjs`, un-ignore them

**Model:** haiku

**Status:** done (2026-08-31, `npx eslint .` and `npx eslint eslint.config.mjs tools/shoot.mjs` both exit 0 with no output)

**Files**
- MODIFY `eslint.config.mjs` — anchor: the top `ignores` array (contains
  `'tools/**',` and `'eslint.config.mjs',` as separate array entries)
- DO NOT TOUCH: any other config block in this file (`server/src/**/*.ts`,
  `web/src/**/*.ts`, `web/src/app/features/**/*.ts`, `web/src/app/**/*.html`,
  `**/*.spec.ts`/`**/*.test.ts`)

**Context**
Right now `eslint.config.mjs` and `tools/**` are both entries in the
top-level `ignores` array, so neither is linted at all — not "clean", just
never checked. Neither file has a `tsconfig.json` covering it (there is no
root `tsconfig.json`, and `tools/` has none either), so the type-checked
presets used for `server/src` and `web/src` (`strictTypeChecked`,
`projectService: true`) do not apply here — that combination errors on a
file outside every project's `include`. Use the plain
`js.configs.recommended` preset instead, same as any non-type-checked flat
config.

`tools/shoot.mjs` references exactly four Node globals not defined by
`js.configs.recommended`'s environment: `process`, `console`, `fetch`,
`AbortSignal` (confirmed via `grep -noE
'\b(process|console|fetch|AbortSignal|Buffer|URL|__dirname|__filename|setTimeout|setInterval|globalThis)\b'
tools/shoot.mjs` — exactly these four appear, nothing else). Declare them by
hand in `languageOptions.globals` rather than adding the `globals` npm
package for four identifiers.

`tools/state_rotate.py`, `tools/convert_apkg.py`, and `tools/__pycache__/`
are Python; removing `tools/**` from `ignores` does not put them under
ESLint — ESLint only ever processes JS/TS-family extensions regardless of
what is or is not ignored.

**Do**
1. In the top `ignores` array, delete the `'tools/**',` line and the
   `'eslint.config.mjs',` line. Leave `'**/dist/**'`, `'**/node_modules/**'`,
   `'**/.angular/**'`, `'data/**'`, `'specs/**'`, and
   `'.claude/worktrees/**'` untouched.
2. Add a new config object, after the last existing block (the
   `files: ['**/*.spec.ts', '**/*.test.ts']` one) and before the closing
   `);`:
   ```js
   {
     // Plain Node scripts — no tsconfig covers them, so no type-checked
     // preset applies; recommended plus the Node globals they actually use.
     files: ['eslint.config.mjs', 'tools/*.mjs'],
     extends: [js.configs.recommended],
     languageOptions: {
       globals: {
         process: 'readonly',
         console: 'readonly',
         fetch: 'readonly',
         AbortSignal: 'readonly',
       },
     },
   },
   ```

**Done when**
- `npx eslint .` exits 0 with no output (from the repo root, after `npm ci`
  has been run so `node_modules` exists).
- `npx eslint eslint.config.mjs tools/shoot.mjs` explicitly also exits 0
  with no output (confirms the new block is the one doing the work, not an
  unrelated ignore).

**If blocked**
If `npx eslint .` reports violations in `eslint.config.mjs` or
`tools/shoot.mjs` beyond the four `no-undef` globals already named above (for
example a different rule in `js.configs.recommended` firing on either file),
STOP and report the exact rule and line — do not silence it with an inline
`eslint-disable` or expand the globals list past what the grep above found.

---

### Step 2 — Flip `lint:ci` to the full-repo command

**Model:** haiku

**Status:** done (2026-08-31, `npm run lint:ci` exits 0; `git grep -n "web/src server/src" package.json` returns nothing)

**Depends on:** Step 1 — needs the full `eslint .` to already exit 0, or this
step's Done when fails for the wrong reason.

**Files**
- MODIFY `package.json` — anchor: `"lint:ci": "eslint web/src server/src"`
- DO NOT TOUCH: `"lint"`, `"lint:json"`, or any other script

**Do**
1. Change `"lint:ci": "eslint web/src server/src"` to `"lint:ci": "eslint ."`.

**Done when**
- `npm run lint:ci` exits 0.
- `git grep -n "web/src server/src" package.json` returns nothing.

**If blocked**
If `npm run lint:ci` fails after this change but Step 1's `npx eslint .`
passed, STOP — something differs between the two invocations (npm script
quoting, cwd) and needs a human look, not a workaround.

---

### Step 3 — Update `ci.yml`'s lint job comment

**Model:** haiku

**Status:** done (2026-08-31, `grep -n "is Phase 4" .github/workflows/ci.yml` returns nothing; ruff sentence unchanged in diff)

**Depends on:** Step 2 — the comment describes `lint:ci`'s new scope.

**Files**
- MODIFY `.github/workflows/ci.yml` — anchor: the comment above the `lint:`
  job, specifically the sentence "the full-repo ESLint gate for the repo
  root and `tools/` is Phase 4."
- DO NOT TOUCH: the job's `steps:` list, the `tests`, `clean-table-gate`, or
  `hooks` jobs, or the ruff steps.

**Context**
The comment currently reads (in full):
```
    # Ruff and ESLint linting gates. Ruff is scoped to tools/state_rotate.py —
    # see the SCOPE comment in ruff.toml for why the content pipeline
    # (scrape.py, tools/convert_apkg.py) is not linted yet. ESLint's `lint:ci`
    # now gates both `web/src` and `server/src` (Phases 1–3 complete); the
    # full-repo ESLint gate for the repo root and tools/ is Phase 4.
    # TypeScript formatting is checked in the `tests` job (`npm run format:check`, Prettier).
```
The ruff sentence is unrelated to this phase and must not change — ruff's
scope is a separate, still-open question, not something this phase touches.

**Do**
1. Replace the sentence "ESLint's `lint:ci` now gates both `web/src` and
   `server/src` (Phases 1–3 complete); the full-repo ESLint gate for the
   repo root and tools/ is Phase 4." with: "ESLint's `lint:ci` now gates the
   whole repo (`eslint .`) — Phases 1–4 of
   specs/015-typescript-lint-rollout/ROADMAP.md are complete."

**Done when**
- `grep -n "is Phase 4" .github/workflows/ci.yml` returns nothing.
- The ruff sentence (starting "Ruff is scoped to tools/state_rotate.py") is
  byte-for-byte unchanged — check with
  `git diff .github/workflows/ci.yml` and confirm no `-`/`+` line touches it.

---

### Step 4 — Checkpoint: full suite, build, and lint from a clean install

**Model:** haiku

**Status:** done (2026-08-31, `npm ci` fresh install; `lint:ci` exit 0 no output; `test` 280/280 passing — 71 server + 209 web, matching Phase 3's baseline; `build` exit 0; `format:check` exit 0)

**Depends on:** Steps 1–3 — re-verifies all of them together, not just each
in isolation.

**Files**
- DO NOT TOUCH: no file edits in this step.

**Do**
1. Run `npm ci` (fresh install, matching how CI runs — Phase 1's L-013
   lesson: a stale or missing `node_modules` under-reports type-aware lint
   rules).
2. Run `npm run lint:ci`.
3. Run `npm run test`.
4. Run `npm run build`.
5. Run `npm run format:check`.

**Done when**
- `npm run lint:ci` exits 0 with no output.
- `npm run test` passes with the same test count as before this spec started
  (280 tests, per Phase 3's closing note — record the actual number seen and
  flag if it differs).
- `npm run build` exits 0.
- `npm run format:check` exits 0 (Phase 3's lesson: `eslint --fix` output can
  be prettier-dirty; this step's edits are hand-written, not autofixed, but
  the check is cheap insurance).

**If blocked**
If any command fails, STOP and report which one and the exact error — do not
patch around a build or test failure inside this checkpoint step; that
belongs to whichever earlier step introduced it.

---

### Step 5 — Update ROADMAP.md, INVENTORY.md, and STATE.md; wrap-up

**Model:** top-level

**Status:** done (2026-08-31, `ROADMAP.md`/`INVENTORY.md`/`STATE.md` updated, AD-022 added, `Analyst.md` retrospective filled in; not committed — awaiting user)

**Depends on:** Step 4 — the checkpoint's actual results (test count, clean
exit codes) are what gets recorded here.

**Files**
- MODIFY `specs/015-typescript-lint-rollout/ROADMAP.md` — anchor: the
  `## Phase 4 — Full gate` section's checklist and closing line
- MODIFY `specs/015-typescript-lint-rollout/INVENTORY.md` — anchor: "**The
  gate is `eslint web/src server/src`.** Phase 4 owns what is left: the
  repo root, `tools/`, and `web/src/index.html`." (~line 233)
- MODIFY `specs/STATE.md` — append one `AD-NNN` entry (next number after the
  highest existing `AD-` entry) recording that Phase 4 closed the roadmap:
  full-repo gate, the four scope decisions from `Analyst.md` §2 item 4, and
  the before/after of `lint:ci`'s definition.
- DO NOT TOUCH: any other spec folder, `specs/LESSONS.md` (no new `L-NNN` —
  this phase surfaced no project lesson, only scope decisions already
  written into `Analyst.md`).

**Do**
1. In `ROADMAP.md`, check off Phase 4's two checklist items (the second is
   already `[x]`; check the first: "drop the incremental include-list
   scoping and gate the full ruleset on every push").
2. Add a closing paragraph under Phase 4 in `ROADMAP.md`'s style (see Phases
   1–3's closing lines): state `lint:ci` is now `eslint .`, the repo-wide
   violation count is 0, and name the four scope decisions from
   `Analyst.md` §2 item 4 as closed (not deferred) except
   `noUncheckedIndexedAccess` and the test-file `no-unsafe-*`/
   `no-explicit-any` question, which stay explicitly open per Phase 1/3.
3. In `INVENTORY.md`, replace the closing line naming `web/src server/src`
   and "Phase 4 owns what is left" with a line stating the gate is now
   `eslint .` and Phase 4 is closed.
4. Append the `AD-NNN` entry to `specs/STATE.md` under `## Decisions`,
   following the existing `AD-021` entry's format (bold headline sentence,
   date, spec path, then the reasoning).
5. Fill in `Analyst.md`'s Retrospective section (did anything surface that
   wasn't anticipated — e.g. the Node-globals list, the `js.configs.recommended`
   vs type-checked choice).
6. Do not commit. Report the diff back to the user and ask before any git
   operation, per this repo's working agreement.

**Done when**
- `ROADMAP.md`'s Phase 4 section has both checklist items `[x]` and a
  closing paragraph in the style of Phases 1–3.
- `INVENTORY.md` no longer says "Phase 4 owns what is left."
- `specs/STATE.md` has exactly one new `AD-` entry, numbered one higher than
  the previous highest.
- `git status --short` shows only the files this run touched: this spec
  folder, `eslint.config.mjs`, `package.json`, `.github/workflows/ci.yml`,
  `specs/015-typescript-lint-rollout/ROADMAP.md`,
  `specs/015-typescript-lint-rollout/INVENTORY.md`, `specs/STATE.md`.

**If blocked**
If Step 4's checkpoint reported a test-count mismatch or any non-zero exit,
STOP before writing STATE.md — do not record the phase as done against a
result that did not actually hold.
