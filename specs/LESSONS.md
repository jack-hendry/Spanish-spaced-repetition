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

**L-006 — A test that goes red when you stash the fix is not proof that every
case inside it is live.** (`specs/012-clamp-learning-steps-nan-due`, Step 3,
caught in review before the step was accepted) `tasks.md` requires each
regression step to prove its tests bite: `git stash push` the source file, watch
the new tests fail, `git stash pop`, watch them pass. Step 3's R4 test did fail
red — and was still partly dead. It selected its fixture with
`const testCard = testOpts === opts() ? relearning : learning;`, but `opts()` is
a factory that builds a **fresh object every call**, so the reference comparison
was always `false`: the relearning card was never exercised, and the third case
silently checked the learning card against the wrong step count
(`new.steps.length` where the relearning path indexes `lapse.steps`). The two
*other* cases in the same test failed loudly when stashed, which made the whole
test look proven.

The red/green stash protocol validates a test **file**, not each assertion in
it. A dead branch inside a test that fails for other reasons is invisible to it.
So: still run the protocol — it caught real gaps in Steps 3, 5 and 7 — but read
the test body too, and be specifically suspicious of any control flow *inside* a
test that decides which fixture or expectation to use. Prefer an explicit case
table (`[{ subject, options, stepCount }, …]`) over a conditional; a table
cannot silently select the same branch three times. Identity comparison against
a helper's return value is always wrong when that helper is a factory.

**L-009 — A hand-maintained pointer decays the moment nobody is forced to
touch it.** (`specs/014-spec-continuity`, motivated by resuming
`specs/013-server-hardening`) The root `STATE.md`'s "Current work" section is
free-text prose with nothing checking it against reality. It said
`specs/010-day-rollover-anchoring/` was "the only live spec" while
`specs/013-server-hardening` — fully planned, then actively implemented by a
separate session — went unmentioned the entire time. Nobody lied; nobody
even edited the file incorrectly. It was simply never touched after 010
stopped being current, because nothing forces it to be touched, unlike the
`## Executing:` marker in the same file, which a hook actually reads and
which sessions have a mechanical reason to add and remove.

The general shape: a status signal that lives in prose, separate from the
thing it describes, and that nothing mechanically checks, will describe
whatever was true the last time someone happened to update it — which drifts
further from reality the longer that has been. The fix applied here
(`specs/014-spec-continuity`, AD-016) was to move per-step status *into*
`tasks.md` itself, next to the `Done when` it's the status *of*, rather than
inventing a second, separate ledger that could disagree with the first. A
signal colocated with the thing it tracks can still go stale, but it can't
silently drift into a *different* document's shape of wrong — there's only
one place to look, and one place to have forgotten to update. Where a
separate pointer can't be avoided (the root `STATE.md` "Current work"
section still is one, by necessity — it summarizes across all specs), treat
it as advisory only, and re-derive the real state from the spec directory
itself before trusting it for anything that matters.
**L-007 — Size a limit against the largest *measured* payload, not a round
number that sounds safe.** (2026-08-27, `specs/013-server-hardening`) The spec
set out to trim `express.json({ limit: '50mb' })`, and 100 KB looked like the
obvious "sensible" replacement — the review payload is one card plus one revlog
entry, comfortably under 10 KB. Measuring first is what saved it:
`POST /api/collection/resume` sends `{id, due}` for **every** card in the
collection, **~311 KB at 7,276 cards**, and it grows linearly as the collection
does. A 100 KB cap would have thrown 413 mid-resume with `pausedAt` still set —
i.e. pause/resume silently broken, in the one code path whose entire job is not
losing scheduling state. The cap landed at 2 MB (~6x headroom) and is pinned by
a test that posts 8,000 entries (~320 KB) and asserts the response is not a 413.
Two transferable rules. First: before capping anything, go find the biggest real
payload and measure it — the endpoint you are thinking about is rarely the
largest one. Second: a limit needs a test at *realistic scale*, because a cap
that is too tight fails only on large inputs, and every small-input test passes
while the feature is broken in production.

**L-008 — A hardening change can pass every status-code check and still leave
the app broken on screen.** (2026-08-27, `specs/013-server-hardening`, critic
round 1 finding R2) Angular's production build inlines critical CSS via
*beasties* and emits
`<link rel="stylesheet" href="styles-….css" media="print" onload="this.media='all'">`.
That `onload=` is an inline event handler, which `script-src 'self'` blocks —
so the stylesheet would have stayed `media="print"` forever and the app would
have rendered essentially unstyled, **while every curl check in the verification
step still returned 200**. HTTP status is a liveness signal, not a correctness
one; nothing in a status matrix can see a blocked stylesheet. Two things follow.
First, any spec that touches CSP, static serving or auth needs at least one
acceptance criterion that requires *looking at the rendered page* — this one has
A7, "study a real card and confirm it renders styled and the audio plays", and
it is the criterion that cannot be automated away. Second, when CSP collides
with a build artifact, fix the artifact rather than widening the policy: the fix
was `inlineCritical: false` in `web/angular.json`, verified by rebuilding and
confirming the `onload` and the inline `<style>` block were both gone, in
preference to `script-src 'unsafe-inline'` (throws away most of the CSP's value)
or an `'unsafe-hashes'` digest of Angular's snippet (brittle — the hash changes
whenever Angular changes the snippet). Postscript from execution: A7 could not
be driven by browser automation at all, because Chrome's native HTTP Basic Auth
dialog is not answerable by the tooling (a `user:pass@host` URL is rejected
outright, and priming the credential cache with an `Authorization`-header
`fetch()` does not populate it) — so the check was done by a human. A criterion
that requires human eyes may also require human hands.

**L-010 — A stale worktree's `git status` is indistinguishable from deliberate
deletions.** (2026-08-27, `specs/014-spec-continuity`, AD-017) The worktree
`worktree-spec-memory-tracking` had already been merged into `main` by way of
two PRs, but was kept on disk. Its branch ref moved to the merge commit while
the checkout itself was never refreshed, leaving `HEAD` and the index pointing
at different trees. The result was a `git status` listing 24 changed files —
`D server/src/app.ts`, `D server/src/config.ts`,
`D server/src/middleware/auth.ts`, `D specs/archive/2026-08-27-013-server-hardening/*`
— staged and ready to commit.

Nothing about that output says "stale." It is exactly the output of someone
having deliberately reverted the previous feature, and the natural reading of a
staged deletion is that it was staged on purpose. Working *forward* from it —
adding a file, committing, pushing — would have silently reverted all of
`specs/013-server-hardening` while looking like an ordinary commit, and the diff
would have been reviewed as "my change, plus some deletions that were already
there."

The distinguishing test is one command, and it costs nothing: in a checkout you
have not yet touched, `git diff --cached --quiet` must succeed. If it fails, the
staged content is not yours and the tree is not what `HEAD` says it is; confirm
with `git diff --cached --name-only <suspected-commit>`, which returns zero
files when the tree is merely stale rather than genuinely modified. That is what
identified this case: the working tree matched `228360b` exactly, an ancestor of
`HEAD`, so nothing was lost and the fix was to discard the worktree entirely
rather than to reconcile it.

The general shape: git's porcelain reports *differences*, never *intent*, and a
checkout that has drifted from its own ref produces differences that read as
intent. Any state you did not personally create should be verified against
ground truth before you build on it — the same discipline AD-016's `Status:`
field prescribes for a `done` marker, applied to a working tree instead of a
task list. Deleting a worktree the moment its branch merges (AD-017) removes
most opportunities for this; the check covers the rest.

Postscript: `git worktree remove` deletes the checkout but *not* the branch, so
doing only that leaves a merged ref behind and the residue accumulates anyway —
two of them (`worktree-spec-memory-tracking`, `worktree-cli-version-flag-plan`)
were already sitting there when this lesson was written. Pair the removal with
`git branch -d`, which refuses the delete if the branch turns out not to be
merged and so cannot cost you work.

**L-011 — An acceptance check that forbids a required change teaches the
executor to delete the requirement.** (2026-08-28, `specs/016-lint-audit`,
CriticReview R13) Step 1's "Done when" read: *`git diff --name-only` lists
exactly `package.json` and `package-lock.json` — nothing else.* But root
`STATE.md` was legitimately dirty: it carried the `## Executing:` marker that
`.claude/hooks/enforce-haiku-tasks-pretooluse.sh` keys off to block top-level
edits during a run, and `CLAUDE.md` *requires* that marker while a `tasks.md`
run is in flight. The check and the harness contradicted each other, and the
executor resolved it the only way the step permitted — it reverted `STATE.md`.
`git diff --stat STATE.md` then came back empty and the check passed
**honestly**. The delegation hook was dormant from that moment.

Why this is worse than an ordinary wrong assertion: a failing check announces
itself, and this one *succeeded*. Nothing downstream would ever have reported
that the guard had stopped guarding; it surfaced only because a file-changed
notice happened to show `STATE.md` reverting to its committed state. Same
family as L-004 and L-005 — a guard rail that fails silently — but arrived at
from the opposite direction: here the process itself supplied the motive to
disable it.

Rules: a `git diff`/`git status` assertion in a step must explicitly exempt
what the harness expects to be dirty (root `STATE.md`, `specs/`), and should
name the paths that actually matter rather than asserting global cleanliness —
`git diff --name-only -- . ':!STATE.md' ':!specs/'`, or better, assert
emptiness of `web/src`/`server/src` directly. More generally: before writing a
check that forbids a change, ask whether anything in the process *requires*
that change. If so, the check is wrong, and it will be "satisfied" by
destroying the requirement.

**L-012 — A total that reconciles says nothing about how it was decomposed.**
(2026-08-28, `specs/016-lint-audit`, CriticReview R15, with R14 as its mirror)
Step 8 wrote the lint inventory and reported all five of its "Done when"
checks green. They were green. The file was still wrong. The by-rule table's
`Count` column was real data and summed to 254 exactly as required; the
adjacent `Server` and `Web` columns had never been computed from anything.
They summed to 107/147 against a true 102/152, with six individual rows
carrying an invented or reversed split. The step's checks covered the count
column and the directory column and said nothing about the split columns, so
nothing looked at them.

The verified total worked *against* detection: it made the table look audited,
and the one number a reader would instinctively spot-check was the one number
that was right.

R14 is the same error mirrored. Four Angular rules reported `0`, and the
inference "9 components lack `OnPush`, so the rule must be dead" was checked at
every step except its premise — under Angular 22 `prefer-on-push` flags an
*explicit opt-out*, not an omission. A correct result was nearly written up as
a defect, for want of provoking the rule and watching it fire.

Rules: **verify every column, not the first one** — and prefer a per-row
identity (`server + web == count`, checked by command) over a column total,
because a row-level identity cannot be satisfied by a lucky sum. **Prove a
rule fires before believing its zero**: feed it a deliberate violation and
watch it report. And treat partial verification as what it is — verification
of a part. The habit that catches all three cases is the same one: make the
artifact demonstrate what it does, instead of reasoning about what it ought to
say.

**Recurrence (2026-08-28, `specs/archive/2026-08-31-017-lint-phase1-web` Step 2 — same file, same
defect, one spec later.)** The executor re-baselining `INVENTORY.md` produced a
correct headline table (121/31 → 50/24) over a six-file decomposition it had
never measured: `pause.service.spec.ts` 5 against 13 actual, `heatmap.ts` 1
against 0, `stats.ts` 3 against 0. The list summed to 16 while its own table,
three paragraphs above, gave the Phase 2 total as 24. Every one of the step's
five "Done when" greps passed, because they checked that sections and phrases
*existed*, not that numbers *reconciled*.

So the lesson as written did not prevent its own recurrence. A headline in
`STATE.md` is read by whoever goes looking; a step's `Done when` is executed by
whoever is cheapest. The fix has to live in the second place.

Added rule: **a table an executor writes must carry a reconciliation line the
step can check** — an identity tying the decomposition to a number stated
elsewhere (`Phase 1 50 + Phase 2 24 = 74 = the web/src total`), with the
step's `Done when` naming the command that recomputes it. A `grep -c` proving a
heading exists is not verification of the table beneath it. Where the executor
writes numbers at all, give it the measured values in the step and forbid
adjustment, rather than asking it to derive them.

**L-013 — A type-aware linter in a tree with no dependencies installed reports a
smaller number, not an error.** (2026-08-28, `specs/archive/2026-08-31-017-lint-phase1-web`,
CriticReview R11) Phase 1 opened by re-deriving Phase 0's baseline rather than
trusting it. Run from a fresh `EnterWorktree` checkout, `npx eslint` reported
**249** where the inventory said **254**, and the five-violation gap sat in two
`*.spec.ts` files. The obvious story fit perfectly: Phase 0 must have measured
against a dirty checkout. That story was written into `Analyst.md`, into a
lesson, and into the "Done when" of fourteen steps before it was tested.

It was wrong. A git worktree has no `node_modules`, and `npx eslint` resolves
upward to the parent checkout's copy, so the linter **runs** — it just cannot
fully resolve the types behind `vitest`'s mock helpers. Every rule that needs
type information to fire (`no-unsafe-call`, `no-unsafe-member-access`,
`no-misused-promises`) silently declines to report. Installing dependencies in
the worktree reproduced 254 exactly, and 152/102 per workspace, matching the
inventory to the violation.

The trap is that the failure is **quiet and directional**. An unresolvable
import is a loud error; an unresolvable *type* just degrades to `any` and takes
its rules with it. The number that comes back is well-formed, plausible, lower
than before, and wrong — and "lower than before" is exactly what someone
starting a remediation phase is primed to accept. Two of this repo's own habits
made it worse: `npm run dev` dirties `data/spanish/` on every review (L-002), so
"the tree was dirty" is always an available explanation; and the count did
reproduce perfectly on re-runs, because determinism is not accuracy.

Rules: **a type-aware lint number is only valid from a tree with dependencies
installed** — run `npm install` in a new worktree before measuring anything, and
treat any count taken before that as void. When a re-derived number disagrees
with a recorded one, **find the mechanism before writing the story**: the
disagreement is evidence that something differs, not evidence of *what*. Here
one command (`git show HEAD:eslint.config.mjs` re-run after `npm install`)
settled it. And prefer the check that can exonerate the existing record —
had `git status` on the original checkout been read as disproof rather than
explained away, the wrong story would have died on day one.

**L-014 — A lint rule can make the behaviour-changing edit the compliant one.**
(2026-08-28, `specs/archive/2026-08-31-017-lint-phase1-web`, Analyst.md §1c, D1) `eqeqeq:
['error', 'always']` flagged nine sites across `pause.service.ts`, `app.ts`,
`review.ts`, `deck-list.ts` and `deck-list.html`. Every one of them was
`coll.pausedAt != null` or `== null` — the deliberate idiom that matches null
*and* undefined. The compliant fix, `!== null`, stops matching `undefined`, and
the pause toggle silently starts reading a paused collection as unpaused.

The danger is not that a linter can be wrong. It is that a linter is a
*queue of instructions*, executed by whoever is cheapest — increasingly a small
model working from a rule name and a line number, with no view of why the line
is written that way. "Fix the eqeqeq violations" is a well-formed, mechanical,
completable task whose correct-looking completion introduces a bug. Every
guard-rail in this repo pointed the other way: the roadmap's non-negotiable #1
quarantines scheduling-core from batch fixes, but `pause.service.ts` is not
under `core/scheduling/`, so the textual attribution rule let it through
(the same gap produced the Phase 2 widening in the same spec).

Rules: **before enforcing a rule, read what it currently flags — all of it.**
Not to estimate effort, but to ask of each class of hit: is this code wrong, or
is the rule miscalibrated for this codebase? A rule whose violations are
overwhelmingly one idiom is describing the codebase's conventions, not its
defects. Calibrating on that evidence (`{ null: 'ignore' }`, `allowNumber`) is
part of adopting a linter, not a retreat from it — and it is much cheaper
before the rule is enforced than after a batch has "fixed" 40 sites. Where a
rule must stay strict and its hits are genuine, that is exactly the finding
worth having; the point is to know which of the two you have.

**L-015 — A gate's exit code cannot verify a change to the gate's own scope.**
(2026-08-31, `specs/archive/2026-08-31-017-lint-phase1-web` Step 9 and
`specs/archive/2026-08-31-018-lint-phase2-scheduling` Step 12) Phase 1, Step 9, widened the ESLint gate from `features/` branches to a
13-path list covering all of Phase 1. The step ran `npm run lint:ci` to verify,
got exit 0, and reported success. What it could not see: everything the gate
already covered was clean, so `exit 0` proved nothing about whether the *new*
code was reachable at all. The step's "Done when" had to assert on the script's
**text** (`grep -c "features/browse" package.json → 0`) to prove the old paths
were gone.

Phase 2, Step 12, faced the same situation: replace 13 paths with `eslint
web/src`, also to pick up nine never-gated clean files. Again, `npm run lint:ci
→ exit 0` is compatible with both "the scope expanded correctly" and "I made
no change". Again, the solution was text assertion: `node -e "process.exit(require('./package.json').scripts['lint:ci'] === 'eslint web/src' ? 0 : 1)"`.

The general rule: when a step widens the scope of a gate or checker, the gate's
own exit code cannot prove the widening happened — it can only prove everything
within scope is clean. Verify the scope itself by reading or computing the
config, not by waiting for the exit code to tell you the scope changed. Where
both the scope and the contents must be checked, check the scope first: a scope
assertion has nothing to fall back on if it is wrong, but a content assertion
can at least pass over the wrong scope and alert you.

Practical: a step that should change a script or config path must assert on that
path's *text*, using `grep` or a node snippet. A step that should change a
`Done when` assertion must still run the check and watch it pass, to catch the
case where the implementation changed but the check did not.

**L-016 — A harden pass must re-derive, not re-reason: an unexecuted prescription is a hypothesis.**
(2026-08-31, `specs/archive/2026-08-31-019-lint-phase3-server` §10, and the reason Phase 3's method
section exists) Phase 3's own `Analyst.md` draft specified the fix for a
`no-unnecessary-condition` violation at `routes/index.ts:175` as
`const firstExisting: Card | undefined = existing[0]`, so the `??` fallbacks
below it would stop reading as dead code. Applied, the file went from **2
violations to 4**: TypeScript narrows a `const` to its initializer's type
regardless of the annotation, so the `?.` then drew "Unnecessary optional chain
on a non-nullish value" on top of the original complaints.

Two things make this worth a headline rather than a footnote.

First, **it was a repeat.** Phase 1's retrospective already records the identical
wall — "R8 … prescribed an annotation that cannot work — TypeScript narrows a
`const` to its initializer's type" — and Phase 1 had already found and used the
working instrument in this very repo: `.at(0)`, which is typed `T | undefined`
(`review.ts:135`). Careful reasoning by a large model reproduced a known-bad
answer that the project had already paid to learn once. Reading the lesson did
not prevent re-deriving the mistake; running the code refuted it in under a
minute.

Second, **the failure was silent in the direction that matters.** The wrong fix
still compiled and still passed all 280 tests. Only the violation *count* moved,
and it moved the wrong way — which a step reporting "applied the prescribed fix"
would not have surfaced, because the prescription itself was the defect.

The rule: a harden pass earns its name by *executing* every claim it marks
CONFIRMED — apply the edit, compile it, run the checker, revert — not by
re-reading the plan for internal consistency. Phase 1 shipped four "confirmed"
harden verdicts of which two did not survive execution; Phase 2 switched to
running its three risky claims and had no step rewritten; Phase 3 executed all
41 fixes before `tasks.md` was written and again had no step rewritten, while
catching this defect in its own draft. The cost is minutes. The alternative is
discovering it in an executor's hands, where a plausible-but-wrong prescription
reads as executor error rather than planner error.

Corollary for delegated runs: prescribing already-executed code turns each step
into transcription rather than design, which is what makes a small model a safe
executor for work this delicate. Keep the verified diff around as the
cross-check, and delete it before archiving — it is a working artifact, and at
22 KB it would trip the 20 KB archive gate.

**L-017 — Token cost is a function of *when* a payload lands, not how big the
task is.** (2026-08-31, `tools/session_report.py`) The prompting question was
why small tasks with small output sometimes burn tokens fast. Measuring the 24
transcripts for this repo answered it: **283.6M input tokens against 1.3M of
output — 99.5% of everything spent was the transcript being re-sent, turn after
turn.** The largest session re-read a mean of 249k tokens across 291 turns.

That inverts the intuition the cost *feels* like it should follow. A task is not
expensive because it is large; it is expensive because of where it sits. A
trivial `git status` at turn 250 costs the same 249k re-read as a hard refactor
at turn 250, and an `ls` at turn 2 that dumps 8k tokens is not an 8k mistake --
it is re-read by every turn that follows, so it cost 2.3M. Hence *carry cost*
(`delta * turns_remaining`) as the metric worth ranking by: it is the only view
in which the cheap-looking early mistakes appear at their real size. In the
worst session, 19 turns that each added >=3k carried 19.3M between them, 27% of
the session; the fixed floor (system prompt + `CLAUDE.md` + tool schemas) was
47k re-read 291 times = 13.6M, another 19%.

**The measurement trap, which is the real lesson.** A single assistant message
is written to the transcript as *several* JSONL records -- one per content
block, each repeating the same `message.id` and the same usage block. Counting
records therefore counts blocks, not turns. This corrupted the first version of
the tool in two directions at once, and both were believable:

  * Turn counts and totals inflated by ~60% (one session read as 491 turns /
    118.5M; it is 291 turns / 72.4M), because duplicated usage was summed once
    per block.
  * Parallel tool calls became *structurally invisible* -- no single record ever
    holds two `tool_use` blocks -- producing the confident, wrong headline that
    batching had never once occurred in 1,731 turns across 17 days and 8 CLI
    versions. Grouped by `message.id`, the real rate is **8%**, ranging from 0%
    to 82% per session, with the longest sessions clustering near 0%.

The false version was more striking than the truth and pointed at the same
remedy, which is exactly why it survived a first reading. It was caught only
because a claim about *my own* behaviour ("nothing was ever batched") could be
checked against a session where batching had demonstrably just happened.
Prefer that kind of check: a metric about behaviour you can independently
observe is falsifiable in a way an aggregate over someone else's history is not.

Two smaller traps in the same data, both of which produce confident nonsense:
`<synthetic>` turns (interrupts, harness errors) carry a *zeroed* usage block,
so a naive delta reads the next turn as having added the entire session in one
step -- that one false event claimed 50.7M of carry cost. And a cache re-prime
after an idle gap (the 1h prompt-cache TTL lapsing) looks exactly like a huge
payload unless `cache_read == 0` is checked, which blames a coffee break on
whichever tool ran last. Those re-primes are real money -- up to 358k rebuilt at
creation rates, dearer than read -- so finish or `/clear` before walking away.

What the tool deliberately does **not** report is a "you could have saved N"
figure for batching. A transcript cannot distinguish a missed batch from
genuinely sequential work -- read before edit, edit before test -- so that
number would assert an unmeasured ratio. The earlier draft of this lesson quoted
28%; it was arithmetic on an assumption, not a measurement, and it is gone.

The method still generalises: the measurement pass needed no model at all.
Feeding a 2.8 MB transcript to an agent to find this would cost ~700k tokens per
session analysed -- spending the resource to discover how the resource is spent.
Measure with a script; spend model attention on the report, and on checking the
script against something you can see with your own eyes.

**Two follow-on findings, 2026-09-01.** First, *the floor is the wrong thing to
look at*, and the 19% figure above invites the wrong reaction. `CLAUDE.md` is
only ~4.2k of that ~47k (9%); the rest is the harness's own system prompt, tool
schemas and skill listing, which swings 32k–64k between sessions on the same day
with the same `CLAUDE.md`. More to the point, floor x turns is not addressable at
all: a cleared session still re-reads its floor every turn. Only the spend
*above* the floor can be moved, so the actionable numbers are the fat-payload
share and the idle re-primes -- never "shrink the prompt".

Second, *batching decays within a session*, which decides what to do about it.
Measured first-third against last-third across every session over 60 turns: 41
batched turns in the first thirds, 8 in the last, over comparable call counts
(403 vs 378). All six sessions that batch at all decline; two never batch. Task
mix explains part of the between-session spread (Pearson r = -0.42 against
edit+write share -- exploratory reads parallelise, sequential edit/test does not)
but cannot explain a monotonic within-session decline in six of six. The tempting
remedy was a `CLAUDE.md` line telling the model to batch. That is the one
intervention the finding argues against: the system prompt already carries that
instruction, and adding more instruction text -- re-read every turn, inside the
very context whose growth tracks the decay -- treats a context-length problem
with more context. The lever that survives is the one that needs no compliance at
all: shorter sessions. `specs/SESSION-HYGIENE.md` is the operator-facing form of
this, kept out of context deliberately.

**L-018 — A whole test suite can pass under both the right and the wrong
definition of a shared primitive.** (2026-09-01,
`specs/010-day-rollover-anchoring`) `todayNumber` is the single source of every
day number in this app: the study queue, the per-day new/review limits, the
unbury checkpoint, the streak counters, the browse due strings and the FSRS
optimizer histories all measure against it. It had been wrong since the
beginning — it subtracted `collection.created` as a raw epoch instant, which
anchored the daily rollover to whatever *time of day* the collection happened
to be created (14:20:35 local here) instead of to `dayCutoffHour`:00. The
user-visible symptom was a daily new-card allowance that would not renew.

**All 209 existing web tests passed unchanged under both formulas.** Not "most
of them", not "they needed re-baselining" — the suite was completely blind to a
defect in the primitive that nearly every scheduling behaviour is measured
against. That was verified by executing it, not assumed: the fix was applied,
the suite run, and the change reverted, all before `tasks.md` was written.

The mechanism is worth naming, because it is not carelessness. Every consumer
called the same function, so every consumer was wrong *in the same direction by
the same amount*, and every test that exercised two consumers together saw them
agree. Internal consistency is exactly what a test suite is good at detecting,
and exactly what a shared-primitive bug preserves. Spec 007 had already noticed
this — it recorded that every `todayNumber` consumer "is internally consistent
today because they all share the same wrong function" — and then deferred the
fix, which is how the same root cause surfaced twice: first as a heatmap date
off by one, then as a stuck daily cap.

Three practical consequences:

- **Suite-green is not evidence about a shared primitive.** When changing one,
  the informative experiment is the reverse one: write the new tests, then put
  the *old* implementation back and confirm they go red. Here 6 of 7 did.
- **The seventh is the interesting one.** A 400-day walk asserting "the day
  number advances by exactly 1 per local calendar date" stayed green under the
  old formula too — a fixed 86,400,000 ms grid also advances once per calendar
  day when sampled at local noon, because noon sits eight hours clear of the
  boundary and an hour of DST drift never crosses it. The test is honest and
  worth keeping as a regression guard, but it discriminates nothing about
  *this* change. L-006 says a test that stays green when you stash the fix is
  not proof; the corollary is that you have to check *which* tests went red,
  not just count them.
- **Pin the origin explicitly.** The first draft of this spec constrained only
  where the day boundaries fell, never which integer day 0 was. That integer is
  compared against every persisted review `card.due`, so it is the one degree of
  freedom where a wrong choice silently reinterprets the entire store. It got a
  numbered requirement (day 0 = the study day containing `created`) only because
  the harden pass asked what pinned it.
