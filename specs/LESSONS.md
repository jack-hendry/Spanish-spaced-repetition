# LESSONS — full entries

Bodies for the `L-NNN` headlines in `STATE.md`. The headline is the lesson;
this file is its provenance — which spec produced it, what actually broke,
and why the rule is worded the way it is.

Rules:

- **Append-only. Never renumber.** Same contract as `STATE.md`.
- Every id here has a headline in `STATE.md`, and every headline there has
  an entry here. `scripts/clean-table-check.sh` enforces the correspondence
  on push.
- Lessons are never archived. Unlike `AD`/`B` entries they do not age out.
- These are **project and process** lessons. A gotcha that belongs next to the
  domain rules it qualifies goes in the matching skill's
  `## Lessons (auto-appended)` section instead (AD-009).

**L-001 — A doc that contradicts the code is worse than no doc; it gets copied.**
(`archive/2026-07-07-004-ui-mockup-parity` Discovered → fixed in
`archive/2026-07-09-006-pause-scheduling` T011) The `Card.due` doc-comment in
`server/src/models/index.ts` said learning-queue `due` was "epoch seconds". It
never was: `fsrs.ts` writes `ctx.now + delayMin * 60_000` and
`study-queue.service.ts` compares against `Date.now()`. The wrong claim was then
copied into the `scheduling-domain` skill, so the two places a reader would
check to confirm the unit *agreed with each other and disagreed with the code* —
which is strictly worse than an undocumented field, where you would have gone
and read `fsrs.ts`. 006's own request had to open by correcting its own skill
doc. Rules: when a doc and the code disagree, trust the code and fix the doc in
the same change; and a unit that is only written in prose deserves a test that
would fail if someone treated it as the other unit (006 T002 added exactly that).

**L-002 — Running the dev server dirties the live data store; check `git status`
before closing a feature.** (`archive/2026-07-09-006-pause-scheduling`, critic
drift audit WARN) Manual testing through `npm run dev` bumped `modified` and
`lastUnburyDay` in `data/spanish/collection.json`, which then showed up in the
feature's diff as if it were a code change. The store under `data/spanish/` is
live state the server rewrites on every review — it is not source, and it is not
part of any feature's diff unless the feature deliberately changes the on-disk
shape. Reverting with `git checkout -- data/spanish/` before the closing commit
is the habit. This is also why `data/spanish/` is deliberately *outside* the
paths `enforce-haiku-tasks-pretooluse.sh` defends: a data file is not project
code, and blocking writes to it would block the running app.

**L-003 — A green `vitest` run does not mean `tsc` passes.**
(`archive/2026-07-09-006-pause-scheduling` Discovered, found during T008)
`npm run test -w server` was green while `npm run build -w server` (bare
`tsc -p tsconfig.json`) failed on the *test file* added two tasks earlier —
several `TS2571 'Object is of type unknown'` from untyped `await res.json()`
results, and a duplicate `id` key set both explicitly and via an `...over`
spread in a test factory. Vitest transpiles without type-checking; the workspace
build type-checks everything, test files included. So a task's "Done when" that
runs only the test suite can leave the build red for two more tasks before
anyone notices. Run the build too — the `testing-playbook` definition of done
requires it — and note that a defect can live *in a spec file* and still break
the build.

**L-004 — A guard-rail keyed to a fuzzy signal fails open *and* closed.**
(inherited from habit_tracker B-001 along with
`.claude/hooks/enforce-haiku-tasks-pretooluse.sh`) An earlier revision of that
hook inferred an in-flight `tasks.md` run by grepping the transcript for the
string `tasks.md`. Merely *reading* a STATE file tripped it, so unrelated Small
tasks got blocked — while it still never proved a run was actually in flight.
Both failure directions at once. The fix was an explicit, deliberately-set
marker (`## Executing: <spec-dir-name>` in the root `STATE.md`). If a signal can
be tripped by reading a file, it is not a signal.

**L-005 — An unindented example of a marker line shadows every real one below it.**
(inherited from habit_tracker B-002 along with the root `STATE.md` and the hook
that reads it) The hook does `grep -m1 -E '^## Executing: '` — first match wins.
The root `STATE.md` documents the marker format by showing it, so an unindented
example resolves to the literal string `<spec-dir-name>`, finds no such
directory, and the hook exits dormant. It protected nothing from the day the doc
was written until someone checked. The example in this repo's root `STATE.md` is
indented by two spaces **on purpose**; keep it that way. Generalisation: any
file that is both documentation and machine-parsed input needs its examples
escaped from its own parser, and the parser needs a test that proves it is armed
before the rest of the matrix means anything —
`.claude/hooks/enforce-haiku-tasks.test.sh` aborts if the hook is dormant for
exactly this reason.
