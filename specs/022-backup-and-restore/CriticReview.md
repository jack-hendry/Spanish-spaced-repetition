# CriticReview — 022 backup and restore (harden round 1)

Round 1 of 2, run against `Analyst.md` **before `tasks.md` exists** — the
cheapest place to find a wrong premise is before any step is written against
it.

Per **L-016** ("a harden pass must re-derive, not re-reason: an unexecuted
prescription is a hypothesis") every finding below that could be settled by
running a command *was* settled by running one. Findings are labelled
**MEASURED** (a command produced this) or **REASONED** (argument only, still
a hypothesis).

---

## C1 — CRITICAL: `push-fly-state.sh --yes` has never worked. The restore path is broken. — MEASURED

**The single most important finding of this pass.** The tool that restores
the irreplaceable half of this project aborts before uploading a single byte.

`tools/push-fly-state.sh:173` uses `local size` **outside any function**.
Under the script's own `set -euo pipefail` that is a fatal error:

```
$ bash tools/push-fly-state.sh --app no-such-app-xyz --yes <scratch-dir>
=== PUSH DETAILS ===
App name: no-such-app-xyz
Source directory: .../pulltest
Remote staging directory: /data/.push-stage.1789653911-30070

Local file sizes:

tools/push-fly-state.sh: line 173: local: can only be used in a function
```

Isolated repro of the construct:

```
$ printf '#!/usr/bin/env bash\nset -euo pipefail\nn=0\nfor f in a; do\n  local size\n...' > t.sh && bash t.sh
t.sh: line 5: local: can only be used in a function
exit=1
```

Structural confirmation — `print_plan()` has the same construct *legally*,
which is why the dry run passes and the real run does not:

```
$ awk '...infunc...' tools/push-fly-state.sh
110: IN-FUNC:   local total_size=0
114: IN-FUNC:       local size
134: IN-FUNC:   local remote_file="$1"
173: TOP-LEVEL:     local size      <-- the bug
```

**Why nobody caught it.** The failure is in the `--yes` branch only. Without
`--yes` the script prints the plan and exits at line 147 — never reaching
line 173. So *every dry run passes* and the one path that matters fails.

**This contradicts a claim in two shipped documents.** `ROADMAP.md` Phase 2
and `archive/2026-09-17-021-fly-deploy` both state the script "was exercised
on a scratch round-trip in Step 18". `git log -- tools/push-fly-state.sh`
returns **exactly one commit** (`0a4cc52 Phase 1: deploy to Fly.io`), so the
file has not changed since it was written. The `--yes` path therefore could
not have run to completion in Step 18 as described.

**Consequences for the plan:**

1. Analyst §1's table understates the gap. "Restore unproven at scale" is
   too kind — it is *proven broken at any scale*.
2. **S4's drill cannot run until this is fixed.** A fix step must precede it.
3. A4's principle ("verified by causing it, not by reading the YAML")
   was the right instinct and must be applied to the restore path too: the
   drill is what converts the fix from a plausible edit into a proven one.
4. This is an `L-NNN` in its own right — see §Lessons below.

**Fix:** delete the `local` keyword at line 173 (the loop is at top level;
the variable is already effectively global there, as `local_total` beside it
is). One-word change. The *fix* is trivial; the *finding* is not.

## C2 — CRITICAL: the scheduled pull cannot work as planned — `fly ssh` does not auto-start a stopped machine. — MEASURED

Analyst Q2 guessed this might be a problem. It is not a might.

With the machine in its normal resting state (`min_machines_running = 0` +
auto-stop, so this is the state a cron will almost always find):

```
$ fly machine list --app spanish-srs        # -> stopped
$ fly ssh sftp get /data/spanish/collection.json ... --app spanish-srs
Error: app spanish-srs has no started VMs.
It may be unhealthy or not have been deployed yet.
$ fly machine list --app spanish-srs        # -> stopped   (no auto-start)
```

Auto-start is driven by the **HTTP proxy**; `fly ssh` bypasses the proxy
entirely and so never triggers it. A nightly workflow that just calls
`pull-fly-state.sh` would therefore fail **every single run**.

Mitigating credit where due: it fails *loudly* rather than writing empty
files — `pull-fly-state.sh`'s `|| { echo Error; exit 1; }` per-file guard
plus its non-empty and JSON-parse checks are all sound. The backup would be
absent, not silently corrupt. That is the correct failure direction, and it
is the reason C2 is a plan defect rather than a data-loss event.

**Verified fix:** an explicit start first. Measured end to end:

```
$ fly machine start 850d53cd95d668 --app spanish-srs    # 1.0s
$ bash tools/pull-fly-state.sh <scratch>
Successfully pulled 7 state files ... updated 7, unchanged 0    # 19.5s
```

So the real workflow shape is **start → pull → commit-if-changed → stop**,
not **pull → commit**. `tasks.md` must reflect that, and A1/A4 must be
checked against a run that began from a *stopped* machine — a workflow
smoke-tested only while the machine happened to be awake proves nothing
about the nightly case. **Add that precondition to A1 explicitly.**

## C3 — DOWNGRADED TO MINOR: auto-stop *does* reclaim a machine woken for sftp. Explicit stop is hygiene, not a fix. — MEASURED (resolved)

> **Resolved during this pass — the concern below was not borne out.**
> An observation run settled it:
>
> ```
> 14:06:35Z started   14:08:05Z started   14:09:36Z started
> 14:11:07Z started   14:12:37Z stopped   <- STOPPED after 539s from start
> ```
>
> The machine was woken by `fly machine start`, served **only** an `sftp`
> pull and **zero** HTTP requests, and the proxy still reclaimed it ~9
> minutes later — consistent with Phase 1's ~7-minute measurement. So the
> cost-regression risk described below is **not real**: a nightly backup does
> not silently convert the app to always-on.
>
> **What survives:** an explicit stop is still worth doing, for two smaller
> reasons — it avoids paying ~9 minutes of idle runtime on every run (~4.5
> hours/month, pennies, but free to avoid), and it makes the end state
> deterministic rather than dependent on a proxy behaviour that is not
> contractual. **A11 stays as an acceptance criterion**, but as a check that
> the machine ended up stopped, not as a guard against a cost regression.
>
> Recorded rather than deleted, per `specs/STATE.md` Rule 2's spirit: the
> reasoning that turned out wrong is the useful part. The original argument
> follows.

### Original finding (superseded by the measurement above)

The machine's event log shows every prior stop was `SOURCE: proxy` with
`requested_stop=true` — i.e. the proxy reclaiming a machine after *HTTP*
traffic drained:

```
 stopped  │ exit     │ flyd  │ 08:39:43 │ exit_code=0,oom_killed=false,requested_stop=true
 stopping │ stop     │ proxy │ 08:39:41 │
```

Phase 1's "~7 minutes idle → stopped" was measured after a browser session.
A machine woken for an `sftp` pull serves **no** HTTP requests at all, so it
is not established that the proxy reclaims it on the same schedule — or at
all. If it does not, a nightly backup silently converts the app from
auto-stop (~$0–1/mo) to always-on (~$2.02/mo *plus* the volume), quietly
invalidating the roadmap's cost estimate.

An observation run is in progress at the time of writing and its result must
be recorded before this is closed. **Regardless of the outcome, the workflow
should stop the machine explicitly** — relying on a reclaim you did not
command is how a cost regression hides for a month. Explicit stop is one
line and removes the question.

**This is a new acceptance criterion the Analyst does not have.** Proposed:

> **A11 — The backup workflow leaves the machine stopped.** After a
> scheduled run completes, `fly machine list` shows `stopped`. Evidence: the
> state before the run, and after.

*(End of superseded argument. The measurement at the top of C3 is what to
act on: A11 is kept, its severity is not.)*

## C4 — MAJOR: Q1 could not be settled, and it is still the highest-risk unknown. — BLOCKED

Analyst Q1 ("can a deploy token run `fly ssh sftp`?") called itself "the
single most likely thing to invalidate the plan". It remains open.

Progress made: `fly tokens create --help` shows a **least-privilege option
the Analyst did not know about** —

```
  ssh          Create token for SSH'ing to a single app
```

This is materially better than the deploy-token-or-org-token dilemma Q1
posed: `fly tokens create ssh` is scoped to SSH on one app, which is exactly
and only what the workflow needs. That is the right answer to
non-negotiable #1, and it removes the "strictly worse credential" worry.

**But it is unverified.** Attempting to create one was denied by the
environment's permission classifier (`Credential Materialization`), and that
denial was not worked around. So the following remain hypotheses:

- that `fly tokens create ssh` yields a token that works non-interactively,
- that `FLY_API_TOKEN` is the env var flyctl reads for it,
- that it permits `fly machine start`/`stop` as well as `sftp` — **note C2
  and C3 mean the workflow now needs machine start/stop too, which an
  SSH-scoped token may well not grant.** This is a *new* risk created by C2,
  and it may force a broader token after all.

**This must be resolved before the workflow step is written, not during it.**
Recommended: the user creates the token and sets the GitHub secret; the
capability question (does an SSH-scoped token permit machine start?) is then
answered by a real `workflow_dispatch` run rather than by argument. If it
does not, the fallback is an org or deploy token, and *that* is a security
trade-off the user should make knowingly — which is precisely
non-negotiable #1's requirement.

## C5 — MODERATE: the pull script relies on a bash construct that behaves differently across bash versions, and CI runs a different bash. — MEASURED (locally) / REASONED (CI)

Both scripts use `((POSITIONAL_ARGS++))`, `((updated++))` and
`((unchanged++))` from a zero start. `(( expr ))` returns exit status 1 when
`expr` evaluates to 0, and a post-increment's value *is* the old value — so
`((n++))` with `n=0` is a status-1 command, which `set -e` can treat as
fatal.

Locally this does not fire:

```
$ bash --version   # GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
$ bash -c 'set -euo pipefail; n=0; ((n++)); echo "survived, n=$n"'
survived, n=1
```

and the full pull ran clean end to end. **But the workflow will not run on
this bash.** `ubuntu-latest` ships bash 5.x, and this repo has no bash 5
locally (`/opt/homebrew/bin/bash` absent) and no Docker daemon running, so
the behaviour there could not be checked from here.

This is a **latent portability trap of exactly the same family as C1**: a
construct that is fine on the path someone tested and fatal on the path that
matters. Given C1, the prior on "this script is bash-fragile" should be
high, not low.

**Required:** a `tasks.md` step that runs both scripts' argument parsing and
counting paths under bash 5 (in the workflow itself, or a container) *before*
the nightly schedule is trusted. Cheap insurance: replace `((n++))` with
`n=$((n+1))`, which is unconditionally status 0. Note this touches
`pull-fly-state.sh`, so it is a code change, not just a workflow addition —
`tasks.md` must budget for it.

## C6 — MODERATE: A3 is currently untestable-by-accident, and that is lucky rather than designed. — MEASURED

A3 ("a no-op run commits nothing") is the criterion that separates "it ran"
from "it ran correctly". Right now it can be exercised immediately, because
the repo copy is **byte-identical** to Fly:

```
SAME  collection.json | SAME  notetypes.json | SAME  decks.json
SAME  deckoptions.json | SAME  notes.json    | SAME  cards.json
SAME  revlog.ndjson
repo revlog: 3915 lines   fly revlog: 3915 lines
```

Two consequences:

1. **Good news for the Analyst's framing.** §1's table implies the off-Fly
   copy is stale. It is not — `65532a0` is current as of this pass. The
   problem is structural (nothing *keeps* it fresh), not a present backlog.
   §1 should say so, or it overstates the incident risk.
2. **A3 must be ordered to exploit this.** Run the no-op check *before*
   studying any cards, or the window closes and manufacturing a no-op state
   becomes a chore. This is an ordering constraint on `tasks.md`, and it is
   invisible unless written down.

## C7 — MINOR: the pull script's "updated/unchanged" summary cannot distinguish a fresh directory from a real change. — MEASURED

`Successfully pulled 7 state files ... updated 7, unchanged 0` was printed
against an **empty** scratch dir, where "updated" merely means "did not
previously exist". The workflow must therefore decide "did anything change?"
from `git status`/`git diff --quiet`, **not** by parsing this line. Worth
stating in the step so the executor does not reach for the convenient string.

## C8 — MINOR: Q5 confirmed — a backup commit will re-trigger the full CI suite. — MEASURED

`.github/workflows/ci.yml` runs `on: push: branches: [main]` with no
`paths-ignore`. A data-only backup commit will therefore run `tests`,
`clean-table-gate`, `lint` and `hooks` — four jobs including two `npm ci`
installs — nightly, for a commit that changes only JSON under
`data/spanish/`.

It is not harmful (the gates pass: no `specs/archive/` additions, no
`L-NNN` change), just waste. Decide deliberately in `tasks.md`; a
`paths-ignore` on `ci.yml` is the cleaner half of the choice, since
`[skip ci]` in the commit message also suppresses any future workflow anyone
adds.

## C9 — MINOR: Analyst D3 is right that snapshots exist, but A8 should demand a *dated* re-check.

`Scheduled snapshots: true`, `Snapshot retention: 5`, and
`fly volumes snapshots list` → none, on an 18-hour-old volume. The honest
reading is "configured, unproven". A8 as written ("snapshot configuration is
recorded") can be satisfied by pasting the config — which is the same
mistake C1 punishes. A8 should require observing **at least one snapshot
actually existing**, or, if none has appeared by then, recording that fact
plainly rather than reporting the config as if it were an outcome.

---

## Verdict on the Analyst

Sound in structure; the scope boundaries (O1–O7) are drawn in the right
places and D1/D2/D4 are properly attributed to the user. **Two premises are
wrong and one section understates the problem:**

- Q2 is not an open question, it is a defect (C2). The workflow shape in S1
  is wrong as written.
- §1's "restore unproven at scale" is wrong — it is broken outright (C1).
- §1 implies a stale off-Fly copy; it is currently current (C6).

## Required changes before `tasks.md` is written

1. Add a **fix-`push-fly-state.sh`** scope item, ordered **before** S4's
   drill. (C1)
2. Rewrite S1's workflow shape to **start → pull → commit-if-changed →
   stop**. (C2, C3)
3. Add **A11** (the run leaves the machine stopped). (C3)
4. Add a **bash-5 verification** item covering both scripts. (C5)
5. Order the **A3 no-op check before any card is studied**. (C6)
6. Correct §1's restore row and staleness implication. (C1, C6)
7. Settle **Q1** with the user before the workflow step is written — it is
   now also a *machine start/stop* capability question, not only SSH. (C4)

## Lessons this pass produced (for `STATE.md` + `LESSONS.md` at ritual time)

- **A dry-run mode that takes a different code path validates the path
  nobody runs.** `push-fly-state.sh` passed every dry run precisely because
  `print_plan()` returns before the broken line; the safety flag that made
  the tool feel safe to test is what kept the defect hidden. (C1)
- **"Exercised in Step N" is a claim; `git log` is evidence.** Two documents
  asserted the restore path had been round-tripped, and the file's single
  commit says it could not have been. Prefer evidence that cannot be written
  optimistically. (C1)
- **A wake-on-demand machine is only awake for the protocol that wakes it.**
  Auto-start is an HTTP-proxy behaviour; `fly ssh` gets `no started VMs`.
  Any scheduled job that reaches a sleeping app over a non-HTTP path must
  wake it itself. (C2)

---

# Harden round 2 — against `tasks.md`

Round 1 judged the plan; this round judges the *steps*. Same rule: every
finding is labelled **MEASURED** (I ran something) or **REASONED**. I re-ran
every anchor and every `Done when` command I could run without the token,
rather than re-reading the file (**L-016**).

**Anchors that check out** — no action needed, recorded so the next pass does
not re-verify them: Step 1's awk prints exactly `110 IN-FUNC, 114 IN-FUNC,
134 IN-FUNC, 173 TOP-LEVEL`; Step 2's four `((VAR++))` anchors all exist at
the named lines; `push-fly-state.sh` really does take `--app` and one
positional source dir; `fly tokens list --app` is a valid invocation.

## R1 — CRITICAL: no step in this file can satisfy A1. — MEASURED

A1 requires "at least one successful **non-manual** run — not just a
`workflow_dispatch` smoke test", and names the machine state before it as
evidence. Every step that runs the workflow dispatches it by hand: Step 7
(`gh workflow run backup.yml`), Step 8 ("a second `workflow_dispatch` run"),
Step 9 ("dispatch it"). Nothing anywhere waits for or inspects a cron-fired
run.

Step 19 walks A1 and would have to write "not verified" — for the one
criterion that covers *the only mode this system will ever run in*. A
dispatched run proves the steps work when a human is watching; the whole
premise of the phase is that no human is watching.

The fix is nearly free, because the cron is live from Step 6 onward and fires
every 6 hours: Step 10's checkpoint records the first genuine scheduled run
rather than asserting one happened.

```sh
gh run list --workflow=backup.yml --json event,conclusion,createdAt,url \
  --jq '[.[] | select(.event=="schedule")][0]'
```

Empty result means A1 is not yet met and the checkpoint waits — at most 6
hours, once, for the criterion that matters most.

## R2 — MAJOR: A2 and Step 11 are unsatisfiable in the state Step 8 deliberately creates. — MEASURED

Three things need mutually exclusive conditions and the file orders only two
of them:

| Needs | Step | Condition |
|---|---|---|
| A3 | 8 | repo **equals** Fly — a no-op run |
| A2 | 7 | a real bot commit — repo **differs** from Fly |
| Step 11's `Done when` | 11 | "the next backup commit to `main`" — differs |

Step 8 says "Do not study any cards on production before this step", which
correctly protects A3. But **nothing after Step 8 ever introduces a change**,
and the drill in Steps 12–15 is explicitly on a scratch app so it cannot.
Step 7's A2 evidence is written as conditional ("*if* state changed") — so on
the likely path it produces nothing, and Step 11 then waits forever for a
backup commit that no step causes.

Needs a step between 8 and 11 that studies one card **on production** —
phone or `POST /api/review` — expressly to manufacture the change that A2 and
Step 11 both consume. It is one line of intent and it unblocks two criteria.

## R3 — MAJOR: this spec will be refused by its own push gate. — MEASURED

`specs/STATE.md` is **291 lines against a 300 budget**. Step 17 writes an
`AD`; the span from `AD-025` to `AD-026` is **15 lines**, so call it ~14.
Step 19 adds up to **3** `L-NNN` headlines. That lands near **308**.

Gate 4 of `scripts/clean-table-check.sh` does not warn — it prints
"STATE.md is over its size budget. Rotate it, then push again." and
`exit 1`. Step 19's item 7 runs `--check`, which will simply *report* the
failure at the very end, after everything is written.

And the rotation cannot be bolted on there: `CLAUDE.md` is explicit that
`state_rotate.py --apply` "is run by a human who has decided to rotate", and
choosing which decisions are still live is a judgement call. So this needs to
be a **named decision point before Step 17 writes**, not a surprise at the
final push.

## R4 — MODERATE: Step 2's positive control mutates the working tree, and can lose Step 1's fix. — MEASURED

Step 2 satisfies **L-019** with `git stash && grep -c … && git stash pop`.
At that moment Step 1's fix to `push-fly-state.sh` is uncommitted, so the
stash takes it too, and a `git stash pop` that conflicts leaves a one-word
critical fix sitting in the stash where the next step will not see it. A
verification step should not be able to damage the thing it verifies.

The same proof is available without touching the tree:

```sh
git show HEAD:tools/pull-fly-state.sh | grep -c '((.*++))'   # → 3
```

Measured: returns `3`. Exact, non-mutating, and it reads the pre-fix file by
construction rather than by hoping the stash was clean.

## R5 — MODERATE: Step 6's change-detection is correct only by accident of today's state. — MEASURED

Step 6 mandates `git diff --quiet -- data/spanish/`, which is **blind to
untracked files**. I checked: all seven state files are tracked today, so it
works. But `pull-fly-state.sh` writes a fixed list of seven, and the day an
eighth file joins that list, the first backup containing it commits nothing
and reports success — silent loss, which is exactly what non-negotiable #2
forbids.

This is C7's shape repeating: a check that passes because of the current
state rather than because of what it tests. `git status --porcelain --
data/spanish/` sees both, and `data/spanish/media/` is gitignored
(`.gitignore:28`, verified) so it will not be polluted by the 252MB tree.

## R6 — MODERATE: two steps edit `ci.yml` and neither one says so. — MEASURED

Step 3 modifies the `hooks:` job; Step 11 modifies the `on: push` trigger.
They are ordered 3 → 11 so the parallel rule is satisfied, but:

- Step 3's `Files` does not mention that Step 11 returns to the file.
- Step 6's `DO NOT TOUCH` says "`.github/workflows/ci.yml` (Step 11 owns
  it)" — **wrong**, Step 3 owns it first.

A haiku agent on Step 11 reading only its own `Files` section has no reason
to expect the `hooks` job to have changed under it since round 1's reading.
Both sections should name the other step.

## R7 — MINOR: Step 5's `Done when` may be unfalsifiable, which would also break the runbook. — MEASURED / REASONED

Measured: `fly tokens list --app spanish-srs` returns **zero rows** today, so
"exactly one live token" is a clean assertion *if* the token appears there.
Unverified: whether a token made with `fly tokens create ssh` is listed under
app scope or only org scope — `fly tokens list` takes
`-s, --scope string  either 'app' or 'org'`.

This is not cosmetic. `specs/BACKUP-RUNBOOK.md` tells the operator to get
`EXPIRES AT` from `fly tokens list --app spanish-srs`, and D7's whole
argument for storing no dates is that they are queryable. If the token does
not show there, the documented query returns nothing and the operator has no
path to the expiry date at all. Step 5 should try `--scope org` as a fallback
and **record which one worked**, and Step 19 should carry that into the
runbook.

## R8 — MINOR: Step 9's two variants are not equally safe, and one needs a flag. — MEASURED

`gh workflow run` defaults to the default branch, so the throwaway-branch
variant needs `--ref <branch>` (flag verified present). More importantly,
Step 9 offers "point the workflow at a nonexistent app name **or unset the
secret**" as equal options. They are not: unsetting `FLY_API_TOKEN` breaks
every scheduled run until it is restored, including one that may fire mid-step.
Make the bogus app name the instruction and drop the alternative.

## R9 — MINOR: Step 1's second `Done when` exits non-zero on success. — REASONED

Running `push-fly-state.sh --app no-such-app-xyz --yes` is *expected* to fail
— at the `fly` call, which is the whole point. A haiku agent reading a
non-zero exit as a failed step will report the step blocked. Say explicitly:
the command must exit non-zero, and the pass condition is the **absence** of
`local: can only be used in a function` plus the **presence** of a `fly`
error.

## Verdict on `tasks.md`

The step bodies are strong — anchors are accurate, `Do` lists are specific,
`If blocked` clauses correctly refuse to widen the token or fall back to
production. Round 1's seven required changes all landed.

What round 2 finds is a different class: **the steps are individually sound
and collectively leave two acceptance criteria unreachable** (R1, R2), and
the spec walks into a push gate it cannot pass (R3). None of these are
visible from inside a single step, which is why this round had to run against
the whole file.

## Required changes before Step 1 executes

1. Make A1 reachable — Step 10 records a real `event == "schedule"` run. (R1)
2. Insert a step between 8 and 11 that studies one card **on production** to
   manufacture the change A2 and Step 11 both need. (R2)
3. Add a rotation decision point before Step 17 writes to `STATE.md`. (R3)
4. Replace Step 2's `git stash` positive control with `git show HEAD:…`. (R4)
5. Step 6 uses `git status --porcelain -- data/spanish/`. (R5)
6. Steps 3, 6 and 11 cross-name each other on `ci.yml`. (R6)
7. Step 5 falls back to `--scope org` and records which scope listed the
   token; Step 19 carries it into the runbook. (R7)
8. Step 9: bogus app name only, with `--ref`. (R8)
9. Step 1: state that a non-zero exit is the expected outcome. (R9)

## Lessons this pass produced

- **Acceptance criteria and steps drift apart in the gap between them.**
  Every step here was individually checkable and two criteria were still
  unreachable, because no step owned the *condition* a criterion needed
  (a scheduled trigger; a non-empty diff). Walk the criteria against the
  steps as a matrix, not the steps alone. (R1, R2)
- **A spec that writes to a budgeted file must budget for it.** `STATE.md`
  has a hard push gate and this spec plans ~17 lines into a 9-line
  allowance, discoverable only at the final push. (R3)
- **A verification step must not be able to damage what it verifies.**
  `git stash` around a grep can strand an uncommitted critical fix. (R4)
