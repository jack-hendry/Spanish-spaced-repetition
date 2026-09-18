# Analyst — 022 backup and restore (Phase 2 of `011-mobile-remote-access`)

**Size: Large.** Deploy infra (a scheduled GitHub Actions workflow holding a
Fly credential), the repo's own commit history (an automated writer to
`data/spanish/`), and operational policy other documents cite. Full spec + 2
harden rounds + a post-coding review.

Phase 1 (`specs/archive/2026-09-17-021-fly-deploy`) built the *mechanism*; this
phase built the *policy* and proved the mechanism at production scale.

> **Summarized when archived (2026-09-18).** Sections 1–5 are compressed to
> their conclusions; the acceptance criteria are folded into the outcome table
> in §4. The full pre-execution text, the per-criterion evidence and every step
> record are in git history at `7dbc681^`.

---

## 1. The problem

`AD-025` made Fly the source of truth for scheduling state. The consequence:
the only live copy of `cards.json` + `revlog.ndjson` — the irreplaceable half
of this project, per the roadmap's non-negotiable #2 — was **a single 1GB
volume on a single host in `yyz`**. A volume is not a backup.

Phase 1 left five gaps. Two of them were only discovered by the harden rounds,
and they are the reason this phase mattered:

| Gap | State at spec time |
|---|---|
| Nothing scheduled the pull | `tools/pull-fly-state.sh` was run by hand. The copy was not *stale* (byte-identical to Fly as of 2026-09-17), but nothing kept it that way. Structural risk, not a present backlog. |
| **Restore was broken, not merely unproven** (harden **C1**) | `push-fly-state.sh --yes` aborted before uploading anything — `local` used outside a function at line 173, fatal under `set -euo pipefail`. Dry runs passed because `print_plan()` returns first, so the safety flag *hid* the defect. `ROADMAP.md` recorded it as "exercised on a scratch round-trip in Step 18"; `git log` showed that could not have happened. |
| **A sleeping machine refused the pull** (harden **C2**) | `fly ssh` does **not** trigger auto-start; against a stopped machine it returns `no started VMs`. A nightly workflow that only called the pull script would have failed *every* run — loudly, which is the right direction, but backing nothing up. |
| Retention undefined | Pulls overwrite the same 7 files; history existed only if someone committed them. |
| Snapshot layer unchecked | The roadmap assumed snapshots were unconfigured. Nobody had looked. |

**Measured starting state** (2026-09-17): ~6MB of state across 7 files
(`cards.json` 2.90MB / 138,245 lines pretty-printed, `notes.json` 2.16MB,
`revlog.ndjson` 752KB / 3,915 lines); `media/` 252MB and gitignored; Fly volume
`vol_vjyq28pjgdn335xv` 1GB in `yyz`, 18h old; `.git` 17MB after 20 commits
touching `cards.json`; repo private.

## 2. Scope, as built

- **S0 — Fix the scripts first.** The one-word `local` removal (C1), and
  bash-5 portability in both scripts (C5): `((n++))` from a zero start returns
  status 1, which `set -e` may treat as fatal. It cannot fire on this machine
  (bash 3.2.57) but `ubuntu-latest` ships bash 5.x. Replaced with `n=$((n+1))`.
  *The same failure family twice: a construct that is fine on the path someone
  tested and fatal on the path that matters.*
- **S1 — A scheduled pull that commits to the repo.**
  `.github/workflows/backup.yml`, `0 */6 * * *`. Decides "did anything change?"
  from `git diff --quiet`, **never** from the script's own summary line (C7:
  `pull-fly-state.sh` printed `updated 7, unchanged 0` against an *empty*
  directory, where "updated" only means "did not previously exist"). Commits
  only when something changed; fails loudly; credential is a repository secret.
- **S2 — A written retention policy**, as an `AD` in `specs/STATE.md` and
  mirrored in `ROADMAP.md` Phase 2. → `AD-027`.
- **S3 — Snapshots: verify and record, do not assume.**
- **S4 — A production-scale restore drill on a throwaway Fly app**, including
  studying one card against the restored app, then teardown.
- **S6 — Credential hygiene**: narrowest token that works, explicit
  `--expiry`, flyctl setup action pinned to a commit SHA (a third-party action
  resolved by moving tag is a supply-chain path straight to the secret), and
  staleness made visible.
- **S5 — Documentation and memory.**

## 3. Out of scope — real gaps deliberately left open

- **O1 — the revlog → `cards.json` repair tool.** Replaying SM-2/FSRS over the
  whole history is a scheduling-domain change, which `CLAUDE.md` classes as at
  least Large on its own. → `specs/BACKLOG.md`.
- **O2 — the `/api/review` revlog-ahead-of-`cards.json` divergence.**
  `routes/index.ts` calls `saveCardsSoon()` (debounced ~400ms) but awaits
  `appendRevlog()` immediately, so a hard kill in that window leaves the revlog
  claiming a review `cards.json` does not reflect. Real, and made reachable for
  the first time by auto-stop — but a server-side durability bug on the
  persistence path, which O5 excludes. → `specs/BACKLOG.md`, alongside O1.
- **O3** — backing up `media/` (252MB, regenerable).
- **O4** — a third copy outside both Fly and GitHub. Two independent providers
  is proportionate for ~6MB of personal study state.
- **O5** — any change to the server, scheduler, study queue or on-disk shape.
- **O6** — Phases 3, 4, 5.
- **O7 — restoring into production.** The drill runs against a throwaway app.
  Production restore stays a documented, human-confirmed, `--yes`-gated
  procedure — proven by the drill, not performed by it.

## 4. How we knew it was done — outcome

**All 13 criteria met.** Per-criterion evidence is in `tasks.md`'s Step 19
record; the summary:

| # | Criterion | Outcome |
|---|---|---|
| **A1** | A scheduled (non-manual) run succeeded, from a stopped machine | ✅ Run `35337739105`, `event == "schedule"`, 2026-09-18. Stopped-machine half proven for a *scheduled* run from Fly's own event log. |
| **A2** | It produced a real commit | ✅ `eff78ca`, 43s into that run. |
| **A3** | A no-op run commits nothing | ✅ Two runs, `updated 0, unchanged 7`, one commit not two. Checked before any card was studied, per C6's ordering constraint. |
| **A4** | A failing pull fails the workflow | ✅ Caused, not read off the YAML. |
| **A5** | Restore drill on a real throwaway app, card studied against it | ✅ `spanish-srs-restoredrill`, then destroyed. |
| **A6** | Restored app matched production | ✅ 2 decks / 3,638 notes / 7,276 cards, both queue and type breakdowns identical, each summing to 7,276. |
| **A7** | Retention policy written down | ✅ `AD-027` + ROADMAP Phase 2. |
| **A8** | Snapshot config recorded, measured not assumed | ✅ Including what it does not cover. |
| **A9** | Out-of-scope items recorded where they'll be found | ✅ O1 and O2 in `specs/BACKLOG.md` (per **L-024**, not Quick Tasks). |
| **A10** | Tree clean and honest | ✅ |
| **A11** | The machine ends up `stopped` | ✅ **as amended** — *reclaimed* by Fly's auto-stop, not commanded. Measured 426s and 413s. |
| **A12** | Both scripts proven under bash 5 | ✅ CI ran `GNU bash 5.2.21`, 21/21. |
| **A13** | `push-fly-state.sh --yes` reaches its upload stage | ✅ First time the script has ever completed. |

**A11 was amended mid-flight, knowingly.** It began as "the workflow leaves the
machine stopped (commanded)". Step 7 proved the CI token cannot take a machine
lease, which `fly machine start` *and* `stop` both require. Options were a
deploy token, an org token, or dropping the lease requirement; the user chose
the third. The workflow now wakes the machine with `curl` against the anonymous
`GET /api/health` and has **no stop step at all**. Gained: the secret needs no
machine scope, so its blast radius *shrank*. Paid: the end state is inferred
from measured auto-stop behaviour rather than commanded, and ~9 minutes of idle
runtime per run returns. See `AD-028`.

## 5. Decisions

- **D1 — GitHub Actions cron**, over a local `launchd` agent (never runs while
  the Mac is off — precisely the away-from-desktop case Phase 1 serves) and
  over manual-plus-a-reminder (the status quo the roadmap complains about).
- **D2 — Restore drill on a throwaway second Fly app**, over a local scratch
  `DATA_DIR` (proves the data loads, never exercises the remote
  staging-and-move path that is the actual untested code) and over pushing to
  production (O7).
- **D3 — Snapshots were already on** (measured, not a user decision, and it
  contradicted the roadmap): `Scheduled snapshots: true`, `Snapshot retention:
  5`, and **zero snapshots existed** — the volume was 18h old. Wrong on
  configuration, right on outcome.
- **D4 — O1 and O2 deferred.**
- **D5 — Cadence is every 6 hours, and that interval *is* the loss figure.**
  Measured to make the trade-off concrete: **30 active study days in the 73**
  from 2026-07-06, median **118** reviews on an active day, max **263**. A
  6-hour window admits a fraction of one session; 24 hours would admit a whole
  one. Cost is flat across the plausible range (~240 Actions min/month at 6h vs
  ~60 daily, both far inside the 2,000-min free allowance), so the shorter
  interval wins on a free axis. Hourly (~1,440 min/month, 72% of the allowance)
  is the first cadence that costs anything real, and buys little.
- **D6 — Two silent-failure modes accepted and made visible, not engineered
  away**: GitHub auto-disabling scheduled workflows after 60 days of repository
  inactivity (which interacts with A3 — no-op runs create no commit, so a long
  study break with no other push could disable the backup; GitHub's email is
  the designated signal), and Fly token expiry. `AD-028` added a third.
- **D7 — The token's creation and expiry dates are queried, never recorded.**
  Both are owned by the systems that issued them. Writing either into a file
  would be a hand-maintained copy of a fact the system already owns — **L-009**.
  Rotate early and the copy silently lies, which is worse than no date, because
  it will be believed. **Store the command, not the value.** And because
  querying only helps someone who remembers to query, the load-bearing
  mitigation is a *calendar reminder ~3 weeks before expiry* — the only
  mechanism here that interrupts a human unprompted.

## 6. Open questions — how they closed

- **Q1 — the Fly credential. Was the top risk; settled by doing.** Harden C4
  found `fly tokens create ssh` ("SSH'ing to a single app"), a least-privilege
  option the Analyst did not know existed. Three things were hypotheses: that
  it works non-interactively, that `FLY_API_TOKEN` is the variable flyctl
  reads, and that an SSH-scoped token permits `fly machine start`/`stop`. The
  first two held. **The third did not** — see A11 above and **L-026**.
- **Q2 — settled, and it was a defect, not a question.** `fly ssh` does not
  auto-start a stopped machine. S1's workflow shape was corrected.
- **Q3 — repo growth.** `cards.json` is pretty-printed one field per line, so a
  review touches a handful of lines and git delta-compresses well: `.git` was
  17MB after 20 such commits. Also the argument for A3.
- **Q4 — settled: every 6 hours.** See D5.
- **Q5 — settled: yes, a data-only commit re-triggers CI** — and **the measured
  answer at execution time contradicted this.** See **L-027**.

## Retrospective

**All 13 acceptance criteria met.** Two things were deliberately left open at
close: the orphaned live Fly token still needs revoking, and the first green
run at the shipping `0 */6 * * *` cadence cannot happen until the branch is on
`main` (all three scheduled successes fired under a temporary `*/30`).

### What the phase was for, versus what it found

The spec was framed as "schedule the pull, write down a retention policy, drill
the restore." Two of those went roughly to plan. The third did not, and it is
the reason this phase mattered:

**The restore path had never run. Not once.** `tools/push-fly-state.sh` carried
`local FILES_PUSHED=0` at file scope, fatal under `set -euo pipefail`, so it
aborted at line 173 before uploading a single byte — while `ROADMAP.md`
recorded it as "exercised on a scratch round-trip in Step 18". The dry-run path
returned *before* that line, so every dry run had passed. A backup system whose
restore half has never executed is not a backup system; it is a belief about
one. **The whole phase paid for itself at Step 1, a one-word fix, found by a
harden round reading a past-tense sentence sceptically** (**L-025**).

### Where the plan was wrong, and how it was caught

Four times, and three of the four by measuring something the plan asserted:

1. **A1 and A2 were unreachable as written.** Every step dispatched the
   workflow by hand, so nothing earned "non-manual"; and the repo was already
   byte-identical to Fly, so no step produced the commit A2 needed. Harden
   round 2 found this by walking criteria *against* steps rather than step by
   step: each step was individually checkable while no step owned the
   *condition* the criterion required. Steps 8b and 10 exist because of it.
2. **A11's justification was wrong twice.** First the "silent always-on cost"
   it guarded against turned out not to exist (auto-stop reclaims an
   `sftp`-woken machine, measured at 539s). Then the criterion itself became
   unimplementable on the chosen credential. The resolution shrank CI's blast
   radius rather than growing it (`AD-028`, **L-026**).
3. **Step 11's stated saving did not exist.** "Every nightly backup commit runs
   the full CI suite" was false: pushes made with the default `GITHUB_TOKEN`
   never trigger runs. Measuring first turned a documented-but-imaginary saving
   into an accurate note about three historical *human* pushes (**L-027**).
4. **Snapshots were not "unconfigured"** — they were on, with retention 5, and
   had simply produced nothing because the volume was 19 hours old. Wrong on
   configuration, right on outcome, and only measurement separated the two.

### The pattern underneath all of it

Every finding above has the same shape: **a green signal produced by a path
that never reached the thing under test.** A dry run that returns early. An
absence-assertion over an empty stream (**L-019**). An `if: always()` stop step
that fired and failed. A bot commit that produced no CI run for a reason
unrelated to the change being tested. A criterion satisfied incidentally reads
exactly like one satisfied by design, and only the log tells them apart. The
habit that kept catching it was cheap and mechanical: **before believing a
negative result, prove the stream was non-empty.**

### What the process cost, and whether it was worth it

Nineteen steps, three of them repairs discovered mid-run (6b, 6c, 8b) and one
(16b) whose premise turned out to be wrong. Seven workflow runs were burned on
two environment problems — `flyctl` not being on PATH as `fly`, and the lease
permission — neither of which any amount of YAML review would have found, since
both are properties of the runner and the credential rather than of the file.
The temporary `*/30` cron was the right call for exactly that reason: iterating
against a 6-hour feedback loop on a problem only CI can reproduce is the
expensive failure mode, not the deviation.

Sizing was correct. This was Large, it touched CI, a deploy platform, two shell
scripts and the project's memory files, and each harden round found something
that would otherwise have shipped as a false claim in a document people trust.

### What is genuinely still at risk

- **A review lost in flight never reaches Fly**, so no backup interval recovers
  it. Phase 3's problem; still open.
- **Nothing detects a backup that has stopped running.** A stopped backup
  produces no failure — only an absence. Three silent-failure modes are
  accepted and made visible rather than engineered away (`AD-027`'s two,
  `AD-028`'s third); the calendar reminder is the only mechanism here that
  interrupts a human unprompted.
- **Production has never been restored over.** The drill proved the mechanism
  at production *scale*, against a throwaway app. That is the right place to
  stop, and it is not the same thing.
