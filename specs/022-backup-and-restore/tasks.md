# tasks — 022 backup and restore

**21 steps, in order, do not skip ahead.** Written after harden round 1
(`CriticReview.md`), then revised by **harden round 2** against this file —
its nine required changes (R1–R9) are applied below. Steps **8b** and **16b**
were inserted rather than renumbering, so every step number still matches the
one round 2 cites. Both are load-bearing on *ordering*, not just content:
8b must follow 8, and 16b must precede 17.

Read `.claude/skills/testing-playbook` before checking off any step.
**No step in this spec may edit `server/src/` beyond a comment, or anything
under `web/src/app/core/scheduling/`** — Analyst O5. If a step finds itself
there, STOP and re-classify.

**Progress (2026-09-17):** Steps 1–6, 12–16 and 18 are ✅ done. Step 5's token
and secret were created by the user, so **Steps 6–11 are unblocked**.

**Remaining blocker:** **Step 16b** — the user chose *rotate now* but
`state_rotate.py --apply` has not been run yet (`--check` still reports 291
lines). Step 17 is the first step that writes to `specs/STATE.md` and **must
not run before that rotation lands**. Steps 7–11 do not touch `STATE.md` and
can proceed meanwhile.

**Carried caveats, not to be lost at Step 19:**
- Step 3's bash-5 half of A12 is pending the first CI run on `ubuntu-latest`.
- Step 11's `Done when` is **vacuous as written** — see the ⚠️ in that step.
- Whether the `ssh`-scoped token can `fly machine start`/`stop` is unverified
  until Step 7.
- A second, orphaned live Fly token is to be revoked once Step 7 is green
  (see Step 5).

---

### Step 1 — Fix the fatal `local` in `push-fly-state.sh`

**Model:** haiku

**Status:** ✅ **done** (2026-09-17). One line deleted, nothing else:

```diff
--- a/tools/push-fly-state.sh
+++ b/tools/push-fly-state.sh
@@ -170,7 +170,6 @@ local_total=0
   for file in "${FILES[@]}"; do
     local_path="$SOURCE_DIR/$file"
     if [[ -f "$local_path" ]]; then
-    local size
       size=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" ...
```

**Done when — all three green:**

1. `awk '/^[a-zA-Z_]+\(\)/{f=1} /^}/{f=0} /^[[:space:]]*local /{print NR": "(f?"IN-FUNC":"TOP-LEVEL")}' tools/push-fly-state.sh`
   → `110: IN-FUNC`, `114: IN-FUNC`, `134: IN-FUNC`. Three lines, all
   `IN-FUNC`, no `TOP-LEVEL`. The two `print_plan()` locals were not touched.
2. `bash tools/push-fly-state.sh --app no-such-app-xyz --yes <fixture-dir>`
   over a complete 7-file fixture now reaches the upload stage — **this is
   A13**. It printed the full plan (`Total local size: 5816898 bytes`), then:
   ```
   Pushing to Fly.io app 'no-such-app-xyz'...
   Error: get app: app not found (Request ID: 01M2R06KMM625BHM7TDCGESB9W-iad)
   Error: Failed to create remote staging directory
   ```
   No `local: can only be used in a function`. Exit is non-zero **as
   expected** (harden R9) — the bogus app is the point; the pass condition is
   absence of the `local:` error plus presence of a `fly` error, and both hold.
3. `bash -n tools/push-fly-state.sh` → exit 0. (**L-021**: syntax only. It is
   listed third for that reason — checks 1 and 2 are what actually prove it.)

The "If blocked" branch did not fire: the line was still `local size`, so
nobody had fixed it outside this spec.

**Files**
- MODIFY `tools/push-fly-state.sh` — anchor: the line `    local size` that
  sits *below* the comment `echo "Local file sizes:"` (~line 173). There are
  two other `local size`-style lines at ~110/~114 **inside `print_plan()`** —
  those are legal and MUST NOT be touched.
- DO NOT TOUCH: `tools/pull-fly-state.sh` (Step 2 owns it).

**Context**
`local` is only valid inside a function. Line 173 is in a top-level `for`
loop, so under the script's own `set -euo pipefail` it aborts the run before
a single byte is uploaded — the `--yes` path has therefore never worked. The
dry-run path returns from `print_plan()` before reaching it, which is why
every dry run passed. Sibling variable `local_total` on the preceding line is
a plain global; make `size` the same.

**Do**
1. Delete the word `local` from that one line, leaving `    size` declared
   implicitly by the assignment on the next line — i.e. remove the standalone
   `local size` line entirely, since `size=$(stat ...)` immediately follows.
2. Change nothing else.

**Done when**
- `awk '/^[a-zA-Z_]+\(\)/{f=1} /^}/{f=0} /^[[:space:]]*local /{print NR": "(f?"IN-FUNC":"TOP-LEVEL")}' tools/push-fly-state.sh`
  prints **three** lines, all `IN-FUNC`, and **no** `TOP-LEVEL`.
- `bash tools/push-fly-state.sh --app no-such-app-xyz --yes <any-dir-with-the-7-files>`
  no longer prints `local: can only be used in a function`, and gets as far
  as attempting a `fly` call against the bogus app.
  **This command is expected to exit non-zero** (harden R9) — the bogus app
  makes `fly` fail, which is the point. The pass condition is the *absence*
  of `local: can only be used in a function` together with the *presence* of
  a `fly` error. Do not report the step blocked on the non-zero exit.
- `bash -n tools/push-fly-state.sh` exits 0. (Note **L-021**: this proves
  syntax only, never that the commands exist — it is not sufficient on its
  own, which is why the two checks above come first.)

**If blocked**
If the line at ~173 is already `size=` with no `local`, someone fixed it
outside this spec — STOP and report rather than editing blind.

---

### Step 2 — Make both scripts' counters bash-5 safe

**Model:** haiku

**Status:** ✅ **done** (2026-09-17). Four `((VAR++))` sites replaced with
`VAR=$((VAR+1))`; loops otherwise unrestructured.

| File | Line | Was |
|---|---|---|
| `tools/pull-fly-state.sh` | 26 | `((POSITIONAL_ARGS++))` |
| `tools/pull-fly-state.sh` | 106 | `((unchanged++))` |
| `tools/pull-fly-state.sh` | 108 | `((updated++))` |
| `tools/push-fly-state.sh` | 32 | `((POSITIONAL_ARGS++))` |

**Done when — all three green:**

1. `grep -n '((.*++))' tools/pull-fly-state.sh tools/push-fly-state.sh` →
   nothing.
2. Positive control (**L-019** — a zero-result grep proves nothing unless the
   stream was non-empty): `git show HEAD:tools/pull-fly-state.sh | grep -c '((.*++))'`
   → **3**. Read out of `HEAD`, **not** via `git stash` (harden R4): Step 1's
   fix to `push-fly-state.sh` was still uncommitted at this point and a stash
   would have swept it up.
3. Parsing intact: `bash tools/pull-fly-state.sh --help` → `Error: Unknown
   option '--help'` (the script has no `--help`; the point is that it parses
   and rejects cleanly). Arg-count guard intact:
   `bash tools/pull-fly-state.sh arg1 arg2` →
   `Error: Only one positional argument (destination dir) allowed`.

Note what this step does **not** prove: every check above ran on this
machine's **bash 3.2.57**, which is precisely the version where the bug does
not fire. Step 3 is what moves it onto bash 5.

**Depends on:** Step 1 — shares `tools/push-fly-state.sh`, so must not run
in parallel with it (TEMPLATE parallel rule 2).

**Files**
- MODIFY `tools/pull-fly-state.sh` — anchors: `((POSITIONAL_ARGS++))`,
  `((unchanged++))`, `((updated++))`
- MODIFY `tools/push-fly-state.sh` — anchor: `((POSITIONAL_ARGS++))`

**Context**
`(( expr ))` returns exit status 1 when `expr` evaluates to 0. A
post-increment's value is the *old* value, so `((n++))` at `n=0` is a
status-1 command that `set -e` can treat as fatal. It does not fire on this
machine (bash 3.2.57) but the backup workflow runs on `ubuntu-latest`
(bash 5.x), which was not testable locally — no bash 5, no Docker daemon.
This is the same failure family as Step 1: fine on the tested path, fatal on
the path that matters.

**Do**
1. Replace each `((VAR++))` with `VAR=$((VAR+1))` in both files.
2. Do not otherwise restructure the loops.

**Done when**
- `grep -n '((.*++))' tools/pull-fly-state.sh tools/push-fly-state.sh`
  returns **nothing**.
- `bash tools/pull-fly-state.sh --help 2>&1 || true` and a positional-arg
  invocation still parse correctly (the arg-count guard still rejects two
  positional args with `Only one positional argument`).
- Positive control for the above, per **L-019** — a zero-result grep proves
  nothing unless the stream was non-empty:
  ```sh
  git show HEAD:tools/pull-fly-state.sh | grep -c '((.*++))'   # → 3
  ```
  **Do not use `git stash` for this** (harden R4). At this point Step 1's
  one-word fix to `push-fly-state.sh` is still uncommitted, so a stash takes
  it too and a conflicting `git stash pop` strands it. Reading the pre-fix
  file out of `HEAD` is exact and touches nothing.

---

### Step 3 — Prove both scripts under bash 5

**Model:** haiku

**Status:** ✅ **done locally** (2026-09-17); the bash-5 half of A12 is
**pending the first CI run** — see the caveat at the end.

Created `tools/state-scripts.bash5.test.sh` (executable, ~170 lines) in the
shape of the existing matrices (`scripts/clean-table-check.test.sh`,
`tools/archive_spec.test.sh`): standalone, `mktemp -d` fixture per case,
non-zero exit on failure, `bash --version` printed first so the runner's
version is in the log rather than assumed. **21 cases, 0 failed** locally on
bash 3.2.57.

Coverage — no-network paths only, as the step requires:

| Script | Cases |
|---|---|
| `pull-fly-state.sh` | unknown flag → exit 1 + message; two positional args → exit 1 + `Only one positional argument` |
| `push-fly-state.sh` | same two arg-parsing cases |
| `push-fly-state.sh` | `validate_local_store`: missing file; zero-length file; `cards.json` as `[]` |
| `push-fly-state.sh` | dry-run plan: exit 1, prints `PUSH PLAN`, `Total local size`, `Not pushing without --yes` |
| `push-fly-state.sh` | **Case 9 — the Step 1 regression, pinned** |

**Case 9 was revised after first submission, and the revision is the
load-bearing part of this step.** As first written its only assertion was the
*absence* of `can only be used in a function`. That is vacuous under
**L-019**: if the script had died early — a `validate_local_store` rejection,
a renamed flag, a typo in the fixture builder — the output would lack the
string too and the case would have passed while proving nothing. This matters
most on CI, where the `hooks` job has **no `fly` binary**, so the fly-error
path cannot be what proves reachability. Two positive controls were added:

- output contains `Local file sizes:` — printed by the top-level `for` loop
  immediately above the line Step 1 fixed, so its presence proves that exact
  code path was entered;
- output contains `Total local size:` — proves the loop ran to completion
  rather than dying inside it.

The controls were then verified to be real controls, by pointing Case 9 at a
deliberately broken fixture (an empty dir):

```
FAIL  Control 1 SHOULD FAIL (loop entered)   (pattern 'Local file sizes:' not found)
FAIL  Control 2 SHOULD FAIL (loop completed) (pattern 'Total local size:' not found)
PASS  Absence assertion (should pass vacuously)   ← exactly the failure being guarded against
```

The third line is the point: the absence assertion passes on a run that never
executed the code. Restored to the correct fixture, all three pass. This is
the same shape as the defect Step 1 fixed — a check that is green on the path
nobody runs — so it was worth the extra round.

Registered in `.github/workflows/ci.yml` under the **`hooks` job only**; the
`on:` trigger was deliberately left untouched for Step 11 (harden R6):

```diff
       - run: ./tools/archive_spec.test.sh
+      # These scripts run by hand on macOS bash 3.2, but the backup workflow runs
+      # them on ubuntu-latest's bash 5. The bash 5 fixes (Step 1's local removal,
+      # Step 2's post-increment replacement) are not testable locally and only
+      # surface as failures on CI.
+      - run: ./tools/state-scripts.bash5.test.sh
```

**Caveat — the third Done-when item is not yet met.** "On the first CI run,
the job log shows `GNU bash, version 5.` and the suite green" cannot be
satisfied until this branch is pushed. Everything above ran on **bash 3.2**,
which is the version where Step 2's bug does *not* fire. Until CI runs, Step 2
is verified only on the platform that was never at risk. Carry this into Step
19's A12 row rather than letting it read as closed.

**Depends on:** Step 2 — verifies the change it makes.

**Files**
- CREATE `tools/state-scripts.bash5.test.sh`
- MODIFY `.github/workflows/ci.yml` — anchor: the `hooks:` job's step list.
  **Step 11 also edits this file** (its `on: push` trigger) and runs later
  (harden R6). Touch the `hooks` job only; leave `on:` alone.

**Context**
Analyst A12. The whole point of Step 2 is a bash version this machine does
not have, so a local green run is not evidence. CI's `ubuntu-latest` runner
*is* bash 5, so the check belongs there. Follow the shape of the existing
regression matrices wired into the `hooks` job
(`scripts/clean-table-check.test.sh`, `tools/archive_spec.test.sh`): a
standalone executable shell script, throwaway fixture dir per case, non-zero
exit on failure.

**Do**
1. Write a test that, for each script, exercises **only the paths that need
   no network**: argument parsing (bad flag → exit 1; two positional args →
   exit 1), and `push-fly-state.sh`'s dry-run plan + its
   `validate_local_store` failure cases (missing file, zero-length file,
   `cards.json` as `[]`).
2. Add one case that runs `push-fly-state.sh --yes` against a bogus app name
   over a complete fixture store and asserts the output **does not** contain
   `can only be used in a function` — the Step 1 regression, pinned.
3. Register it in the `hooks` job with a comment saying why: these scripts
   are only ever run by hand on macOS bash 3.2, and the backup workflow runs
   them on bash 5.
4. Print `bash --version` in the test output so the runner's version is
   visible in the log rather than assumed.

**Done when**
- `./tools/state-scripts.bash5.test.sh` passes locally (bash 3.2) with a
  summary line naming the number of cases.
- The new CI step appears in `.github/workflows/ci.yml` under `hooks`.
- On the first CI run, the job log shows `GNU bash, version 5.` and the
  suite green.

**If blocked**
If any case needs a live Fly app to pass, it is the wrong case — restrict to
the no-network paths and note the gap. Do not add Fly credentials to CI's
`hooks` job.

---

### Step 4 — Checkpoint

**Model:** haiku

**Status:** ✅ **done — all green** (2026-09-17).

1. **Steps 1–3 Done-when, re-run:** `local` declarations → 3 lines, all
   `IN-FUNC` (110, 114, 134); `bash -n` exit 0 on both scripts; `((.*++))`
   grep empty with its `HEAD` positive control still returning **3**;
   `pull-fly-state.sh arg1 arg2` still rejected with `Only one positional
   argument`; `./tools/state-scripts.bash5.test.sh` → **21 passed, 0 failed**.
2. **`npm run test`** — server **82 tests / 12 files**, web **216 tests / 21
   files**, all passing. Both match the last recorded baselines (216 web tests
   is the post-`010-day-rollover-anchoring` number), so this spec has neither
   added nor lost a test — correct, since nothing it touches has a unit-test
   surface. The new `tools/state-scripts.bash5.test.sh` is a shell matrix wired
   into CI's `hooks` job, not a vitest suite, so it is deliberately absent from
   these counts.
3. **`npm run build`** — server `tsc` and web `ng build` both clean.
4. **`pre-commit run --hook-stage pre-push --all-files`** — all three local
   pre-push hooks passed: `clean-table-check` (the SDD archive/STATE.md/
   lessons/Status: gates), `format-check` (Prettier), `eslint-check`
   (`npm run lint:ci`).
5. **`git status --short data/spanish/` is empty** (**L-002**). No
   `git checkout -- data/spanish/` was needed; the dev server has not run.
6. **`data/spanish/` vs Fly (harden C6, which Step 8 depends on):** last
   commit touching it is `65532a0` *"Pull Fly scheduling state (restore
   point)"*, working tree clean. This checkpoint deliberately does **not**
   claim byte-equality — it had no Fly access by instruction, because the Step
   13 agent was concurrently pulling production state. The authoritative
   byte-level `cmp` is recorded under Step 13, measured rather than inherited
   from harden C6.

**Depends on:** Steps 1–3.

**Do**
1. Re-run each of Steps 1–3's **Done when** commands.
2. `npm run test` and `npm run build`.
3. `pre-commit run --hook-stage pre-push --all-files`.
4. `git status` — confirm `data/spanish/` is **clean** (**L-002**). If the
   dev server ran, `git checkout -- data/spanish/`.

**Done when**
- All of the above green, and `git status --short data/spanish/` is empty.
- Report the current `data/spanish/` vs Fly equality state, because Step 8
  depends on it (harden C6).

---

### Step 5 — Create the Fly token and the GitHub secret  ⚠️ USER

**Model:** top-level

**Status:** ✅ **done by the user** (2026-09-17) — Steps 6–11 are unblocked.
Token **type: `ssh`** (`fly tokens create ssh`, the least-privilege candidate).
**Scope that listed it: `--app`** — `fly tokens list --app spanish-srs` shows
it, so the command `specs/BACKUP-RUNBOOK.md` already documents is correct and
**Step 19 item 5a needs no change** (harden R7 resolved). `--scope org` was
also tried and is not usable non-interactively (`failed retrieving org slug
argument must be specified when not running interactively`), which is a second
reason the runbook should keep the `--app` form.

`gh secret list --repo jack-hendry/Spanish-spaced-repetition` →
`FLY_API_TOKEN`, one row. Expiry is ~1 year out as decided (`--expiry 8760h`);
the date itself is deliberately **not** written here (D7 / **L-009**) — query
it with `fly tokens list --app spanish-srs`.

**Still unverified, by design:** whether an `ssh`-type token can run
`fly machine start`/`stop`. Step 7 is the test. If it cannot, Step 5's **If
blocked** applies — present deploy-vs-org to the user, do not widen silently.

⚠️ **Finding — two live tokens exist, not one.** The Done-when asks for
*exactly one*; `fly tokens list --app spanish-srs` shows **two**, both named
`flyctl ssh token`, both unrevoked, created ~49s apart. The secret's
`updatedAt` (`19:58:43Z`) matches the later one (`0wj3jnOmeL…`), so the earlier
one (`MAwawkKV1G…`) is an **orphan**: a live credential with no known consumer,
which is a leak surface with no compensating benefit. Raised with the user, who
chose **revoke it after Step 7** — deliberately not before, because if the
secret somehow holds the *other* token then Step 7 fails at `fly machine start`
for a reason unrelated to the ssh-scope question Step 7 exists to answer. The
command, to run once Step 7 is green:

```
fly tokens revoke MAwawkKV1GzBKSw39n5OJ19lpeCzpQX3m5pqwb1T8k
```

Then re-assert the original Done-when: `fly tokens list --app spanish-srs`
shows **exactly one** live token with an empty `REVOKED AT`.

✅ **Calendar reminder exists** (confirmed by the user, 2026-09-17), ~3 weeks
ahead of expiry. Per D7 / **L-009** the date is not recorded here. This is D6's
actual mitigation for the silent stop; the queryable date is not, because
nobody thinks to query it.

The command handed over, expiry included per D6, piped so the value never
renders in a terminal, this transcript, or a browser:

```
fly tokens create ssh --app spanish-srs --expiry 8760h \
  | gh secret set FLY_API_TOKEN --repo jack-hendry/Spanish-spaced-repetition
```

Measured while blocked, so the Done-when assertions stay clean:
`gh secret list --repo jack-hendry/Spanish-spaced-repetition` returns
**nothing** — the repo has no secrets at all yet, so "shows `FLY_API_TOKEN`"
is an unambiguous check rather than a diff against existing rows. This matches
harden round 2's finding that `fly tokens list --app spanish-srs` was empty.

Still to be filled in here when it runs: the token **type** that proved
sufficient (`ssh` is the least-privilege candidate but is **unverified** for
`fly machine start`/`stop`, which Steps 6–7 need); **which scope listed it**
(`--app` vs `--scope org`, harden R7) — Step 19's runbook correction depends
on that answer; and confirmation that the **calendar reminder** ~3 weeks ahead
of expiry exists, which is D7's actual mitigation. Do **not** write the
creation or expiry date here (D7 / **L-009**).

**Context**
Analyst §6 Q1 / harden C4. This session's permission classifier denied
creating a Fly token (`Credential Materialization`) and that denial was not
worked around. `fly tokens create ssh --app spanish-srs` is the
least-privilege candidate ("Create token for SSH'ing to a single app"), which
is the right answer to non-negotiable #1 — **but it is unverified**, and
Steps 6–7 now also need `fly machine start`/`stop`, which an SSH-scoped
token may not grant.

**Do**
1. User creates the token **and pipes it straight into the secret**, so the
   value never renders in a terminal, a transcript or a browser:
   ```
   fly tokens create ssh --app spanish-srs --expiry <chosen> \
     | gh secret set FLY_API_TOKEN --repo jack-hendry/Spanish-spaced-repetition
   ```
2. `--expiry 8760h` (**1 year**, decided by the user 2026-09-17). The default
   is `175200h` — 20 years — for every token type, so this must be passed
   explicitly. Analyst D6: a short expiry shrinks the leak window but
   guarantees an eventual silent stop.
2a. **Do not write the creation or expiry date into any file** (Analyst D7 /
   **L-009**). Both are queryable —
   `fly tokens list --app spanish-srs` gives `EXPIRES AT`, and
   `gh secret list --repo jack-hendry/Spanish-spaced-repetition --json name,updatedAt`
   gives the set date. Any comment that needs to mention expiry names the
   **command**, not the answer.
2b. **Create a calendar reminder ~3 weeks before the expiry date** returned by
   `fly tokens list`. This is the actual mitigation for D6's silent stop —
   the queryable dates are not, because nobody will think to query them.
   Record that the reminder exists.
3. **Do not echo the token into the transcript**, and never commit it.
   Note the session transcript is a file on disk (`~/.claude/projects/…`)
   retained for `cleanupPeriodDays` — a token printed into it is a durable
   copy of a live credential.
4. Record in this file which token *type* was ultimately used, and if an
   SSH-scoped token proved insufficient, record what it could not do — that
   is a security-relevant fact the next person should not have to rediscover.
   Verified scopes: `ssh` = SSH to one app **plus org WireGuard access**;
   `deploy` = one app and its resources; `org`/`readonly` = org-wide. The
   `personal` org contains exactly one app, so WireGuard has nowhere to move
   laterally.

**Done when**
- `gh secret list --repo jack-hendry/Spanish-spaced-repetition` shows
  `FLY_API_TOKEN`.
- `fly tokens list --app spanish-srs` shows exactly one live token with a
  non-empty `EXPIRES AT` roughly one year out and an empty `REVOKED AT`.
  **Measured at harden round 2: that list is currently empty**, so "exactly
  one" is a clean assertion. If the new token does *not* appear there, try
  `fly tokens list --scope org` before concluding anything (harden R7) — an
  `ssh`-type token may be listed at org scope. **Record which scope listed
  it.** This is not cosmetic: `specs/BACKUP-RUNBOOK.md` tells the operator to
  read `EXPIRES AT` from the `--app` form, and D7's entire case for storing
  no dates is that they are queryable. If the documented query returns
  nothing, the operator has no path to the expiry date at all — so Step 19
  must carry the working command into the runbook.
- The token **type** is written into this step's Status line — the type is a
  durable design fact; the dates are not (D7), so do not copy them here.
- A calendar reminder exists ahead of the expiry date.

**If blocked**
If an SSH-scoped token cannot start/stop machines, STOP and present the
trade-off (deploy token vs org token) to the user rather than silently
reaching for the broader one. Non-negotiable #1 requires that choice be made
knowingly.

---

### Step 6 — Write `.github/workflows/backup.yml`

**Model:** haiku

**Status:** ✅ **done** (2026-09-17) — file written; **not yet exercised**
(Step 7 owns that). Shape as harden C2/C3 requires: resolve machine id →
start → pull → commit-if-changed → stop, with the stop under `if: always()`.

**Verified independently of the subagent's report, not taken on trust:**

| Claim | Check | Result |
|---|---|---|
| Pinned SHA is real | `gh api repos/superfly/flyctl-actions/git/refs/tags/1.5` | `fc53c09e…` — matches, and resolves to a real commit |
| `.[0].id` is the right jq path | `fly machine list --app spanish-srs --json \| jq 'keys_unsorted'` | `id` present at element top level |
| Bare `pull-fly-state.sh` targets the right app/dir | read `tools/pull-fly-state.sh:10-11` | defaults `APP_NAME=spanish-srs`, `DEST_DIR=data/spanish` — no args needed |
| No softening | `grep -c 'continue-on-error\|\| true'` | **0** |
| Parses | `yaml.safe_load` | clean; `permissions`/`env` confirmed at **job** level, stop step `if: always()` |

**Two defects found in the first submission and sent back** — worth recording,
because both are the "green on the path nobody runs" shape this spec exists to
punish:

1. `permissions` and `env` were at **workflow** level, not job level as item 4
   requires. Behaviourally identical with one job — and that is exactly the
   problem: it would silently widen the token's exposure to any job added
   later, with nothing failing to signal it.
2. `jq -r '.[0].id'` on an empty array yields the **literal string `null`** and
   exits 0, so a missing machine surfaced three steps later as
   `fly machine start null`. Now `// empty` + an explicit `::error::` + exit 1,
   so the failure names its own cause. This is a *loudening*, not a softening —
   item 6's direction.

**Also noted for Step 11 — see the ⚠️ in that step.** This workflow pushes with
the default `GITHUB_TOKEN`, and GitHub does not start a workflow run from such a
push. That makes Step 11's `Done when` vacuous as written; the note there gives
the real control to use instead.

**Still unverified, by design:** whether the `ssh`-type token from Step 5 can
run `fly machine start`/`stop`. Step 7 is the test, and Step 7's **If blocked**
is the path if it cannot.

**Depends on:** Step 5 ✅ — consumes the `FLY_API_TOKEN` secret; Step 2 ✅ — the
workflow runs the scripts under bash 5.

**Depends on:** Step 5 — consumes the `FLY_API_TOKEN` secret; Step 2 — the
workflow runs the scripts under bash 5.

**Files**
- CREATE `.github/workflows/backup.yml`
- DO NOT TOUCH: `tools/pull-fly-state.sh` (already correct after Step 2),
  `.github/workflows/ci.yml` (**Step 3 edited its `hooks` job; Step 11 edits
  its `on:` trigger** — harden R6), `specs/BACKUP-RUNBOOK.md` (Step 19
  reconciles it).

**Also:** the workflow needs a header comment pointing at
`specs/BACKUP-RUNBOOK.md` — that runbook is deliberately not linked from
`CLAUDE.md` (L-017), so this comment is the only path anyone debugging a
failed backup will follow to it.

**Context**
Harden C2/C3 fixed the shape: **start → pull → commit-if-changed → stop**,
not pull → commit. The start is mandatory — `fly ssh` does *not* wake a
sleeping machine (`Error: app spanish-srs has no started VMs`). The stop is
hygiene: auto-stop was **measured** to reclaim a machine woken for `sftp`
alone after 539s, so it is not load-bearing, but stopping explicitly saves
~9min idle per run and makes the end state commanded rather than inferred.
Measured: start 1.0s, 7-file pull 19.5s, auto-stop ~9min.

Commit-detection must never use the script's own `updated N, unchanged N`
line, which reports `updated` for any file that merely did not exist before
(harden C7). Use **`git status --porcelain -- data/spanish/`**, not
`git diff --quiet` (harden R5): `git diff` is blind to untracked files, so
the day an eighth state file joins `pull-fly-state.sh`'s list, the first
backup containing it would commit nothing and report success — silent loss,
which non-negotiable #2 forbids. All seven files are tracked *today*, which
is why `git diff` looks fine; that is correctness by accident of current
state, the same shape as C7. `data/spanish/media/` is gitignored
(`.gitignore:28`), so `--porcelain` will not be polluted by the 252MB tree.

**Do**
1. Triggers: `schedule` with **`cron: '0 */6 * * *'`** (Analyst D5 — every 6
   hours: 00/06/12/18 UTC = 20/02/08/14 Toronto) and `workflow_dispatch`.
   Comment the UTC/local relationship, and note that GitHub cron is
   best-effort and can run late under load — the interval is a ceiling on
   *scheduling*, not a guarantee of punctuality.
2. `permissions: contents: write`.
3. Steps, in order: checkout → install flyctl (`superfly/flyctl-actions/setup-flyctl`)
   → `fly machine start` → `bash tools/pull-fly-state.sh` →
   `[ -z "$(git status --porcelain -- data/spanish/)" ] || (commit && push)`
   → `fly machine stop` in an `if: always()` step so a failed pull still puts
   the machine back to sleep.
4. `FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}` at job level.
4a. **Pin `superfly/flyctl-actions/setup-flyctl` to a commit SHA, not a
   moving tag** (Analyst S6) — a third-party action resolved by tag is a
   supply-chain path straight to the secret. Put the human-readable version
   in a trailing comment.
5. Commit author: a bot identity, message naming it as an automated pull.
6. **No `continue-on-error`, no `|| true` around the pull.** A backup job
   that reports success when it backed nothing up is worse than none.
7. Resolve the machine id dynamically rather than hardcoding
   `850d53cd95d668` — a redeploy can replace it.

**Done when**
- `.github/workflows/backup.yml` exists and
  `gh workflow list` shows it after push.
- `grep -c 'continue-on-error\|| true' .github/workflows/backup.yml` → 0.
- Manual read-through confirms the stop step is `if: always()`.

---

### Step 7 — Prove it from a *stopped* machine (A1, A11)

**Model:** haiku

**Status:** not started

**Depends on:** Step 6.

**Context**
Analyst A1 as corrected by harden C2: a run that begins while the machine
happens to be awake proves nothing about the nightly case, which is the only
case that will ever occur.

**Do**
1. `fly machine stop <id> --app spanish-srs`; confirm `stopped`.
2. Trigger `gh workflow run backup.yml`; watch it.
3. Record machine state before, during and after.

**Done when**
- Machine state was `stopped` immediately before the run — record it.
- The run concludes `success`. Record the URL.
- Machine state after the run is `stopped` (**A11**). Record it.
- If state changed, `git log --oneline -1 -- data/spanish/` shows the bot
  commit (**A2**). Record the SHA.

**If blocked**
If the run fails at `fly machine start` with a permissions error, the token
from Step 5 is too narrow — go back to Step 5's **If blocked**, do not widen
the token unilaterally.

---

### Step 8 — Prove a no-op run commits nothing (A3)

**Model:** haiku

**Status:** not started

**Depends on:** Step 7.

**Context**
Harden C6: this is the criterion separating "it ran" from "it ran correctly",
and it is **cheapest right now** because the repo copy is byte-identical to
Fly. Do not study any cards on production before this step. (The Step 12–15
drill studies a card on a *scratch* app, so it does not disturb this — but a
phone session would.)

**Do**
1. Confirm `data/spanish/` equals Fly (all 7 files `cmp`-equal).
2. Trigger a second `workflow_dispatch` run.
3. Confirm it completes green and creates **no** commit.

**Done when**
- Two run URLs recorded, both `success`.
- `git log --oneline -- data/spanish/cards.json | wc -l` is unchanged across
  the second run. Record before and after.

---

### Step 8b — Manufacture a real change, so A2 and Step 11 become reachable

**Model:** haiku

**Status:** not started

**Depends on:** Step 8 — and **must not run before it**. Step 8 needs the
repo to equal Fly; this step deliberately breaks that equality. Order is
load-bearing.

**Context**
Harden R2. Three things need mutually exclusive conditions, and before this
step only two of them were ordered:

| Needs | Step | Condition |
|---|---|---|
| A3 | 8 | repo **equals** Fly — a no-op run |
| A2 | 7 | a real bot commit — repo **differs** from Fly |
| Step 11 `Done when` | 11 | "the next backup commit to `main`" — differs |

Step 8 correctly forbids studying before it. But nothing afterwards ever
introduced a change: the Step 12–15 drill is on a *scratch* app by design, so
it cannot. Step 7's A2 evidence is written conditionally ("*if* state
changed"), so on the likely path it produces nothing and Step 11 then waits
for a backup commit that no step causes. This step exists purely to create
that change on **production**.

**Do**
1. Study **one** card on production — phone, or a single `POST /api/review`
   against `spanish-srs` with a scheduler-produced next state + revlog entry.
   One card is enough; this is not a volume test.
2. Record the card `id` and its before/after state, so the resulting bot
   commit can be tied to a known cause rather than an assumption.
3. Do **not** touch `data/spanish/` locally. The change must arrive through
   the workflow, or it proves nothing about the workflow.

**Done when**
- One card's before/after state recorded.
- Fly now differs from the repo — confirmed by observation, not assumed.

---

### Step 9 — Prove a failing pull fails the workflow (A4)

**Model:** haiku

**Status:** not started

**Depends on:** Step 6.

**Context**
Analyst A4: verified by *causing* it, not by reading the YAML. A backup job
that exits 0 on failure is the exact silent-loss shape non-negotiable #2
forbids.

**Do**
1. On a throwaway branch, point the workflow at a **nonexistent app name**
   and dispatch it with an explicit ref:
   `gh workflow run backup.yml --ref <throwaway-branch>`. `gh workflow run`
   defaults to the *default* branch, so without `--ref` this silently tests
   `main` instead (harden R8).
1a. **Do not use the "unset the secret" variant.** Round 1 offered it as an
   equal alternative; it is not (harden R8). Removing `FLY_API_TOKEN` breaks
   every scheduled run until it is restored, including one that may fire
   mid-step. The bogus app name is contained to this branch.
2. Confirm the run concludes `failure`, and that **no commit** was made.
3. Delete the throwaway branch.

**Done when**
- Failed run URL recorded with conclusion `failure`.
- `git log` shows no commit from that run.
- The throwaway branch is gone (`git branch -d`, never `-D` — per the
  worktree/branch rule in `CLAUDE.md`).

---

### Step 10 — Checkpoint

**Model:** haiku

**Status:** not started

**Depends on:** Steps 5–9.

**Context**
Harden R1: **A1 is not satisfied by anything before this step.** A1 demands
"at least one successful **non-manual** run — not just a `workflow_dispatch`
smoke test", and Steps 7, 8 and 9 all dispatch by hand. A dispatched run
proves the steps work while a human watches; the entire premise of this phase
is that no human is watching. This checkpoint is where A1 is actually earned.

**Do**
1. Re-confirm Steps 7, 8 and 9's recorded evidence still holds.
2. **Record the first genuine scheduled run** — the cron has been live since
   Step 6 and fires every 6 hours:
   ```sh
   gh run list --workflow=backup.yml --json event,conclusion,createdAt,url \
     --jq '[.[] | select(.event=="schedule")][0]'
   ```
   An empty result means **A1 is not yet met**: wait and re-run this — at
   most ~6 hours, once, for the criterion covering the only mode this system
   will ever run in. Do not substitute a dispatched run and do not mark A1
   met on a `workflow_dispatch` event.
3. Confirm that scheduled run's commit (if state changed after Step 8b) is
   the one A2 cites.
4. `npm run test`, `npm run build`,
   `pre-commit run --hook-stage pre-push --all-files`.
5. `git status` clean; `data/spanish/` clean or intentionally updated by the
   bot commit only.

**Done when**
- All green; the three run URLs (success-from-stopped, no-op, failure) are
  recorded in this file's Status lines.
- **A scheduled run with `event == "schedule"` and `conclusion == "success"`
  is recorded with its URL** (A1).

---

### Step 11 — Stop backup commits from re-triggering the full CI suite (C8)

**Model:** haiku

**Status:** not started

**Depends on:** Step 8b — which is what *causes* the real backup commit this
step confirms against (harden R2). Depending on Step 7 alone was wrong: on
the likely path Step 7 changes nothing, and this step's `Done when` would
wait forever for a commit no step produces.

**Files**
- MODIFY `.github/workflows/ci.yml` — anchor: `on:` → `push: branches: [main]`.
  **Step 3 already edited this file's `hooks` job** (harden R6), so it will
  not look the way round 1 read it. Touch `on:` only.

**Context**
Harden C8: `ci.yml` has no `paths-ignore`, so every nightly data-only commit
runs `tests`, `clean-table-gate`, `lint` and `hooks` — two `npm ci` installs
for a commit that changes only JSON. Harmless, wasteful. `paths-ignore` is
preferred over `[skip ci]` because it also covers any workflow added later.

⚠️ **This step's `Done when` is vacuous as written — found during Step 6
(2026-09-17), before this step runs.** `backup.yml` pushes with the default
`GITHUB_TOKEN` (`actions/checkout` persists those credentials). GitHub
deliberately does **not** start a workflow run from a push made with
`GITHUB_TOKEN` — that is its recursion guard, and it applies to every event
except `workflow_dispatch`/`repository_dispatch`. So *"the next backup commit
to `main` produces no CI run"* will be **true whether or not `paths-ignore`
works**, and would go green over an unmade change.

This is the same shape as Step 3's Case 9 and the reason **L-019** exists: an
absence assertion that the setup guarantees. Do not report A-criteria or this
step's `Done when` as met on that observation alone. Instead:

1. Keep the `paths-ignore` edit — it is still correct, and it is what covers a
   *human* pushing a data-only commit, which is the case that does trigger CI
   and the one C8 actually costs money on.
2. **Prove it against a push that would otherwise trigger CI**: make a
   data-only commit to `data/spanish/` as a normal user push (not the bot) and
   confirm `gh run list --workflow=ci.yml` shows nothing for that SHA. That is
   the real control.
3. Get the positive control from the same experiment's other half — a normal
   code push to `main` still triggering CI (already item 2 of `Done when`).
4. Record the `GITHUB_TOKEN` behaviour as a finding either way, because it
   means the *stated* motivation (nightly bot commits burning CI minutes) may
   already have been false. Measure before claiming a saving: check whether
   any pre-existing bot/data commit ever produced a CI run
   (`gh run list --workflow=ci.yml --json headSha,event` against
   `git log --format=%H -- data/spanish/`). If it never did, say so plainly —
   the change is then pre-emptive hygiene, not a fix.

**Do**
1. Add `paths-ignore: ['data/spanish/**']` to the `push` trigger **only**.
   Leave `pull_request` untouched — a PR that changes data should still be
   checked.
2. Comment why, naming the backup workflow.

**Done when**
- The next backup commit to `main` produces **no** CI run
  (`gh run list --workflow=ci.yml` shows nothing for that SHA).
- A normal code push to `main` still triggers CI — verify with the next real
  push, do not assume.

**If blocked**
If `paths-ignore` would also suppress CI for a legitimate change, reconsider;
do not weaken `pull_request`.

---

### Step 12 — Stand up the throwaway restore-drill app

**Model:** haiku

**Status:** ✅ **done** (2026-09-17). App `spanish-srs-restoredrill` is live
in `yyz`, deployed from the **same** `Dockerfile` and the same `fly.toml` as
production, over an initially empty volume.

| | |
|---|---|
| App | `spanish-srs-restoredrill` (org `personal`) |
| Machine | `850d6da0999598`, region `yyz`, state `started` |
| Volume | `vol_rkgm2lo7gdyngw64`, name `spanish_data`, 1GB, `yyz`, encrypted |
| Auth | throwaway `AUTH_USER=drill` + a generated random password, set as Fly secrets, **never** production's, never committed |

The volume had to be named **`spanish_data`**, not something drill-specific:
`fly.toml`'s `[[mounts]] source = "spanish_data"` is reused unchanged, so any
other name leaves the mount unbound. Worth knowing before the next drill.

Deployed with the escape hatch passed **transiently on the command line**:

```
fly deploy --app spanish-srs-restoredrill --config fly.toml \
  --env ALLOW_EMPTY_STORE=1 --ha=false --yes
```

`ALLOW_EMPTY_STORE=1` is required for this **first** boot only, because the
volume is empty (AD-026). It is passed via `--env` and never written into
`fly.toml` — committing it would permanently disarm the sentinel for
production too, since both apps share that file.

**Done when — all four green:**

```
$ fly status --app spanish-srs-restoredrill
 app │ 850d6da0999598 │ 1 │ yyz │ started │ │ 1 total, 1 passing │ 2026-09-17T15:41:40Z

$ curl -sS -i https://spanish-srs-restoredrill.fly.dev/api/health
HTTP/2 200
{"ok":true}

$ grep -rn 'ALLOW_EMPTY_STORE' fly.toml
(no output)
```

`git status --short` unchanged from the start of the step — this step
provisions infrastructure and edits no repo file at all.

Phase 1's `repoRoot` trap did **not** fire: the production Dockerfile was
reused unchanged, so `server/dist` and `web/dist/web/browser` kept their exact
relative paths. The symptom to watch for next time is `/api` working while
`/` 404s (`staticDir: null`); it did not appear.

**Depends on:** Step 1 — the drill is meaningless against the broken script.

**Context**
Analyst S4/D2. Full fidelity on the real `fly ssh sftp` path at production
data scale, zero risk to live state. Phase 1's trap applies: `config.ts` /
`paths.ts` compute `repoRoot` by walking two levels up from compiled JS, so
the runtime stage must preserve `server/dist` and `web/dist/web/browser` at
their exact relative paths — a flattening `COPY` yields `staticDir: null`, an
app that 404s while `/api` works.

**Do**
1. Create `spanish-srs-restoredrill` with its own 1GB volume in `yyz`.
2. Deploy the **same** Dockerfile. Set `AUTH_USER`/`AUTH_PASSWORD` to
   throwaway values as Fly secrets — never the production credentials, never
   committed.
3. It will need `ALLOW_EMPTY_STORE=1` for the first boot over an empty volume
   (AD-026). Pass it transiently via `fly deploy --env`, **never** in a
   `fly.toml` — committing it permanently disarms the sentinel.

**Done when**
- `fly status --app spanish-srs-restoredrill` shows a started machine.
- `GET /api/health` responds.
- `grep -rn 'ALLOW_EMPTY_STORE' fly.toml` returns **nothing**.

**If blocked**
If the drill app cannot be created (org limits, cost), STOP and report. Do
not fall back to pushing at production — Analyst O7 forbids it.

---

### Step 13 — Restore into the drill app and verify it matches (A5, A6)

**Model:** haiku

**Status:** ✅ **done — this is the step that converts Step 1's one-word fix
from plausible to proven** (2026-09-17). **A13 met, A6 met.**

**1. The repo/Fly equality claim was re-measured, not inherited.** Production
machine `850d53cd95d668` was started, `tools/pull-fly-state.sh` pulled its
seven live files into a scratch dir, and each was `cmp`-ed against
`data/spanish/`: **all seven byte-identical.** Production was then stopped
again. So harden C6's claim holds a day later, and Step 8's no-op precondition
is real rather than assumed.

**2. Reference numbers, recorded BEFORE the push** (A6 requires comparing
against a recorded value, not an impression):

| | Production | Drill app after restore |
|---|---|---|
| Decks | 2 | **2** |
| Notes | 3638 | **3638** |
| Cards | 7276 | **7276** |
| Cards by queue | learning 8, new 6631, review 624, schedBuried 12, suspended 1 | **identical** |
| Cards by type | new 6631, relearning 9, review 636 | **identical** |
| Revlog lines | 3915 | 3915 |

Both breakdowns sum to 7276, which is the internal consistency check on the
numbers themselves.

**3. The push worked.**
`bash tools/push-fly-state.sh --app spanish-srs-restoredrill --yes data/spanish`
→ `Successfully pushed 7 state files to Fly app 'spanish-srs-restoredrill'`.
**This is the first time this script has ever completed** — before Step 1 it
aborted at line 173 before uploading a byte, and the dry-run path returned
from `print_plan()` before reaching that line, which is why every dry run had
passed. A13 is met here.

**4. The sentinel saw a populated store (AD-026).** The drill app was
redeployed **without** `--env ALLOW_EMPTY_STORE=1`, and
`fly ssh console -C "printenv ALLOW_EMPTY_STORE"` exited 1 (not set). It
booted clean and `/api/health` returned `{"ok":true}`. So the app did not
merely tolerate the restored volume — the empty-store guard positively
confirmed the volume was populated.

**5. Full round-trip byte check** — the strongest evidence available, and
beyond what the step asked for. `pull-fly-state.sh` was run against the
**drill** app and all seven files `cmp`-ed against `data/spanish/`:
`collection.json`, `notetypes.json`, `decks.json`, `deckoptions.json`,
`notes.json`, `cards.json`, `revlog.ndjson` — **all identical**. So
production → repo → push → drill volume → pull → repo is byte-clean end to
end, not just "the app started".

**Deviation from the step text, stated plainly.** The step says to compare
*per-deck due counts* from production's `/api/collection`. That was not done,
and could not be: production's basic-auth credentials are Fly secrets and are
not readable from here, and per-deck due counts are **not** a server endpoint
at all — `CollectionStore` computes them client-side from `todayNumber`.
Recomputing them here would have meant reimplementing scheduling logic in a
throwaway script, which O5 forbids and which would have proved only that two
implementations agree. The substitute is strictly stronger for A6's purpose:
byte-identity of `cards.json` means the due state *is* the same by
construction, and the app-served deck/note/card/queue/type counts prove the
drill app actually parsed and loaded it rather than just holding the bytes.

**Depends on:** Step 12; Step 1.

**Context**
This is the step that converts Step 1's one-word fix from plausible to
proven. Record the production numbers **before** pushing, so A6 compares
against a recorded value rather than an impression.

**Do**
1. Record production's deck list and per-deck due counts via `/api/collection`.
2. `bash tools/push-fly-state.sh --app spanish-srs-restoredrill --yes data/spanish`
   — capture the full output.
3. Restart the drill app so `FileStore.init()` reloads from the volume.
4. Fetch the drill app's `/api/collection` and compare.

**Done when**
- The push completes and prints `Successfully pushed 7 state files`.
- Drill-app deck count, card count and per-deck due counts **equal** the
  recorded production numbers. Record both sets of numbers, not a verdict.
- The drill app boots **without** `ALLOW_EMPTY_STORE`, proving the sentinel
  sees a populated store (AD-026).

---

### Step 14 — Study one card against the restored app (A5)

**Model:** haiku

**Status:** ✅ **done — the restore is writable, not just readable**
(2026-09-17). One caveat below that does not affect the criterion but must
not be glossed.

Card `c72320e9fab300fac-0`, `type: review` / `queue: review`:

| | Before | After | |
|---|---|---|---|
| `reps` | 5 | **6** | +1 ✅ |
| `due` | 92 | 242 | advanced ✅ (but see caveat) |
| `interval` | 51 | 150 | 51 × 2.95 ≈ 150 ✅ |
| `ease` | 2950 | 2950 | unchanged on "good" ✅ |
| `stability` / `difficulty` | null / null | null / null | SM-2 card, never FSRS-scheduled ✅ |

`POST /api/review` returned 200; a re-fetch confirmed every change persisted
to the volume rather than only to the response. Drill `revlog.ndjson` went
**3915 → 3916 lines, exactly +1**. The card does not return to the queue
immediately.

That settles what A5 actually asks: *a collection that loads is not the same
as one that can be written to*, and this one can be. The whole chain — push,
boot, serve, write, persist — is now proven on a real Fly app at production
data scale.

**⚠️ Caveat: the hand-built payload's day arithmetic was wrong, and it is the
exact bug class this repo keeps getting bitten by.** The subagent constructed
the next state by hand and set `due = 92 + 150 = 242` — the card's **old due**
plus the new interval. SM-2 semantics are `due = todayNumber + newInterval`.
**`todayNumber` is 85 today** (created `1782310835661` = 2026-06-24 10:20
America/Toronto; study day of created → today = 85 days; independently
corroborated by `lastUnburyDay: 85` sitting in `collection.json`), so the
correct value was **235**. Off by 7 — precisely because 92 was 7 days in the
future. Relatedly, that card was **not due at all** (92 > 85); a card due
today was never picked.

Why this is recorded and **not fixed**:

- It changes nothing about A5. Step 14 tests that the restored app accepts a
  write and persists it, and every one of those assertions holds regardless
  of which integer was written.
- It never touched production. Production was started, pulled from, and
  stopped; the only writer was `spanish-srs-restoredrill`, destroyed in Step
  15. The wrong value does not survive this spec.
- Fixing it would mean going at scheduling code, which **O5 forbids** and
  which `CLAUDE.md` classes as at least Large.

What it *is* is evidence, and it belongs in Step 19's lesson candidates: a
wrong day number is **silent** — the response was 200, the re-fetch matched,
the revlog grew by one, and every Done-when item went green over a value that
was wrong by a week. That is the same failure shape as
`archive/2026-07-14-007-heatmap-date-off-by-one` and
`archive/2026-09-02-010-day-rollover-anchoring`, and it is why `CLAUDE.md`
sizes anything touching `card.due` as at least Large. It also says something
about delegation: a subagent handed a scheduling-adjacent payload to build
will produce something that *looks* right and passes every assertion it was
given, because nothing in the assertion set reads `todayNumber`. The
`scheduling-domain` skill was in its reading list and that was not enough —
the check would have had to be an explicit Done-when item.

**Depends on:** Step 13.

**Context**
The roadmap's standard: "Restore into a scratch DATA_DIR and study one card
against it." An untested backup is a guess, and a collection that *loads* is
not the same as one that can be *written to*. Do this over the API so it is
scriptable and the before/after state is exact.

**Do**
1. Pick one card; record its `id`, `type`, `queue`, `due`, `reps`, `interval`.
2. `POST /api/review` against the drill app with a scheduler-produced next
   state + revlog entry.
3. Re-fetch and confirm the card advanced, and that `revlog.ndjson` grew by
   exactly one line.

**Done when**
- Before/after card state recorded, showing `reps` +1 and `due` advanced.
- Drill app `revlog.ndjson` line count is exactly one greater.
- The card does **not** return to the study queue immediately.

**If blocked**
If the write fails, that is a finding, not a nuisance — record it and STOP.
A restore that is read-only is not a restore.

---

### Step 15 — Tear down the drill app

**Model:** haiku

**Status:** ✅ **done** (2026-09-17). `fly apps destroy
spanish-srs-restoredrill --yes` → `Destroyed app spanish-srs-restoredrill`.

**Done when — all four green:**

```
$ fly apps list
 NAME        │ OWNER    │ STATUS    │ LATEST DEPLOY
 spanish-srs │ personal │ suspended │ 4h18m ago
```

The drill app is gone and the listing is non-empty — so the absence is a real
absence, not an empty command output (**L-019** again). `suspended` here is
just scale-to-zero with the machine stopped, not a problem.

```
$ fly volumes list --app spanish-srs
 vol_vjyq28pjgdn335xv │ created │ spanish_data │ 1GB │ yyz │ 1963 │ true │ 850d53cd95d668 │ 20 hours ago

$ fly volumes list --app spanish-srs-restoredrill
Error: app not found
```

Exactly one production volume, and the drill's `vol_rkgm2lo7gdyngw64` is gone
with its app.

Production `/api/health` → `HTTP/2 200` `{"ok":true}`.

Production counts re-measured against Step 13's recorded numbers by pulling
into a scratch dir and counting with `jq` — **7276 cards / 3638 notes / 2
decks**, unchanged. (The authenticated API was not used; production's
credentials are Fly secrets and are not readable from here.)

**Machine put back to sleep.** The health check auto-started production, so it
was explicitly stopped again: `fly machine list --app spanish-srs` →
`850d53cd95d668 │ young-dream-3731 │ stopped`. Worth noting as the same
behaviour A11 asks the backup workflow to guarantee — any HTTP request wakes
this machine, so anything that touches it owes it a stop.

`git status --short data/spanish/` empty. No repo file was edited at any point
in Steps 12–15.

**Depends on:** Step 14.

**Do**
1. `fly apps destroy spanish-srs-restoredrill`.
2. Confirm its volume is gone.
3. Confirm production is untouched.

**Done when**
- `fly apps list` does not list the drill app.
- `fly volumes list --app spanish-srs` still shows exactly
  `vol_vjyq28pjgdn335xv`.
- Production `/api/health` still responds and its card count is unchanged
  from Step 13's recorded number.

---

### Step 16 — Measure and record the snapshot layer (A8)

**Model:** haiku

**Status:** ✅ **done** (2026-09-17). Measured, not assumed. **Zero snapshots
exist** — the configuration is on but has produced nothing yet. A8 is
satisfied by that measurement, not by the config.

```
$ fly volumes show vol_vjyq28pjgdn335xv --app spanish-srs
ID: vol_vjyq28pjgdn335xv
                Name: spanish_data
                 App: spanish-srs
              Region: yyz
                Zone: 1963
             Size GB: 1
           Encrypted: true
          Created at: 16 Sep 26 19:42 UTC
  Snapshot retention: 5
 Scheduled snapshots: true

$ fly volumes snapshots list vol_vjyq28pjgdn335xv --app spanish-srs
No snapshots available for volume vol_vjyq28pjgdn335xv
```

Volume age at measurement ≈ **19 hours** (created 2026-09-16 19:42 UTC), so
the scheduled snapshot job has not yet fired once. This is the same reading
harden round 2 took, one day later — so "none yet" is now a *second*
observation, not a first impression. D3 stands: the roadmap's "snapshots
remain unconfigured" is **wrong on configuration and right on outcome**.

Machine state recorded at the same time (Step 6 must resolve this
dynamically, not hardcode it): id `850d53cd95d668`, name `young-dream-3731`,
region `yyz`, volume `vol_vjyq28pjgdn335xv`, **state `stopped`**, created
2026-09-16T19:47:26Z, last updated 2026-09-17T14:11:40Z.

**What the snapshot layer covers, and does not:** it is a *fast rollback*
layer — point-in-time recovery reaching back at most **5 days**, cheap and
quick — and nothing more. It lives **exclusively on Fly**, so it does **not**
satisfy the roadmap's non-negotiable "at least one copy off Fly": it does not
survive losing the Fly account, a billing termination, or an org-wide
mistake, and today it does not survive anything at all, because no snapshot
exists. Deep rollback is git history's job, not this layer's.

**Context**
Harden C9. A8 must not be satisfiable by pasting config — that is the same
mistake Step 1 punishes. At harden time: `Scheduled snapshots: true`,
`Snapshot retention: 5`, and **zero snapshots existed** (volume was 18h old).

**Do**
1. `fly volumes show vol_vjyq28pjgdn335xv` and
   `fly volumes snapshots list vol_vjyq28pjgdn335xv`.
2. Record whether at least one snapshot now **exists**, with its timestamp.
3. If still none, record that plainly — do not report the config as an
   outcome.
4. Write down what snapshots do *not* cover: they live on Fly, so they do not
   satisfy "a copy off Fly", and they do not survive losing the account.

**Done when**
- Both command outputs recorded verbatim in this file.
- A one-line statement of what the snapshot layer covers and does not.

---

### Step 16b — Decide the `STATE.md` rotation before writing to it  ⚠️ USER

**Model:** top-level

**Status:** ⏸️ **decided, awaiting the user's `--apply`.** Asked 2026-09-17;
the user chose **rotate now**. Nothing is written to `specs/STATE.md` until it
lands, which is exactly what this step exists to enforce.

The arithmetic presented:

```
$ python3 tools/state_rotate.py --check
state_rotate: specs/STATE.md is 291 lines, budget 300 — ok
```

291 now; Step 17's `AD` ≈ 14 lines (the `AD-025`→`AD-026` span measures 15) and
Step 19's up-to-3 `L-NNN` headlines ≈ 9 → **≈ 314**, about 14 over. Gate 4 of
`scripts/clean-table-check.sh` does not warn at that point, it prints *"is over
its size budget. Rotate it, then push again"* and exits 1 — and Step 19's
`--check` would only surface it at the very end, after everything is written.

**The user runs it**, not this session: `CLAUDE.md` is explicit that
`state_rotate.py --apply` "is run by a human who has decided to rotate", and
choosing which decisions are still live is a judgement call rather than a
push-time side effect.

```
python3 tools/state_rotate.py --apply
```

To confirm afterwards: aged `AD`/`B` entries moved to `specs/STATE-ARCHIVE.md`
leaving one-line stubs; **no `L-NNN` headline moved** (lesson headlines never
move — gate 3 fails the push if one does); `--check` passes with **≥ ~17 lines
of headroom**; and `bash scripts/clean-table-check.sh` still reports lessons in
sync.

**Depends on:** Step 16. **Must run before Step 17**, which is the first step
that writes to `specs/STATE.md`.

**Context**
Harden R3 — **this spec will otherwise be refused by its own push gate.**
Measured at round 2: `specs/STATE.md` is **291 lines against a 300 budget**.
Step 17 writes an `AD` (the `AD-025`→`AD-026` span is **15 lines**, so budget
~14) and Step 19 adds up to **3** `L-NNN` headlines. That lands near **308**.

Gate 4 of `scripts/clean-table-check.sh` does not warn — it prints
"`specs/STATE.md` is over its size budget. Rotate it, then push again." and
exits 1. Step 19's `--check` would surface this at the very end, after
everything is written.

It cannot simply be automated here: `CLAUDE.md` is explicit that
`state_rotate.py --apply` "is run by a human who has decided to rotate", and
choosing which decisions are still live is a judgement call, not a push-time
side effect. Hence a named decision point, and hence ⚠️ USER.

**Do**
1. `python3 tools/state_rotate.py --check` for the current count.
2. Present the arithmetic above to the user and ask whether to rotate now.
3. If yes, the **user** runs `python3 tools/state_rotate.py --apply`; confirm
   aged `AD`/`B` entries moved to `specs/STATE-ARCHIVE.md` leaving one-line
   stubs, and that **no `L-NNN` headline moved** — lesson headlines never
   move (`CLAUDE.md`), and gate 3 fails the push if one does.
4. If no, Step 17 and Step 19 must fit inside the remaining allowance — say
   so explicitly and keep the new `AD` terse.

**Done when**
- `python3 tools/state_rotate.py --check` passes, **with at least ~17 lines
  of headroom** for Steps 17 and 19.
- `bash scripts/clean-table-check.sh` still reports lessons in sync.

---

### Step 17 — Decide and write down the retention policy (A7, Q4)

**Model:** top-level

**Status:** not started

**Depends on:** Steps 7, 8, 16 — the policy must describe what was built.

**Context**
The roadmap requires this in writing before Phase 2 can be marked done,
because "an unstated answer means the next person (or agent) re-derives it
mid-incident". Q4 (cron frequency) and the retention window are the **same
question**: the cron interval *is* the worst-case data-loss window.

**Do**
1. Cadence is already decided — **every 6 hours** (Analyst D5). State it as
   the loss window: *a total Fly loss costs at most ~6 hours of reviews*,
   which against measured volume (30 active days in 73; median 118 reviews
   per active day, max 263) is a fraction of one session.
2. Write an `AD-NNN` in `specs/STATE.md` answering: how far back a bad state
   can be rolled; what the worst-case loss is; which layer answers which
   failure (git history = deep rollback, unbounded; Fly snapshots = fast
   rollback, ≤5 days, **on-Fly only**; the volume = live, not a backup).
3. Record the two accepted silent-failure modes (Analyst D6) and how each
   becomes visible: GitHub's auto-disable email after 60 days of repository
   inactivity, and token expiry.
4. Mirror the window into `ROADMAP.md` Phase 2.

**Done when**
- The `AD` exists in `specs/STATE.md`, dated, with reasoning not just a
  number.
- `ROADMAP.md` Phase 2 states the same window.
- Step 6's cron comment matches it.

---

### Step 18 — Record the deferred work in `specs/BACKLOG.md` (A9)

**Model:** top-level

**Status:** ✅ **done** (2026-09-17). Both entries appended to
`specs/BACKLOG.md` (append-only, newest at the bottom, per that file's own
rule 1) — **not** a Quick Tasks row in `STATE.md`, per **L-024**.

- **O1** — the `revlog.ndjson` → `cards.json` repair tool. Records *why* it
  is not cheap (replaying SM-2/FSRS over the whole history is a
  scheduling-domain change, therefore at least Large), and three wrinkles a
  future spec must answer that were not obvious from the roadmap bullet:
  FSRS `stability`/`difficulty` are null until FSRS first schedules a card so
  a replay must know which scheduler each deck used *at the time*; the revlog
  does not record deck-options changes; and cards created after the last
  review have no revlog rows, so a pure replay cannot reconstruct the "new"
  queue positions.
- **O2** — `/api/review` leaving the revlog ahead of `cards.json` on a *hard*
  kill. Records that the **signalled** path is fine (`flushAll()` on
  SIGINT/SIGTERM, verified in Phase 1 Step 20), that auto-stop made the
  ~400ms `saveCardsSoon()` window reachable for the first time, and that the
  bug splits into two separable halves — *detecting* the divergence (which
  could stand alone) and *repairing* it (which collapses into O1).

`ROADMAP.md` cross-references both, so the roadmap does not read as though it
silently dropped them: the Phase 2 "repair tool" bullet now carries a
⏭️ DEFERRED sub-bullet pointing at the backlog entry, and the Discovered-list
entry for the `/api/review` divergence carries the same pointer. Each names
the spec's O-number so the trail runs both ways.

**Context**
**L-024**: "add it to the backlog" means `specs/BACKLOG.md`, never a Quick
Tasks row in `STATE.md`.

**Do**
1. Add **O1** — the revlog → `cards.json` repair tool; note it is a
   scheduling-domain change and therefore at least Large on its own.
2. Add **O2** — `/api/review` leaves the revlog ahead of `cards.json` on a
   *hard* kill (`routes/index.ts` calls `saveCardsSoon()` debounced ~400ms
   but awaits `appendRevlog()` immediately). Note the signalled path is fine
   (`flushAll()` on SIGINT/SIGTERM, verified in Phase 1 Step 20) and that
   auto-stop made the hard-kill window reachable for the first time.
3. Cross-reference both from `ROADMAP.md`'s Phase 2 bullets so the roadmap
   does not look like it silently dropped them.

**Done when**
- Both entries exist in `specs/BACKLOG.md` with enough context to act on
  without re-reading this spec.
- `ROADMAP.md` points at them.

---

### Step 19 — Regression and wrap-up

**Model:** top-level

**Status:** not started

**Depends on:** all previous steps.

**Do**
1. Walk **every** acceptance criterion A1–A13 in `Analyst.md` and record the
   evidence each one names. Anything not verified is written down as not
   verified — Phase 1's honesty about the un-performed 200-card session is
   the standard here. Walk it as a **matrix against the steps**, not step by
   step: harden round 2 found A1 and A2 unreachable precisely because every
   step was individually checkable while no step owned the *condition* the
   criterion needed. For A1 specifically, the evidence is Step 10's
   `event == "schedule"` run — **a `workflow_dispatch` run does not satisfy
   it.**
2. Tick `ROADMAP.md` Phase 2 checkboxes, and **correct its two wrong
   statements**: that snapshots were "unconfigured" (they were on, harden
   D3/C9) and that `push-fly-state.sh` was "exercised on a scratch
   round-trip" (harden C1 shows it could not have been).
3. Confirm the `AD`/`L` entries exist in `specs/STATE.md`, each `L` with its
   body in `specs/LESSONS.md`. Candidates from harden round 1:
   - a dry-run mode that takes a different code path validates the path
     nobody runs;
   - "exercised in Step N" is a claim, `git log` is evidence;
   - a wake-on-demand machine is only awake for the protocol that wakes it.
4. Fill in the Retrospective in `Analyst.md`.
5. **Reconcile `specs/BACKUP-RUNBOOK.md` against what was actually built.**
   It was written ahead of the implementation and carries a "not yet live"
   status banner plus several **UNVERIFIED** markers. Remove the banner,
   resolve every `UNVERIFIED` to what Step 7 observed (especially: which
   token type was needed, and whether the workflow can self-check expiry),
   and delete the note saying the restore path is broken once Step 13 proves
   it. A runbook that still says "not yet live" after going live is the same
   decayed-pointer failure as **L-009**.
5a. **Correct the runbook's expiry-query command to whichever scope actually
   listed the token** (Step 5, harden R7). The runbook currently documents
   `fly tokens list --app spanish-srs`. If the token was only visible at
   `--scope org`, that documented command returns nothing and the operator
   has no path to the expiry date — which would quietly invalidate D7's
   whole "query, never copy" argument.
6. `npm run test`, `npm run build`,
   `pre-commit run --hook-stage pre-push --all-files`, `git status` clean.
7. Run `python3 tools/state_rotate.py --check` — `specs/STATE.md` is near its
   ~300-line budget and this spec adds to it.

**Done when**
- All of the above green and recorded.
- **Do not commit — ask the user first.**
