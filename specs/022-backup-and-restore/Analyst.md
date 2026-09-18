# Analyst — 022 backup and restore (Phase 2 of `011-mobile-remote-access`)

**Size: Large.** Touches deploy infra (a new scheduled GitHub Actions
workflow with a Fly credential), the repo's own commit history (an automated
writer to `data/spanish/`), and operational policy that other documents cite.
Per `CLAUDE.md`'s sizing rule: full spec + 2 harden rounds + a review after
coding.

Phase 2 of `specs/011-mobile-remote-access/ROADMAP.md`. Phase 1
(`specs/archive/2026-09-17-021-fly-deploy`) built the *mechanism*; this phase
builds the *policy* and proves the mechanism at production scale.

---

## 1. What problem are we solving?

`AD-025` made Fly the source of truth for scheduling state. The consequence
is that the only live copy of `cards.json` + `revlog.ndjson` — the
irreplaceable half of this project, per the roadmap's non-negotiable #2 — is
a **single 1GB volume on a single host in `yyz`**. A Fly volume is not a
backup.

Phase 1 left four gaps, each of which makes the honest answer to *"what would
it take to lose a review?"* worse than it needs to be:

| Gap | Today | Consequence |
|---|---|---|
| Nothing schedules the pull | `tools/pull-fly-state.sh` is run by hand | The off-Fly copy is only as fresh as the last time a human remembered. The copy is **not currently stale** — `65532a0` is byte-identical to Fly as of 2026-09-17 (harden C6) — but nothing *keeps* it that way. The risk is structural, not a present backlog. |
| **Restore is broken, not merely unproven** | `push-fly-state.sh --yes` **aborts before uploading anything** — `local` used outside a function at line 173, fatal under `set -euo pipefail` (harden **C1**, reproduced) | The tool that restores the irreplaceable half of this project has never worked. Dry runs pass because `print_plan()` returns first, so the safety flag hid the defect. `git log` shows one commit, so the "scratch round-trip in Step 18" recorded in `ROADMAP.md` and Phase 1's Analyst cannot have exercised this path. |
| Retention undefined | Pulls overwrite the same 7 files; history exists only if someone commits them | A corrupting write that gets faithfully backed up needs an older copy to escape to. Nobody has said how far back that reaches. |
| Snapshot layer unchecked | Assumed unconfigured by the roadmap | Untrue, and nobody had looked — see §5 D3. An unverified assumption in a *backup* plan is the exact failure class this phase exists to close. |
| **A sleeping machine refuses the pull** | `fly ssh` does **not** trigger auto-start; against a stopped machine it returns `no started VMs` (harden **C2**, reproduced) | A nightly workflow that only calls `pull-fly-state.sh` fails **every run**, because auto-stop means the cron almost always finds the machine asleep. It fails loudly rather than writing empty files, which is the correct direction — but it backs nothing up. |

**Measured starting state** (2026-09-17, this machine):

- `data/spanish/`: `cards.json` 2.90MB / 138,245 lines (pretty-printed, one
  field per line), `notes.json` 2.16MB, `revlog.ndjson` 752KB / 3,915 lines,
  four small files. ~6MB of state; `media/` is 252MB and gitignored.
- Fly volume `vol_vjyq28pjgdn335xv`, 1GB, `yyz`, encrypted, attached to
  machine `850d53cd95d668`, created 18 hours ago.
- `.git` is 17MB after 20 commits touching `data/spanish/cards.json`.
- Repo `jack-hendry/Spanish-spaced-repetition` is **private**.

## 2. What is in scope?

### S0 — Fix `push-fly-state.sh`, and fix both scripts' bash portability

Added by harden round 1; **ordered before everything else**, because S4's
drill cannot run against a script that aborts on line 173.

- **The `local` fix (C1).** Remove the `local` keyword at
  `tools/push-fly-state.sh:173`. One word. The fix is trivial; discovering it
  was not, and the drill (S4) is what turns it from a plausible edit into a
  proven one.
- **Bash-5 portability (C5).** Both scripts use `((n++))` from a zero start.
  `(( ))` returns status 1 when the expression evaluates to 0, and a
  post-increment yields the *old* value — so `((n++))` at `n=0` is a status-1
  command that `set -e` may treat as fatal. It does not fire on this machine
  (bash 3.2.57) and the full pull ran clean, but **the workflow runs on
  `ubuntu-latest`, which ships bash 5.x**, and that could not be checked from
  here (no bash 5, no Docker daemon). Replace with `n=$((n+1))`, which is
  unconditionally status 0, and verify both scripts' parsing and counting
  paths under bash 5.

This is the same failure family twice: a construct that is fine on the path
someone tested and fatal on the path that matters.

### S1 — A scheduled pull that commits to the repo (the "copy off Fly")

A new GitHub Actions workflow (`.github/workflows/backup.yml`) on a `cron`
schedule that runs `tools/pull-fly-state.sh` against the live app and commits
the seven state files to `main`.

**Chosen over the two alternatives** (see §5 D1): a local `launchd` agent
never runs while the Mac is off — which is precisely the away-from-desktop
case Phase 1 exists to serve — and a silent failure leaves no log anyone
checks. Manual-plus-a-reminder is the status quo the roadmap already
complains about.

**Workflow shape — corrected by harden C2/C3.** Not *pull → commit*, but:

```
fly machine start  →  pull-fly-state.sh  →  commit only if changed  →  fly machine stop
```

The start is **mandatory** (C2: `fly ssh` never wakes a sleeping machine).
The explicit stop is **recommended hygiene, not a fix** — C3 was measured and
the feared cost regression did not materialise: a machine woken by
`fly machine start` and serving only `sftp` (zero HTTP requests) was still
reclaimed by the proxy after 539s. Stopping explicitly avoids ~9 minutes of
idle runtime per run and makes the end state deterministic rather than
dependent on a non-contractual proxy behaviour. Measured timings: start 1.0s,
full 7-file pull 19.5s, auto-stop ~9min.

Requirements:

- Runs `tools/pull-fly-state.sh` unchanged where possible. The script already
  stages atomically, verifies non-empty, and validates JSON parse — that work
  is not re-done in YAML.
- **Decides "did anything change?" from `git diff --quiet`, never from the
  script's own summary line** (C7): `pull-fly-state.sh` printed
  `updated 7, unchanged 0` against an *empty* directory, where "updated" only
  means "did not previously exist". That string cannot distinguish a fresh
  checkout from a real change.
- **Commits only when something changed.** A no-op day must not add a commit;
  `cards.json` is a 2.9MB blob and a daily empty commit is pure repo growth.
- **Fails loudly.** A failed pull must fail the workflow, visibly, not exit 0
  with a warning.
- The Fly credential is a repository secret, never committed
  (non-negotiable #1).
- The commit must not recursively trigger the backup workflow, and must pass
  CI's existing `clean-table-gate` (it will: a data-only commit adds nothing
  under `specs/archive/` and changes no `L-NNN` headline).

### S2 — A written retention policy

The roadmap requires this in writing before Phase 2 is done, because "an
unstated answer means the next person (or agent) re-derives it
mid-incident". It must state, concretely: how far back a bad state can be
rolled, what the *lag* is (how many reviews a Fly-loss costs at worst), and
which layer answers which failure. Recorded as an `AD-NNN` in
`specs/STATE.md` and reflected in `ROADMAP.md` Phase 2.

### S3 — Fly volume snapshots: verify and record, do not assume

Measure the actual snapshot configuration and retention, decide whether the
default is adequate, and write down what snapshots do and do not cover. They
are a convenience layer *on Fly*, so they do not satisfy the "copy off Fly"
requirement on their own — but they are the cheapest fast-rollback layer and
the roadmap explicitly lists them.

### S4 — A production-scale restore drill on a throwaway Fly app

Prove `tools/push-fly-state.sh` end to end against a **real, separate** Fly
app + volume at full data scale: deploy scratch app, push the repo's copy
into it, boot it, and **study one card against it**. Then tear it down.

**Chosen over the two alternatives** (see §5 D2): a local scratch `DATA_DIR`
proves the data loads but never exercises the remote staging-and-move path
that is the actual untested code; pushing to production overwrites the one
live copy of real scheduling state and would lose any reviews since the last
pull if it went wrong.

The drill's acceptance is behavioural, not a file listing: the restored app
must serve the collection with the **same** card counts and due state, and a
card answered against it must persist.

### S6 — Credential hygiene and staleness visibility

Added after the Q1 security analysis (see D6). Non-negotiable #1 says the
credential choice is made deliberately, not discovered.

- **Use the narrowest token that actually works.** Verified capabilities:
  `fly tokens create ssh` is "SSH'ing to a single app" **and is also allowed
  to connect to the org's WireGuard network**; `deploy` manages "a single app
  and its resources"; `org` and `readonly` are org-wide. The org here is
  `personal` and contains **exactly one app** (`spanish-srs`), so the
  WireGuard grant has nowhere to move laterally — blast radius is this app
  either way. Try `ssh` first; fall back to `deploy` only if machine
  start/stop is refused, and record which was needed.
- **Set an explicit `--expiry`.** All four token types default to
  `175200h` (20 years). Pick a real number and accept D6's trade-off.
- **Pin the flyctl setup action to a commit SHA, not a tag.** A third-party
  action resolved by moving tag is a supply-chain path straight to the
  secret; this is the one exposure in the GitHub half that is cheap to close.
- **Make staleness visible.** The backup's own failure is loud (A4), but its
  *absence* is not. Record how anyone would notice that no backup has run —
  at minimum the GitHub auto-disable email (D6) and the timestamp of the last
  `data/spanish/` commit.
- **Do not store the token's creation or expiry date as data** (see D7).

### S5 — Documentation and memory

`ROADMAP.md` Phase 2 checkboxes ticked with what was actually done (and what
was not — Phase 1's honesty about the "200-card session" is the standard
here). `AD` entries for the retention policy and anything learned about the
Fly credential model. `L-NNN` pairs (`STATE.md` headline + `LESSONS.md` body)
for any genuine lesson. `CLAUDE.md` updated if the backup workflow changes
how anyone should treat `data/spanish/`.

## 3. What is OUT of scope?

The most important section. Each of these is a real, known gap that this
phase deliberately does not close.

- **O1 — The revlog → `cards.json` repair tool.** The roadmap's last Phase 2
  bullet ("worth a one-off repair tool if it ever proves cheap"). Rebuilding
  card state from `revlog.ndjson` means replaying SM-2/FSRS over the whole
  history — that is a scheduling-domain change, which `CLAUDE.md` classes as
  **at least Large on its own**. It is not a checkbox on a backup spec.
  → `specs/BACKLOG.md`.
- **O2 — The `/api/review` revlog-ahead-of-`cards.json` divergence**
  (ROADMAP Discovered, 2026-09-17). `routes/index.ts` calls `saveCardsSoon()`
  (debounced ~400ms) but awaits `appendRevlog()` immediately, so a **hard**
  kill inside that window leaves the revlog claiming a review `cards.json`
  does not reflect. Real, and made reachable for the first time by auto-stop
  — but it is a server-side durability bug, not a backup-policy question, and
  fixing it touches the persistence path. Both halves (detecting the
  divergence and repairing it) → `specs/BACKLOG.md`, alongside O1.
- **O3 — Backing up `media/`.** 252MB, regenerable from
  `tools/convert_apkg.py`. Explicitly excluded by the roadmap and by AD-025.
- **O4 — A third copy outside both Fly and GitHub** (S3, Backblaze, a local
  NAS). Two independent providers is proportionate for ~6MB of personal
  study state. If that changes, it is a new phase, not scope creep here.
- **O5 — Any change to the server, the scheduler, the study queue, or the
  on-disk shape.** This phase is infrastructure and tooling only. If a step
  finds itself editing `server/src/` beyond a config/docs line, that is the
  signal to STOP and re-classify.
- **O6 — Phases 3, 4 and 5** (in-flight review outbox, cross-device staleness
  checks, mobile UI). Named here only because Phase 2's "never lose a review"
  framing invites drift toward them.
- **O7 — Restoring into production.** The drill runs against a throwaway app.
  Production restore remains a documented, human-confirmed, `--yes` gated
  procedure — proven by the drill, not performed by it.

## 4. How do we know it is done?

Concrete and checkable. Every criterion names the command or the observation
that settles it.

**A1 — The scheduled pull exists and has actually run, starting from a
stopped machine.** `.github/workflows/backup.yml` exists on `main`, and the
GitHub Actions run history shows **at least one successful non-manual run** —
not just a `workflow_dispatch` smoke test. **The machine must be `stopped`
when the run begins** (harden C2): a workflow smoke-tested while the machine
happened to be awake proves nothing about the nightly case, which is the only
case that will ever actually occur. Evidence: the run URL, its conclusion,
and the machine state immediately before it.

**A2 — The scheduled pull produced a real commit.**
`git log --oneline -- data/spanish/cards.json` shows a commit authored by the
workflow, and `git show --stat <sha>` lists the state files. Evidence: the
SHA.

**A3 — A no-op run commits nothing.**
A second run over unchanged state completes green and adds **no** commit.
Evidence: two run URLs and `git log` showing one commit, not two. (This is
the criterion that distinguishes "it ran" from "it ran correctly" — a
workflow that commits an identical tree every day also satisfies A1 and A2.)

> **Ordering constraint (harden C6).** The repo copy is *currently*
> byte-identical to Fly, so a no-op state exists for free right now. Check A3
> **before studying any cards in this phase** — once reviews land, the
> no-op condition has to be manufactured. This is invisible unless written
> down, so `tasks.md` must order it accordingly.

**A4 — A failing pull fails the workflow.**
Verified by *causing* it, not by reading the YAML: run the workflow against a
deliberately wrong app name (or with the secret unset) and confirm the run
concludes `failure`. Evidence: the failed run URL. A backup job that reports
success when it backed nothing up is worse than no backup job.

**A5 — The restore drill ran on a real throwaway Fly app, and a card was
studied against it.** Evidence: the scratch app name, the `push-fly-state.sh`
output, the pre/post card state of the one card answered, and the teardown
confirmation (`fly apps destroy`, `fly volumes list` showing it gone).

**A6 — The restored app matched production's state.** Deck counts and due
counts on the scratch app equal those on the live app at pull time, checked
against a recorded number rather than eyeballed. Evidence: both numbers.

**A7 — The retention policy is written down** in `specs/STATE.md` as an `AD`,
and `ROADMAP.md` Phase 2 states the same window. It must answer: *how far
back can we roll, and how many reviews does a total Fly loss cost at worst?*

**A8 — Snapshot configuration is recorded**, measured not assumed, including
what it does not cover.

**A9 — The out-of-scope items are recorded where they will be found.** O1 and
O2 appear in `specs/BACKLOG.md` (per **L-024**: "add it to the backlog" means
`specs/BACKLOG.md`, never a Quick Tasks row).

**A11 — The backup workflow leaves the machine stopped.** (added by harden
C3) After a scheduled run, `fly machine list --app spanish-srs` shows
`stopped`. Evidence: machine state before and after a real run. Note the
original justification for this criterion was **wrong and was corrected by
measurement**: auto-stop *does* reclaim a machine woken for `sftp` alone
(539s, zero HTTP requests), so there is no silent always-on cost regression.
A11 survives as a cheap determinism check — end state commanded, not
inferred — and to avoid ~9 minutes of idle runtime per run.

**A11 amended 2026-09-17 — downgraded from "commanded" to "reclaimed", with
the user's decision.** Both justifications above are **forfeited**, knowingly.
Step 7 proved the CI token cannot take a machine lease (`failed to obtain
lease: ... unauthorized`), which `fly machine start` *and* `fly machine stop`
both require. The three ways out were: a deploy token, an org token, or
dropping the lease requirement. The user chose the third: the workflow now
wakes the machine with `curl` against the anonymous `GET /api/health`
(`fly.toml:20-22` — `auto_start_machines = true`, `min_machines_running = 0`)
and has **no stop step at all**.

So A11 now reads: **after a run, Fly's auto-stop reclaims the machine to
`stopped` within ~10 minutes.** Evidence changes from a state read immediately
after the run to a *polled* read until reclaimed. What was gained: the CI
secret needs no machine scope, so its blast radius shrank rather than grew —
the same reasoning as S6's action-SHA pinning. What was paid: the end state is
inferred from measured auto-stop behaviour, not commanded, and ~9 minutes of
idle runtime per run returns. That idle cost was the *original*, already-wrong
justification for this criterion (see above), and at 4 runs/day it is ~36
min/day on a machine that is free when stopped — accepted.

The determinism this criterion wanted is not wholly lost: Step 6's measurement
of auto-stop (539s after an `sftp`-only wake, zero HTTP requests) is what makes
the reclaim predictable rather than hopeful. But it is now a property of Fly's
behaviour, which this repo does not control and cannot test in CI, so a change
in Fly's auto-stop policy would silently re-introduce an always-on machine.
That is a third accepted silent-failure mode and belongs in Step 17's `AD`
alongside D6's two.

**A12 — Both state scripts are proven under bash 5.** (added by harden C5)
`pull-fly-state.sh` and `push-fly-state.sh` complete their argument-parsing
and counting paths under bash 5.x, not only the local bash 3.2. Evidence: the
CI run output, or a container run. **A13 — and `push-fly-state.sh --yes`
reaches its upload stage**, which today it does not (C1).

**A10 — The tree is clean and honest.** `git status` clean after
(`git checkout -- data/spanish/` per **L-002** if the dev server ran),
`npm run test` and `npm run build` green, and
`pre-commit run --hook-stage pre-push --all-files` green. ROADMAP checkboxes
reflect what was verified, with anything unverified said out loud.

## 5. Decisions taken before planning

**D1 — Scheduling: GitHub Actions cron.** (user, 2026-09-17) Runs when the
Mac is off; failures are visible in the Actions tab; retention comes from git
history for free, which keeps the existing rollback habit working exactly as
AD-025 intended. Accepted costs: a Fly token as a repository secret (the repo
is private), bot commits in history, and each run waking the machine
(~5.1s cold start, measured in Phase 1).

**D2 — Restore drill: throwaway second Fly app.** (user, 2026-09-17) Full
fidelity on the real `fly ssh sftp` path at production data scale, with zero
risk to live scheduling state. Costs a few cents and a teardown step.

**D3 — Snapshots were already on.** (measured 2026-09-17, *not* a user
decision — recorded here because it contradicts the roadmap.) `fly volumes
show vol_vjyq28pjgdn335xv` reports `Scheduled snapshots: true`, `Snapshot
retention: 5` (days). `fly volumes snapshots list` reports **none exist yet**
— the volume is 18 hours old. So the roadmap's "Fly volume snapshots remain
unconfigured" is wrong on configuration and right on outcome: there is
currently no snapshot to restore from. This is why S3 says *verify*, not
*configure*, and why A8 demands a measurement.

**D4 — The repair tool and the divergence bug are deferred.** (user,
2026-09-17) See O1 and O2.

**D5 — Backup cadence is every 6 hours, and that interval *is* the retention
window's loss figure.** (user, 2026-09-17) `0 */6 * * *`.

Measured from the live revlog to make the trade-off concrete rather than
assumed: **30 active study days in the 73 days from 2026-07-06 to
2026-09-17**, median **118** reviews on an active day, maximum **263**. So
the worst case a 6-hour window admits is a fraction of one session; a 24-hour
window would have admitted a whole one.

Cost is flat across the plausible range, which is why the shorter interval
wins: at ~1.5–2 GitHub Actions minutes per run, daily ≈ 60 min/month and
6-hourly ≈ 240 min/month, both far inside the 2,000-minute free allowance for
a private repo. Machine time is ~1 minute per run with the explicit stop.
Hourly (~1,440 min/month, 72% of the allowance, 24 wakes/day) is the first
cadence that costs anything real, and it buys little: study happens in
bounded sessions, and no-op runs commit nothing (A3), so most extra runs add
no repo growth at all.

**What this cadence does *not* fix:** a review lost *in flight* never reaches
Fly, so no backup interval can recover it. That is Phase 3's job
(`ROADMAP.md`), and it remains the larger residual risk once this phase
lands.

**D6 — Two silent-failure modes are accepted and monitored, not engineered
away.** (2026-09-17, from the Q1 security analysis) A scheduled backup can
stop running without anyone noticing, in two independent ways:

1. **GitHub auto-disables scheduled workflows after 60 days of repository
   inactivity.** This interacts with A3: no-op runs deliberately create no
   commit, so a study break longer than 60 days with no other pushes could
   disable the backup. GitHub emails the repository owner when it does this,
   so it is *not* fully silent — that email is the designated signal.
2. **The Fly token expires.** Fly's default is 175,200h (20 years); a
   deliberately shorter expiry shrinks the leak window but guarantees an
   eventual silent stop.

These pull in opposite directions, and the honest resolution is that neither
is engineered away in this phase — both are made *visible*. See S6.

**D7 — The token's creation and expiry dates are queried, never recorded.**
(2026-09-17) Both are already held by the systems of record and are
queryable:

| Fact | Authoritative source | Never drifts because |
|---|---|---|
| Expiry | `fly tokens list --app spanish-srs` → `EXPIRES AT` | Fly issued it |
| Created / last rotated | `gh secret list --repo … --json name,updatedAt` | GitHub stamps it on set |

Writing either date into a file, a comment or `STATE.md` would be a
hand-maintained copy of a fact the system already owns — **L-009**: *"a
hand-maintained pointer decays the moment nobody is forced to touch it."*
Rotate the token early and the copy silently lies, which is worse than no
date at all because it will be believed.

So: store the **command**, not the value. Whatever needs to mention the
expiry names the query instead of the answer.

**But querying only helps someone who remembers to query**, and D6's whole
point is that nobody will. The dates are therefore not the mitigation — the
mitigation is a *forcing function* outside the repo:

1. **A calendar reminder ~3 weeks before expiry.** The only mechanism here
   that interrupts a human unprompted. This is the load-bearing one.
2. **A workflow self-check** that warns when expiry is under 30 days —
   attractive because the backup already runs every 6 hours holding the
   token. **Unverified**: an SSH-scoped token may not be permitted to call
   `fly tokens list` at all. Treat as a nice-to-have to test in Step 7, not a
   promise.
3. GitHub's auto-disable email (D6), which covers the other failure mode.

## 6. Open questions — status after harden round 1

- **Q1 — Fly credential for CI. STILL OPEN, and now the top risk.**
  Harden C4 found a least-privilege option the Analyst did not know existed:
  `fly tokens create ssh` — "Create token for SSH'ing to a single app". That
  is a better answer to non-negotiable #1 than the deploy-vs-org dilemma this
  question originally posed. **But it is unverified**: creating a token was
  denied by the environment's permission classifier
  (`Credential Materialization`), and that denial was not worked around.
  Three things remain hypotheses — that the token works non-interactively,
  that `FLY_API_TOKEN` is the variable flyctl reads for it, and, **newly
  raised by C2/C3, that an SSH-scoped token also permits
  `fly machine start`/`stop`** — which it may well not. Needs the user; see
  the handoff note at the end of this section.
- **Q2 — SETTLED, and it was a defect, not a question.** `fly ssh` does not
  auto-start a stopped machine (`no started VMs`). See C2; S1's workflow
  shape corrected.
- **Q3 — Repo growth. Answered well enough to proceed.** `cards.json` is
  pretty-printed one field per line (138,245 lines), so a review touches a
  handful of lines and git delta-compresses effectively — `.git` is 17MB
  after 20 such commits. Stated expectation rather than a surprise; it is
  also the argument for A3.
- **Q4 — SETTLED: every 6 hours** (`0 */6 * * *`, i.e. 00/06/12/18 UTC =
  20/02/08/14 Toronto). See D5.
- **Q5 — SETTLED: yes, it re-triggers.** `ci.yml` is `on: push: branches:
  [main]` with no `paths-ignore`, so a data-only backup commit runs all four
  jobs nightly. Harmless but wasteful; `paths-ignore` is the cleaner fix
  (see C8).

**Handoff — the one thing blocking `tasks.md` from being fully written:**
Q1 needs a real token. Recommended resolution: the user runs
`fly tokens create ssh --app spanish-srs` and stores it as the
`FLY_API_TOKEN` repository secret; the capability question (does it permit
machine start/stop?) is then answered by a `workflow_dispatch` run rather
than by argument. If it does not, the fallback is a deploy or org token —
and that is a security trade-off the user should make knowingly, which is
exactly what non-negotiable #1 requires.

## Retrospective

(filled in before archiving)
