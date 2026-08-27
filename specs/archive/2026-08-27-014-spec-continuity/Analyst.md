# Analyst — spec continuity across context loss

Size: **Medium** (four docs, one clear pattern reused across all of them,
under 10 steps — CLAUDE.md sizing rule → `Analyst.md` + `tasks.md` + 1 harden
round).

## 1. What problem are we solving?

Two related gaps surfaced while resuming `specs/013-server-hardening/`
(fully planned — `Analyst.md` + `CriticReview.md` + a 15-step `tasks.md` —
but not started):

**Gap 1 — no cheap way to tell what a `tasks.md` run has actually done.**
`tasks.md` steps each carry a `**Done when**`, but nothing records *whether*
a step's Done-when has been satisfied. Resuming after the session that was
executing a spec runs out of budget (or is interrupted, or picks the task
back up days later) means re-deriving progress from scratch — grepping the
codebase for files/symbols each step was supposed to create, one step at a
time. Confirmed directly: reconstructing where 013 stood took ~10 tool calls
(grep step headings, check `server/src/` for files that shouldn't exist yet,
check `server/package.json` for new deps, `git status`) before any real work
could resume.

**Gap 2 — durable memory (`AD`/`L`/`B` entries) is written only at
archive time, so an unfinished spec's reasoning is stranded.**
`specs/STATE.md` Rule 5 already says entries are written *"when the thing
happens, not reconstructed later"* — but the **Archive ritual** (same file,
§"Archive ritual") and `CLAUDE.md`'s "End-of-feature ritual" both describe
writing `AD`/`L`/`B` entries as step 2 of the *finishing* sequence. The two
rules contradict each other, and the archive-time version is the one
actually followed. Concretely: `specs/013-server-hardening/CriticReview.md`
already contains real, verified decisions (R2's `inlineCritical: false` fix,
confirmed by an actual rebuild; D2's fail-safe-default reasoning) that do not
exist anywhere in `specs/STATE.md`, because 013 has not been archived. If 013
were abandoned today, that reasoning would be invisible to any future session
that didn't happen to open this exact folder.

**A third, smaller finding surfaced during the same conversation:**
the root **`STATE.md`**'s "Current work" section currently reads:

> `specs/010-day-rollover-anchoring/` — the only live spec... awaiting
> `tasks.md`.

010 is not the spec that was actually live (013 is, and isn't mentioned).
This is Gap 1 and Gap 2's failure mode already having happened to the one
piece of prose meant to prevent it — proof this is not hypothetical. (Note,
caught by this spec's own critic pass: this pointer lives in the **root**
`STATE.md` — the run-marker file, per AD-008 — not `specs/STATE.md`, which
is the durable-memory file. Easy to conflate; the root file even links to
the other one in its first line.)

**Update mid-spec (2026-08-27):** `specs/013-server-hardening` finished
while this spec was being written — a separate session completed all 15
steps, confirmed by that session's own status report (see tasks.md Step 6).
It had already removed the root `STATE.md`'s `## Executing:` marker but
deliberately left the stale "Current work" pointer for this spec to fix,
which is exactly Gap 1/3's scenario playing out in real time rather than as
a hypothetical.

## 2. What is in scope?

### 2.1 A `**Status:**` field on every `tasks.md` step (closes Gap 1)

Added to the step format in `specs/TEMPLATE.md`, directly under `**Model:**`,
mandatory like that field:

```
**Status:** not started | in progress | done (<date>, <evidence>)
```

`<evidence>` is a one-line pointer proving the claim without re-deriving it —
a commit SHA, or the exact file/grep result the step's own `Done when`
names. A resuming session trusts the marker to find *where* to resume, then
re-runs only that one step's `Done when` before continuing — not all
prior steps. This mirrors the existing checkpoint pattern (re-verify, don't
just trust) at the single-step grain instead of the every-4-steps grain.

Explicitly a per-step line in `tasks.md` itself, not a separate ledger:
`tasks.md` is already the authoritative list of steps and their Done-when
criteria, so the status of a step lives next to the criterion it's the
status *of*. A second file tracking the same thing is a second place for the
two to disagree.

### 2.2 Promote durable findings as they happen, not at archive time (closes Gap 2)

- `specs/STATE.md`'s **Archive ritual** step 2 changes from "add the `AD`/`L`
  entries" to "**confirm** the `AD`/`L`/`B` entries this spec produced are
  already recorded — they should have been written when each was decided or
  discovered, per Rule 5. Add anything that was missed." The ritual becomes a
  safety net, not the only path in.
- `CLAUDE.md`'s "End-of-feature ritual" bullet (which restates the same
  sequence) is reworded to match, so the two documents stop disagreeing.
- A short addition near Rule 5 in `specs/STATE.md` makes the trigger
  concrete: a `CriticReview.md` finding that resolves into a real decision,
  or an `Analyst.md` "Discovered" note that rises above a scope-parked
  observation, gets its `AD`/`L`/`B` entry written into `STATE.md` in the
  same session that produced it — not deferred.
- This does not change *what* qualifies as durable (still: architectural
  decisions, long blockers, "we learned that…" moments — not every scope note
  or every "noted, not touched" observation; those stay where they are,
  spec-local).

### 2.3 Fix the stale "Current work" pointer (backstop, per the user's
combined-approach decision: "as-you-go promotion" as the real fix, pointer
hygiene as a cheap backstop)

Root **`STATE.md`**'s "Current work" section is corrected to name
`013-server-hardening` and its actual state — as of the mid-spec update
above, **finished** (all 15 steps done), so the correction also names
whatever spec is next in line. Going forward this section names `<spec> —
step N of M` while a run is in progress, so it stays informative at a
glance instead of requiring a fresh session to open `tasks.md` to find out.

### 2.4 Retrofit `specs/013-server-hardening/tasks.md`

Every one of its 15 steps gets `**Status:** not started` added under its
`**Model:**` line — establishing the honest baseline (nothing is done) rather
than leaving the new convention undemonstrated on the one spec that
prompted it.

## 3. What is OUT of scope?

- **Any hook or CI gate enforcing the `Status:` field is present** (the way
  `steps=$(grep -c '^### Step ' tasks.md); ...` enforces `Model:` today).
  Worth doing later, but it's new automation surface a Medium doc-only task
  shouldn't take on; noted as a Discovered item instead.
- **Actually starting or executing `specs/013-server-hardening`'s
  `tasks.md`.** This spec only changes the process documents and retrofits
  013's step markers to `not started`; it does not touch any server code.
- **A machine-readable index of all specs' status** (e.g. a generated table
  across every `specs/*/tasks.md`). "Current work" stays hand-maintained
  prose, same as today — just corrected and given a convention to follow.
- **Changing what counts as Small/Medium/Large/Complex**, or any other part
  of the sizing rule. Untouched.
- **Retrofitting `Status:` into any other archived or historical spec.**
  Only 013 (the live one) is retrofitted.

## 4. How do we know it is done?

**A1 —** `specs/TEMPLATE.md`'s step format block shows `**Status:**` directly
under `**Model:**`, with the three-state convention and the "resume by
re-verifying only the boundary step" rule spelled out in prose nearby.

**A2 —** `specs/STATE.md`'s Archive ritual step 2 and `CLAUDE.md`'s
end-of-feature ritual bullet both read "confirm ... already recorded", not
"add". A `grep` for the old "Add the \`AD\` / \`L\`" wording in
`specs/STATE.md` returns nothing.

**A3 —** Root `STATE.md`'s "Current work" section names
`013-server-hardening` (finished) instead of `010-day-rollover-anchoring`.

**A4 —** `grep -c '^### Step ' specs/013-server-hardening/tasks.md` and
`grep -c '^\*\*Status:\*\*' specs/013-server-hardening/tasks.md` return the
same non-zero number (15). **Verified by delegation, not directly**: that
file is untracked in the shared checkout and doesn't exist in this
worktree (Discovered) — the owning session ran this exact check on its side
and reported 15/15/15 (`### Step`/`**Status:**`/`**Model:**`, each `Status:`
line within 2 lines of a `Model:` line) via `SendMessage`. This worktree's
acceptance criterion rests on that report, the same trust-then-spot-check
discipline the `Status:` convention itself prescribes for resuming a run.

**A5 —** `python3 tools/state_rotate.py --check` still passes after the
`specs/STATE.md` edits (the ~300-line budget is not blown by this task).

**A6 —** `git status` is clean of anything outside the four files this spec
touches: `specs/TEMPLATE.md`, `specs/STATE.md`, `CLAUDE.md`,
`specs/013-server-hardening/tasks.md`, plus this spec's own three docs.

## Discovered

- (2026-08-27) `specs/013-server-hardening`'s implementing session already
  added `AD-011`–`AD-015` and `L-007`/`L-008` to `specs/STATE.md` (and
  `specs/LESSONS.md`) in the **shared checkout**, uncommitted, on a different
  branch than this worktree. This spec's own wrap-up step also needs new
  `AD`/`L` numbers, and this worktree's `specs/STATE.md` doesn't see the
  other branch's uncommitted additions — a real collision at merge time
  between two branches concurrently appending to the same numbered log.
  **Resolved by agreement with that session** (2026-08-27, via
  `SendMessage`): 013 keeps `AD-011`–`AD-015`/`L-007`/`L-008` (finished
  first, already written and internally cross-referenced); this spec uses
  `AD-016`+/`L-009`+. Still the user's call to overrule if either branch's
  numbers need to move before merging — noted as agreed-not-final.
- (2026-08-27) The peer session initially reported that
  `enforce-haiku-tasks-pretooluse.sh` "blocks ALL top-level writes while the
  `## Executing:` marker is present — including spec-doc writes." First pass:
  disputed — for a direct `Write`/`Edit`/`NotebookEdit` call, `target ==
  *.md` exits 0 unconditionally before the protected-path check runs, so a
  `.md` write is exempt regardless of the marker. That part holds. But the
  peer supplied exact evidence on follow-up: both blocks it hit were **Bash
  heredocs** (`cat > ... <<'STEPEOF'`, `python3 - <<'PY'`), and the hook's
  Bash branch matches `protected_re` against the **command text**, never a
  resolved target path — a heredoc body merely *mentioning* a
  protected-looking path (e.g. citing `server/src/app.ts` inside an `AD`
  entry's prose) trips the same deny as an actual code edit. One heredoc
  target wasn't even inside the repo and was still denied, purely on body
  text. **Corrected:** direct `Write`/`Edit` to `.md` is exempt regardless of
  the marker; a Bash heredoc writing the same `.md` file is not, if its body
  happens to contain a protected-looking substring. Not incorporated into
  `specs/TEMPLATE.md`'s `Status:` convention — real hook nuance, not
  something the convention needs to route around; the corresponding lesson
  belongs in 013's own retrospective (that session hit it and is recording
  it there), not duplicated here.
- (2026-08-27) `specs/013-server-hardening/` turned out to be **untracked**
  in the shared checkout (visible in this session's very first `git status`,
  before any worktree existed) — so this worktree, a separate git checkout,
  never had it and doesn't now, despite an earlier `ls` in this same
  conversation showing it present (that `ls` ran *before* `EnterWorktree`
  was called, against the main checkout, not this worktree — easy to
  conflate the two). Copying the peer's live uncommitted file into this
  worktree risked a duplicate/conflicting copy of the whole spec folder
  across two branches at merge time, so the retrofit (tasks.md Step 6) was
  handed to the owning session to apply directly instead of attempted here.
- (2026-08-27) No hook enforces the new `Status:` field the way
  `steps=$(grep -c '^### Step ' tasks.md); [ "$steps" -gt 0 ] &&
  [ "$(grep -c '^\*\*Model:\*\*' tasks.md)" = "$steps" ]` enforces `Model:`.
  A follow-up Small task could add the analogous check to
  `scripts/clean-table-check.sh` or a template-lint step. Not done here —
  out of scope, §3.

## Retrospective

**Did Analyst.md catch anything not thought about up front?** Two big things,
neither foreseeable at planning time:

1. **`specs/013-server-hardening` went from "not started" to "fully
   implemented" while this spec was being written.** The Analyst was
   drafted around a static snapshot (013 planned, untouched); by the time
   `tasks.md` reached execution, a separate session had built and finished
   it. This validated Gap 1/Gap 2 harder than the original incident did —
   and forced real inter-session coordination (`SendMessage`, `ListAgents`)
   that the original plan didn't anticipate at all. Handled by pausing,
   asking the user how to treat it (`AskUserQuestion`), then messaging the
   implementing session directly for ground truth instead of inferring
   status from file existence — which the whole spec argues against doing
   anyway.
2. **`specs/013-server-hardening/` was untracked in the shared checkout**,
   so this worktree — a separate git checkout — never had it and couldn't
   edit it, full stop. This wasn't visible until Step 5/6 actually tried to
   touch the file. The fix (hand the owning session the exact patch to
   apply itself) was cheaper than the alternatives (copy its live file
   into this worktree, risking a duplicate spec folder across two branches
   at merge; or leave this worktree to edit the shared checkout directly,
   which the session's own isolation contract rules out).

Smaller catches, all from the critic pass proper (see `CriticReview.md`):
the "Current work" section lives in root `STATE.md`, not `specs/STATE.md`
(an easy conflation the root file's own first line invites); a transcribed
`AD`/`L` should have read `AD`/`B` in one `Do` block; and a peer's claim
about the delegation hook was half right and half wrong in a way that only
surfaced by asking for exact evidence rather than accepting or rejecting it
outright — the hook's Bash branch matches command *text*, not a resolved
path, so a heredoc can trip a `.md`-writing block that a direct `Edit` call
never would.

**Did anything in tasks.md turn out to be wrong during coding? What?**
Step 6 was written speculatively ("retrofit `Status:` lines into
`specs/013-server-hardening/tasks.md`") before the untracked-directory
problem was known, and had to be rewritten mid-execution from a direct file
edit into a delegated request. Steps 5 and 7 were also written with
placeholder/pending content (gated on a reply that hadn't arrived yet) and
filled in once real data came back — which is exactly what `tasks.md`'s
own "one verifiable outcome per step" and "If blocked" conventions are for,
so the process held even though the plan's first draft didn't anticipate
the concurrency. The `AD-011`/`L-007` numbering assumption in Step 7's
first draft was also wrong the moment the peer session's report came in
(it had already claimed those numbers on a different branch) and was
corrected to `AD-016`/`L-009` by direct agreement before any file was
touched — not discovered after the fact.
