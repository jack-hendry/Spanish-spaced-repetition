# CriticReview — 022 backup and restore (two harden rounds)

> **Summarized when archived (2026-09-18).** Each finding is reduced to the
> claim, how it was established, and what it changed — plus, added at archive
> time, **what actually happened** once it was executed. The full argument for
> each is in git history at `7dbc681^`.
>
> Verdict tags are the original ones: **MEASURED** (reproduced against the real
> system) vs **REASONED** (argued from the code or the docs). The split matters:
> every finding that survived contact with execution was a MEASURED one, and
> the one REASONED premise that reached `tasks.md` unchallenged (C8) turned out
> to be false.

---

# Harden round 1 — against `Analyst.md`

Run **before `tasks.md` existed**, per the house rule that round 1 goes against
the Analyst. Nine findings; two were CRITICAL and both were real.

## C1 — CRITICAL: the restore path is broken. — MEASURED

`tools/push-fly-state.sh --yes` **has never worked.** `local FILES_PUSHED=0`
sits at file scope, outside any function; under `set -euo pipefail` bash errors
and the script aborts at line 173, before uploading a byte. Every dry run
passed because `print_plan()` returns *before* that line — **the safety flag
hid the defect.**

`ROADMAP.md` and Phase 1's Analyst both recorded it as "exercised on a scratch
round-trip in Step 18". `git log` showed one commit and no such exercise. The
claim was prose; nothing had ever been required to keep it true.

**Changed:** added **S0**, ordered before everything else — the drill cannot
run against a script that aborts. **Outcome:** fixed in Step 1 (one word),
proven in Step 13 at production scale. Became **L-025**.

## C2 — CRITICAL: the scheduled pull cannot work as planned. — MEASURED

`fly ssh` does **not** trigger auto-start. Against a stopped machine it returns
`no started VMs`. Since auto-stop means the cron almost always finds the
machine asleep, a workflow that only called the pull script would have failed
**every run**. Loudly, which is the right direction — but backing nothing up.

**Changed:** S1's workflow shape from *pull → commit* to
*start → pull → commit-if-changed → stop*, and A1 was strengthened to require
the machine be `stopped` when the run begins — "a workflow smoke-tested while
the machine happened to be awake proves nothing about the nightly case, which
is the only case that will ever occur."

**Outcome: the `start` step could not be implemented** — see R-round A11 notes
and `AD-028`. The *requirement* C2 identified was real and survived; the
*mechanism* it prescribed did not. The wake is now an anonymous HTTP request.

## C3 — DOWNGRADED TO MINOR by measurement. — MEASURED (resolved)

The original finding argued that a machine woken by `fly machine start` and
serving only `sftp` (zero HTTP requests) would never be reclaimed by the proxy,
leaving a silent always-on cost regression. **Measured: it was reclaimed after
539s.** The feared regression did not exist.

The explicit stop survived as *hygiene* — ~9 minutes of idle runtime saved per
run, and a deterministic end state rather than one dependent on non-contractual
proxy behaviour. **Outcome:** the stop step was later deleted entirely, so the
539s measurement became load-bearing after all: it is what makes the reclaim
predictable rather than hopeful. A finding downgraded for the right reason, and
then quietly promoted back by a later decision.

## C4 — MAJOR: Q1 could not be settled, and it is the highest-risk unknown. — BLOCKED

Found `fly tokens create ssh` — "SSH'ing to a single app" — a least-privilege
option the Analyst did not know existed, and a better answer to non-negotiable
#1 than the deploy-vs-org dilemma the question originally posed. Could not
verify it: creating a token was denied by the environment's permission
classifier (`Credential Materialization`), and **that denial was not worked
around.**

**Outcome:** the user created the token. Two of the three hypotheses held; the
third — that an `ssh` token permits `fly machine start`/`stop` — was **false**.
Became **L-026**.

## C5 — MODERATE: a bash construct that behaves differently across versions. — MEASURED locally / REASONED for CI

Both scripts use `((n++))` from a zero start. `(( ))` returns status 1 when the
expression evaluates to 0, and a post-increment yields the *old* value — so
`((n++))` at `n=0` is a status-1 command `set -e` may treat as fatal. It cannot
fire on this machine (bash 3.2.57); `ubuntu-latest` ships bash 5.x.

**Changed:** added A12, requiring both scripts be proven under bash 5.
**Outcome:** four sites fixed (Step 2), and a 21-case regression matrix
(`tools/state-scripts.bash5.test.sh`) wired into CI's `hooks` job, where the
log now prints `GNU bash, version 5.2.21` before the results — without that
line the log would show 21 passes and no way to know which interpreter produced
them.

## C6 — MODERATE: A3 is untestable-by-accident, and that is lucky, not designed. — MEASURED

The repo copy was byte-identical to Fly at spec time, so a no-op state existed
*for free* — but only until someone studied a card. **Changed:** an explicit
ordering constraint into `tasks.md` — check A3 **before studying any cards in
this phase**. Invisible unless written down. **Outcome:** honoured; A3 was
proven in Step 8 and the no-op condition was then deliberately destroyed by
Step 8b so A2 became reachable.

## C7 — MINOR: the pull script's summary line cannot detect change. — MEASURED

`pull-fly-state.sh` printed `updated 7, unchanged 0` against an **empty**
directory, where "updated" only means "did not previously exist". **Changed:**
the workflow decides "did anything change?" from `git diff --quiet`, never from
the script's own output.

## C8 — MINOR: a backup commit will re-trigger the full CI suite. — MEASURED

`ci.yml` was `on: push: branches: [main]` with no `paths-ignore`, so a
data-only commit would run all four jobs.

**Outcome — the only finding in either round that execution DISPROVED.** The
`paths-ignore` change is still correct, but its stated motivation was false:
`backup.yml` pushes with the default `GITHUB_TOKEN`, and GitHub refuses to
start a run from such a push regardless. Bot commits had *always* been free.
The real saving is three historical **human** data-only pushes. Note the
verdict tag above: this was marked MEASURED, but what had been measured was the
YAML, not the behaviour. Became **L-027**.

## C9 — MINOR: A8 should demand a *dated* re-check.

D3 is right that snapshots exist as a setting, but "zero snapshots exist" was
true only because the volume was 18 hours old, and that expires. **Outcome:**
A8 was written to demand a measurement; Step 16 measured; the runbook now
distinguishes the 5-day retention *setting* from the actual rollback *depth*.

## Verdict on the Analyst

Sound, and sized correctly. Its weakness was trusting two past-tense claims —
that the restore had been exercised (C1) and that snapshots were unconfigured
(D3/C9) — neither of which any mechanism kept true.

---

# Harden round 2 — against `tasks.md`

Nine required changes, all applied. The two that mattered most (R1, R2) are the
kind only a second round can find: each step was individually checkable while
no step owned the *condition* an acceptance criterion needed.

## R1 — CRITICAL: no step in this file can satisfy A1. — MEASURED

A1 demands "at least one successful **non-manual** run". Steps 7, 8 and 9 all
dispatch by hand. A dispatched run proves the steps work while a human watches;
the entire premise of the phase is that no human is watching. **Changed:**
Step 10 rewritten from a generic checkpoint into the step that *earns* A1, with
an explicit instruction not to substitute a `workflow_dispatch` run.
**Outcome:** A1 met by run `35337739105` on 2026-09-18.

## R2 — MAJOR: A2 and Step 11 are unsatisfiable in the state Step 8 creates. — MEASURED

Step 8 deliberately establishes a no-op condition (repo == Fly). In that state
no run can produce the commit A2 needs, and Step 11's `Done when` would wait
forever for a commit no step causes. **Changed:** inserted **Step 8b** — study
one card on production, manufacturing a real change. Inserted rather than
renumbering, so every step number still matches the one this round cites.
**Outcome:** A2 met by `eff78ca`, traceable to Step 8b's card.

## R3 — MAJOR: this spec will be refused by its own push gate. — MEASURED

The archive gate blocks a push adding files under `specs/archive/` without a
matching `specs/STATE.md` change, and blocks any newly archived file over 20KB.
**Outcome:** correct, and it bound at archive time — this file and `Analyst.md`
both had to be summarized, and `tasks.md` heavily so.

## R4 — MODERATE: Step 2's positive control can lose Step 1's fix. — MEASURED

The proposed control mutated the working tree to prove a test was real, risking
the one-word fix the whole phase depends on. **Changed:** to a throwaway
fixture.

## R5 — MODERATE: Step 6's change-detection is correct only by accident of today's state. — MEASURED

Same family as C6 and C7: a check that passes because of a transient condition.

## R6 — MODERATE: two steps edit `ci.yml` and neither says so. — MEASURED

Step 3 adds to the `hooks` job; Step 11 edits the `on:` trigger. **Changed:**
both steps' `Files` lists now name the other, and Step 3 was told to leave `on:`
alone. This is exactly the collision the parallel-steps rule exists to prevent.

## R7 — MINOR: Step 5's `Done when` may be unfalsifiable, which would also break the runbook. — MEASURED / REASONED

If the token were only visible at `--scope org`, the runbook's documented
`fly tokens list --app spanish-srs` would return nothing and the operator would
have no path to the expiry date — quietly invalidating D7's whole "query, never
copy" argument. **Outcome:** `--app` *is* the listing scope, so the runbook was
already right and Step 19's correction was a no-op. (`--scope org` is
additionally unusable non-interactively.) A finding whose value was confirming
a document rather than changing it.

## R8 — MINOR: Step 9's two variants are not equally safe, and one needs a flag. — MEASURED

`gh workflow run backup.yml` silently targets `main`. While a fix is not yet on
`main`, the bare form tests the *old* file. **Changed:** `--ref <branch>`
mandated. **Outcome:** used throughout Steps 7 and 9 — and necessary, since
`main` carried the broken file during attempts 1 and 2.

## R9 — MINOR: Step 1's second `Done when` exits non-zero on success. — REASONED

A criterion that fails when the thing it checks for is correctly absent.

## Verdict on `tasks.md`

Executable after the nine changes. Its systematic weakness was **per-step
checkability without per-criterion ownership** — the reason R1 and R2 existed,
and the reason Step 19's acceptance walk was specified as a *matrix against the
steps* rather than a step-by-step pass.

## Lessons these passes produced

Recorded at ritual time as `L-025`, `L-026` and `L-027` (`specs/STATE.md`
headlines, `specs/LESSONS.md` bodies). A fourth candidate — "a dry-run mode
that takes a different code path validates the path nobody runs" — was folded
into `L-025`'s body rather than given its own number: it is **L-020**'s defect,
not a new one.
