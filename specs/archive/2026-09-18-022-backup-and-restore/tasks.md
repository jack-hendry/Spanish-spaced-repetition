# tasks — 022 backup and restore (execution record)

> **Summarized when archived (2026-09-18).** The original was 119KB of
> step-by-step instructions, per-attempt failure analysis and Status blocks —
> working notes, superseded by this record. What is kept is what a future
> reader needs: **what was executed, what it proved, and the evidence
> identifiers**. The full file is in git history at `7dbc681^`.

**All steps done. All 13 acceptance criteria met.** 19 numbered steps plus four
inserted mid-run (`6b`, `6c`, `8b`, `16b`) — inserted rather than renumbering,
so every number still matches the one `CriticReview.md` cites.

---

## Acceptance walk — A1–A13

Walked as a **matrix against the steps**, not step by step: harden round 2
found A1 and A2 unreachable precisely because every step was individually
checkable while no step owned the *condition* the criterion needed.

| # | Verdict | Evidence |
|---|---|---|
| **A1** — scheduled, non-manual, from a stopped machine | ✅ MET | Run [35337739105](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35337739105), `event == "schedule"`, `success`, 2026-09-18T11:03:32Z; two more since (11:31:53Z, 12:05:33Z), so it repeats. Stopped-machine half: see below. |
| **A2** — the scheduled pull produced a real commit | ✅ MET | `eff78ca`, author `Backup Bot`, 11:04:15Z — 43s into run 35337739105, so it is *that* run's commit. `revlog.ndjson` gained the 8 lines from Step 8b's studied card. |
| **A3** — a no-op run commits nothing | ✅ MET | Runs [35274589387](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35274589387) and [35275578508](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35275578508), both `success`, both `updated 0, unchanged 7`, `No changes to commit`; `git log` shows one commit, not two. Checked before any card was studied (harden C6). |
| **A4** — a failing pull fails the workflow | ✅ MET | Run [35277152866](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35277152866) — *caused*, not read off the YAML. |
| **A5** — restore drill on a real throwaway app, card studied against it | ✅ MET | `spanish-srs-restoredrill`; `Successfully pushed 7 state files`; one card answered against the restored app, so it is **writable, not merely readable**; torn down (`fly apps destroy`, volume gone). |
| **A6** — the restored app matched production | ✅ MET | Recorded *before* the push, then compared. |
| **A7** — retention policy written down | ✅ MET | `AD-027`; `ROADMAP.md` Phase 2 states the same ~6h figure. |
| **A8** — snapshot config recorded, measured not assumed | ✅ MET | See "Snapshots" below. |
| **A9** — out-of-scope items recorded where they'll be found | ✅ MET | O1 and O2 in `specs/BACKLOG.md`, per **L-024** — not Quick Tasks rows. |
| **A10** — the tree is clean and honest | ✅ MET | 82 server + 216 web tests green; build clean; all three pre-push hooks Passed. |
| **A11 (as amended)** — the machine is *reclaimed* to `stopped` | ✅ MET | Two independent measurements — 426s after a dispatched run (polled), and **413s after a scheduled run**, from the machine's own event log: `start` 12:05:49Z, `exit … requested_stop=true` 12:12:42Z. Operative claim is "well under 15 minutes", never a constant. |
| **A12** — both state scripts proven under bash 5 | ✅ MET | PR #23's `hooks` job, `actions/runs/35270754369`: `GNU bash, version 5.2.21(1)-release`, then `state-scripts.bash5.test: 21 passed, 0 failed`. |
| **A13** — `push-fly-state.sh --yes` reaches its upload stage | ✅ MET | `Successfully pushed 7 state files to Fly app 'spanish-srs-restoredrill'` — **the first time this script has ever completed.** |

### A1's two halves, proven by different runs

A1 asks for a non-manual run *and* a stopped machine at the start. No single
run was observed satisfying both at the moment it happened, so rather than let
that slide:

- the **non-manual** half is run 35337739105 (`event == "schedule"`);
- the **stopped-machine** half is proven for a *scheduled* run by Fly's machine
  event log, which shows a `start` event at 12:05:49Z for the 12:05:33Z
  scheduled run. A machine that is `start`ed was `stopped` — and the event is
  Fly's record, not this repo's.

That is stronger than the plan asked for: it proves the wake path works
unattended rather than only under a dispatch. **The honest limit:** Fly's event
log retains only the last few events, so the 11:03Z run's own start event is
already gone. The claim rests on the 12:05Z run.

### Stated plainly, once

**All three scheduled runs fired under a temporary `*/30` cron, not the
`0 */6 * * *` the system ships with.** A1 demands a non-manual *trigger*, and
the `schedule` event is the same event at either cadence, so this does not
weaken A1. But the shipping cadence has only ever fired into *failing* runs
(2026-09-18T00:43Z and 06:27Z, both dying at `fly: command not found` — at the
job, never at the trigger). **The first green run at the real cadence had not
happened when this spec closed**, and could not until the branch reached `main`.

---

## What was executed

| Steps | What happened |
|---|---|
| **1–2** | The `local` fix (one deleted line) and four `((VAR++))` → `VAR=$((VAR+1))` sites. |
| **3** | `tools/state-scripts.bash5.test.sh`, 21 cases, wired into CI's `hooks` job. See "Case 9" below. |
| **4** | Checkpoint — all green. |
| **5** ⚠️ USER | Token created by the user: type **`ssh`**, `--expiry 8760h`, piped straight into `gh secret set` so no copy ever existed. Listing scope is `--app` (resolving harden R7 in the runbook's favour). Calendar reminder set ~3 weeks before expiry — per D7 that reminder, not the queryable date, is the load-bearing mitigation. **Found: two live tokens, not one** — see "Left open". |
| **6** | `.github/workflows/backup.yml` written. |
| **6b** *(repair)* | The flyctl release tarball ships no binary named `fly`; added a shim step. Found only by running it — `bash -n` and YAML validation both pass a workflow that calls a command that does not exist (**L-021**). |
| **6c** *(user decision)* | Wake by HTTP instead of machine lease. All three lease-dependent steps deleted; six steps, down from eight. `curl -f` retained so an HTTP 5xx fails the step rather than pulling from a machine that never came up. |
| **7** | Success from a genuinely stopped machine, on the third attempt. |
| **8** | A3 proven — two green runs, one commit. |
| **8b** *(inserted, harden R2)* | One card studied on production, manufacturing the change that makes A2 reachable. |
| **9** | A4 proven by causing a failure. |
| **10** | A1 and A2 earned. See the matrix above. |
| **11** | `paths-ignore: ['data/spanish/**']` on the `push` trigger only. **Its `Done when` was vacuous and is not claimed as met**, and its stated motivation was disproven — see below. |
| **12–15** | The restore drill: stand up `spanish-srs-restoredrill`, restore into it, study a card against it, tear it down. |
| **16** | Snapshots measured. |
| **16b** ⚠️ USER | **Could not be done as written — its premise was wrong.** The rotation it gated on was handled as `f46f711` (AD-023, AD-024 → `STATE-ARCHIVE.md`). |
| **17** | `AD-027` written. |
| **18** | O1 and O2 → `specs/BACKLOG.md`. |
| **19** | Regression and wrap-up. |

### Step 7 — three attempts, each failure a finding

| Attempt | Outcome |
|---|---|
| 1 (runs [35272533757](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35272533757), [35272676581](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35272676581)) | `fly: command not found` at the first `fly` call. Not transient. → Step 6b. |
| 2 (run [35273590615](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35273590615)) | Shim worked; Fly refused the machine lease — `failed to obtain lease: failed to get lease on VM 850d53cd95d668: unauthorized`. The documented **If blocked** path, reached for real. → Step 6c. |
| 3 (run [35274589387](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35274589387)) | **`success`**, 24s, machine `stopped` before it. HTTP wake returned `{"ok":true}` — no machine lease needed. Pull: 7 files, `updated 0, unchanged 7`. No commit, as expected. |

**A11 was misreported as met on attempt 2, and the correction is the point.**
The executing subagent recorded A11 as holding because the `if: always()` stop
step ran and the machine read `stopped` afterwards. The stop step had *also*
failed `unauthorized`; the machine was stopped only because `start` had failed
and it never woke. `if: always()` was proven to *fire*, never to *work*. **A
criterion satisfied incidentally reads exactly like one satisfied by design;
only the log distinguishes them.** → **L-026**.

### Step 3 — Case 9, and why it was rewritten

Case 9 pins Step 1's regression. As first written, its only assertion was the
*absence* of `can only be used in a function` — vacuous, because if the script
had died early for any unrelated reason the output would lack the string too
and the case would pass while proving nothing. This matters most on CI, where
the `hooks` job has **no `fly` binary**, so the fly-error path cannot be what
proves reachability.

Two positive controls were added (`Local file sizes:` proves the loop was
entered; `Total local size:` proves it ran to completion), then **verified to
be real controls** by pointing the case at a deliberately broken fixture:

```
FAIL  Control 1 SHOULD FAIL (loop entered)
FAIL  Control 2 SHOULD FAIL (loop completed)
PASS  Absence assertion (should pass vacuously)   ← the failure being guarded against
```

The third line is the whole argument. Same shape as the defect Step 1 fixed —
a check that is green on the path nobody runs. → **L-019**.

### Steps 12–15 — the restore drill

Reference numbers recorded **before** the push, because A6 requires comparing
against a recorded value rather than an impression:

| | Production | Drill app after restore |
|---|---|---|
| Decks | 2 | **2** |
| Notes | 3,638 | **3,638** |
| Cards | 7,276 | **7,276** |
| By queue | learning 8, new 6,631, review 624, schedBuried 12, suspended 1 | **identical** |
| By type | new 6,631, relearning 9, review 636 | **identical** |
| Revlog lines | 3,915 | 3,915 |

Both breakdowns sum to 7,276 — the internal consistency check on the numbers
themselves. The repo/Fly byte-equality claim was **re-measured, not inherited**:
all seven files `cmp`-identical a day after harden C6 asserted it.

**The sentinel positively confirmed the restore.** The drill app was redeployed
**without** `ALLOW_EMPTY_STORE=1` and booted clean, so it did not merely
tolerate the restored volume — `AD-026`'s empty-store guard confirmed the
volume was populated.

**Deviation from the step text, stated plainly.** The step asked for per-deck
*due* counts from production's `/api/collection`. Not done, and not doable:
production's basic-auth credentials are Fly secrets, and per-deck due counts
are not a server endpoint at all — `CollectionStore` computes them client-side
from `todayNumber`. Recomputing them here would have meant reimplementing
scheduling logic in a throwaway script, which O5 forbids and which would have
proved only that two implementations agree. The substitute is strictly stronger
for A6's purpose: byte-identity of `cards.json` means the due state *is* the
same by construction, and the app-served counts prove the drill app actually
parsed and loaded it rather than just holding the bytes.

Step 14 then confirmed the round trip end to end — production → repo → push →
drill volume → pull → repo, byte-clean — and studied a card against it.

### Step 16 — snapshots, measured not assumed

`Scheduled snapshots: true`, `Snapshot retention: 5`, and **zero snapshots
existed** (volume 19h old). The first appeared 2026-09-17
(`vs_yeo71KGwpvPXTKZ25653LKp7`, 345 MiB); at Step 19 there was still exactly
one. So the roadmap was wrong on configuration and right on outcome — and the
runbook now distinguishes the 5-day retention **setting** from the actual
rollback **depth**, which the two had been conflating.

### Step 11 — the edit is right, the reason was not

`paths-ignore` added to the `push` trigger only; `pull_request` untouched.

**The `Done when` was vacuous and is NOT claimed as met.** The bot commit
produced no CI run — and that proves nothing, because `backup.yml` pushes with
the default `GITHUB_TOKEN` and GitHub refuses to start a run from such a push
regardless of `paths-ignore`.

**Measured before claiming a saving, and the measurement changed the story:**

| | Count |
|---|---|
| Commits touching `data/spanish/` | **24** |
| …that triggered a `push` CI run | **6** |
| …of those, changing `data/spanish/` **exclusively** | **3** |

So the saving is **3 historical runs, all from human pushes**. C8's premise —
"every nightly data-only commit runs the full suite" — was false; bot commits
had always been free by GitHub's design. The change is hygiene for the human
case, not a fix for a bot case that was costing anything. → **L-027**.

*(The executing subagent reported 2 qualifying commits; the true figure is 3.
Corrected at the top level, along with an invented justification comment and
some unrelated Prettier churn — `.github/` is outside `format:check`'s scope.)*

### Step 10 — a mass `due` shift that read exactly like corruption

646 cards all moved `due` +1 in a single bot commit. Investigated before the
commit was accepted. **Not corruption:** it is the pause/resume feature
(`dayDelta` 1, day 85 → 86), corroborated by `lastUnburyDay`, `daily.day`, and
a `collection.created` that did not move. **Rolling it back would have
destroyed the resume.** Runbook material, because mid-incident this is
indistinguishable from a bad write.

---

## Process findings

**Subagents cannot write spec docs.** `protect-spec-docs-from-subagents.sh`
blocks it, so a `Status:` block can only be written by the top-level session —
the harness guarding specs "from the other direction", working as designed. But
several step prompts had asked subagents to do exactly that, producing two
false "I updated the Status" reports before anyone noticed. Ask them to
*report* the evidence table; have the orchestrator write it.

**Step 10's own record went missing the same way.** Its work was done and
written into a commit *message*, while the commit's diff touched only Step 11's
Status line. Caught at Step 19 and reconstructed from the evidence rather than
from the message. Evidence in a commit message is evidence nobody greps.

**The temporary cron deviation.** `0 */6 * * *` was dropped to `*/30` to
shorten Step 10's feedback loop — every scheduled run had failed, and at 6h
each fix-test iteration costs six hours. Safe because `0 */6 * * *` was already
proven to *fire*; both its failures were inside the job, never at the trigger,
so switching back exercised nothing untested. Recorded as a gate on Step 19,
which did not pass until the line read `0 */6 * * *` again. While the deviation
was live, `AD-027`'s stated 6h window was wrong in the *safe* direction, so it
was left alone rather than edited for a deliberately temporary state.

---

## Left open at close, named rather than closed quietly

1. **An orphaned live Fly token has never been revoked.** `fly tokens list
   --app spanish-srs` showed **two** unrevoked `flyctl ssh token` rows created
   ~49s apart; the secret's `updatedAt` matches `0wj3jnOmeL…`, making
   `MAwawkKV1G…` a live credential with no known consumer — leak surface with
   no compensating benefit. The user decided on 2026-09-17 to revoke it once
   Step 7 was green; Step 7 went green that day and it was missed. Revoking it
   from the session was blocked by the permission classifier (secret-store
   write). Commands now sit in `specs/BACKUP-RUNBOOK.md` under a 🔴 OUTSTANDING
   banner so it cannot be lost again.
2. **No green run at the shipping `0 */6 * * *` cadence** — the cron was
   reverted in the working tree, and only takes effect on `main`.
3. **Production has never been restored over** — deliberate, per O7.
