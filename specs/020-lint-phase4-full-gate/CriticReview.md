# Critic review — Phase 4: full-repo lint gate

Sized Medium (per `Analyst.md`): one harden round, done by re-deriving rather
than re-reasoning (per Phase 3's L-016) — every edit in `tasks.md` Steps 1–2
was executed for real, in this spec's own worktree, before the tasks were
written, not reasoned about in the abstract.

## What was verified against the running repo, not assumed

1. **The two "silently unlinted" files are real, not a guess.**
   `npx eslint eslint.config.mjs tools/shoot.mjs --no-ignore` (repo root,
   pre-change) parses both and reports **zero** problems — confirming they
   currently match no `files` pattern in any config block, not that they are
   clean.
2. **`js.configs.recommended` is the right preset, not `strictTypeChecked`.**
   Neither file is covered by a `tsconfig.json` — there is no root
   `tsconfig.json`, and `tools/` has none. Confirmed by
   `find . -maxdepth 2 -iname "tsconfig*.json" -not -path "*/node_modules/*"`,
   which returns only `web/tsconfig*.json` and `server/tsconfig.json`.
   `projectService: true` requires the file be included by some project;
   forcing the type-checked preset here would be a real error, not a style
   choice.
3. **The exact rule-1 edit was applied and run.** Removing `'tools/**',` and
   `'eslint.config.mjs',` from the top `ignores` array and adding the new
   config block (exactly as written in Step 1's "Do") was applied directly
   to this worktree's `eslint.config.mjs`. First run surfaced 18 `no-undef`
   errors, all in `tools/shoot.mjs`, all one of four identifiers:
   `process`, `console`, `fetch`, `AbortSignal`. Cross-checked with
   `grep -noE '\b(process|console|fetch|AbortSignal|Buffer|URL|__dirname|__filename|setTimeout|setInterval|globalThis)\b' tools/shoot.mjs`
   — exactly those four appear and no others, so the hand-written globals
   list in Step 1 is not a guess with a gap.
4. **After adding the four globals, `npx eslint .` from the repo root exits
   0 with zero output** — the full repo, `web/src` and `server/src`
   included, confirming Step 1 does not regress the existing gate.
   `npm run lint:ci` (post Step-2 edit) also exits 0.
5. **The edits were reverted before `tasks.md` was written** (`git checkout
   -- eslint.config.mjs package.json`), same discipline Phase 3's L-016
   describes: the steps below are proven to work, then handed to the
   executing model as a script, not left to be re-derived under a
   `Model: haiku` step that cannot verify a design choice like "which
   preset applies here."

## Consistency check against `Analyst.md`

- Every "out of scope" item in `Analyst.md` §3 has a corresponding line in
  `tasks.md` that does not touch it: no step edits `web/src/index.html`,
  `server/tsconfig.json`, or any existing `files:` block's rule set. Step 1's
  `DO NOT TOUCH` list names every other config block explicitly.
- The `AD-` numbering `tasks.md` Step 5 defers to "next number after the
  highest existing" resolves concretely to **AD-022** — checked via
  `grep -oE '\*\*AD-[0-9]+' specs/STATE.md specs/STATE-ARCHIVE.md`, highest
  is AD-021. Recorded here so Step 5's executor does not have to re-derive
  it, though it should still re-check at execution time in case another spec
  landed an AD entry in between.
- No step in this run touches `specs/LESSONS.md` — correct, since nothing
  here is a project lesson (a "we learned" moment); it is four scope
  decisions, already written into `Analyst.md` where they belong, and one
  `AD-` entry recording the roadmap's closure.

## Gaps considered and dismissed

- **Should `tools/*.mjs` be a narrower glob naming `shoot.mjs` explicitly?**
  Considered; `tools/*.mjs` is deliberately non-narrow so a future `.mjs`
  script added to `tools/` is covered by construction instead of requiring a
  config edit — consistent with the roadmap's stated goal of mechanical
  enforcement over remembering to update a list by hand. `tools/**/*.mjs`
  (recursive) was rejected as broader than anything that exists today;
  `tools/*.mjs` (one level) matches the current flat layout and is enough.
- **Should Step 4's checkpoint re-run `npm run lint` (not `lint:ci`) too?**
  Not added — after Step 2, `lint` and `lint:ci` are byte-identical
  (`eslint .`), so running both would test the same command twice under two
  names. Not a gap.

## Verdict

No blocking findings. `tasks.md` is ready to execute as written.
