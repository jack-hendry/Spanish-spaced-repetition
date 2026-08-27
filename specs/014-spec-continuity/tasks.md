# tasks — 014 spec continuity

7 steps, in order, do not skip ahead. Every step is `Model: top-level`: all
of them either write to a protected spec doc (`tasks.md` in any spec
directory, blocked from subagent writes by
`protect-spec-docs-from-subagents.sh`) or make a small, precise wording
change to a process document (`specs/TEMPLATE.md`, `specs/STATE.md`,
`CLAUDE.md`) where delegating a handful of exact-text edits to a subagent
would cost more in round-trips than it saves.

**Live coordination note (2026-08-27, resolved):** `specs/013-server-hardening`
was being actively implemented by a separate session ("Specs/013 server
hardening" `[de2bea]`) in the shared checkout while this spec was being
written. That session has since reported completion — all 15 steps done,
with per-step evidence — see Step 5. Steps 6 and 7 use that report, not
file-existence guesses. Four things surfaced through this coordination, all
resolved or handed off explicitly rather than guessed:

1. A claim that the root `STATE.md`'s `## Executing:` marker blocks
   top-level `.md` writes while present, regardless of tool — **disputed**
   for direct `Write`/`Edit` (the hook exempts `*.md` targets
   unconditionally there), then **refined** once the peer supplied exact
   evidence: its Bash branch matches on command *text*, so a heredoc whose
   body merely mentions a protected-looking path still gets denied even
   when writing a `.md` file. Not acted on in `specs/TEMPLATE.md` — see
   Analyst.md Discovered for the full correction.
2. `AD-011`–`AD-015`/`L-007`/`L-008` already claimed in `specs/STATE.md` on
   the peer's branch, uncommitted — a real numbering collision at merge
   time. **Resolved by agreement**: 013 keeps those numbers, this spec uses
   `AD-016`/`L-009` (Step 7 Do #3).
3. `specs/013-server-hardening/` turned out to be **untracked** in the
   shared checkout, so this worktree never had it and can't edit it. Step 6
   was changed from a direct edit to a delegated request — see Step 6 and
   Analyst.md Discovered.
4. Both sessions independently confirmed neither has touched the other's
   declared files (see Step 5's report and this session's replies) — no
   file-level conflict beyond the two items above.

---

### Step 1 — Add the `**Status:**` field to the `tasks.md` step-format convention

**Model:** top-level

**Status:** done (2026-08-27, `commit 228360b` — `grep -n 'Status field — resuming after context loss' specs/TEMPLATE.md` returns 1 hit; the `**Status:**` line is present in the step-format block; "except **Done when** and **Status**, both mandatory" present)

**Files**
- MODIFY `specs/TEMPLATE.md` — anchor: the fenced step-format block starting
  `### Step N — <one-line imperative summary>`, and the `### What each
  section is for` bullet list right after it.

**Context**
The `**Model:**` field is the existing precedent for a mandatory, single-line
field with a fixed small vocabulary, documented right where the step format
is shown. `**Status:**` follows the same shape and goes directly under it.

**Do**
1. In the fenced step-format block, right after the `**Model:** haiku ...`
   line, add:
   ```
   **Status:** not started            (or: in progress; or: done (2026-08-27, `commit abc1234` — or the exact evidence the step's own Done when names))
   ```
2. Change the line "Sections with nothing to say may be dropped — except
   **Done when**, which is mandatory." to: "Sections with nothing to say may
   be dropped — except **Done when** and **Status**, both mandatory."
3. Add a new subsection right after "### Model field — which executor?" and
   before "### What each section is for", titled
   `### Status field — resuming after context loss`, with this content:

   ```markdown
   ### Status field — resuming after context loss

   A `tasks.md` run can span multiple sessions — a session runs out of
   budget, gets interrupted, or the work is picked up days later. Without a
   per-step marker, resuming means re-deriving progress from scratch: opening
   every step, grepping the codebase for what it was supposed to create,
   checking `git status`. `**Status:**` exists so that cost is paid once, by
   whoever finished the step, instead of every time someone resumes it.

   Three states: `not started`, `in progress`, `done (<date>,
   <evidence>)`. `<evidence>` is the exact thing that proves it without
   re-deriving it — a commit SHA, or the literal file/grep/test result the
   step's own **Done when** names. Not a restatement of the step summary.

   **A resuming session trusts the marker to find where to resume, then
   re-verifies only that one boundary step's Done when before continuing** —
   not every prior step. This is the checkpoint pattern (verify against
   ground truth, don't just trust a claim) applied at the single-step grain
   instead of the every-4-steps grain. A `done` marker is a claim, not proof;
   treat a step whose Done when no longer holds as `in progress` again and
   say so, rather than pushing forward on a false premise.

   **Mandatory on every step**, same as `Model:`:
   ```sh
   steps=$(grep -c '^### Step ' tasks.md)
   [ "$steps" -gt 0 ] && [ "$(grep -c '^\*\*Status:\*\*' tasks.md)" = "$steps" ]
   ```
   No hook runs this check yet (a follow-up, not part of this convention) —
   but the shape is written down now so a future gate can reuse it verbatim,
   the same way the `Model:` gate is documented before any hook enforces it.
   ```

**Done when**
- `grep -n '\*\*Status:\*\*' specs/TEMPLATE.md` shows the new line in the
  step-format block.
- `grep -n 'Status field — resuming after context loss' specs/TEMPLATE.md`
  returns one hit.
- `grep -n 'except \*\*Done when\*\* and \*\*Status\*\*' specs/TEMPLATE.md`
  returns one hit.

---

### Step 2 — Add "promote as you go" as Rule 6 in `specs/STATE.md`

**Model:** top-level

**Status:** done (2026-08-27, `commit 228360b` — `specs/STATE.md:42`, rule 6 "safety net, not the only entry point")

**Depends on:** Step 1 — none (independent finding, same file family, no
shared symbol or file).

**Files**
- MODIFY `specs/STATE.md` — anchor: the numbered "Rules for this file" list
  (rule 5 ends "...so their reasoning is second-hand.)").

**Context**
Rule 5 already says entries are written "when the thing happens, not
reconstructed later" — but nothing in this file says that overrides the
Archive ritual's timing. Rule 6 makes the relationship explicit: the ritual
(edited in Step 4... no — see Step 3, since this spec doesn't touch the
ritual itself, only `specs/STATE.md`'s copy) is a backstop, not the primary
path.

Note: this spec's own Analyst.md is itself an example of what Rule 6
describes — the Gap 2 finding lives in `specs/014-spec-continuity/Analyst.md`
right now, before this spec is anywhere near archived.

**Do**
1. After rule 5's closing parenthesis, add:
   ```markdown
   6. **The Archive ritual (below) is a safety net, not the only entry
      point.** A `CriticReview.md` finding that resolves into a real
      decision, or an `Analyst.md` "Discovered" note that rises above a
      scope-parked observation, gets its `AD`/`L`/`B` entry written here in
      the same session that produced it. Waiting for archive time is how an
      abandoned or interrupted spec's reasoning never arrives at all — see
      `specs/014-spec-continuity/Analyst.md` for the incident that motivated
      this rule.
   ```

**Done when**
- `grep -n 'safety net, not the only entry point' specs/STATE.md` returns one
  hit, positioned after rule 5 in the numbered list.

---

### Step 3 — Reword the Archive ritual step 2 and CLAUDE.md's matching bullet

**Model:** top-level

**Status:** done (2026-08-27, `commit 228360b` — `specs/STATE.md:58` "Confirm the `AD` / `L`" with the old "Add the `AD` / `L`" wording gone; `CLAUDE.md:88` carries "confirm the `AD`/`B` entries" and "written as they happened")

**Depends on:** Step 2 — the new Rule 6 it references by name ("Rule 6").

**Files**
- MODIFY `specs/STATE.md` — anchor: `## Archive ritual (run when a feature
  is finished)`, numbered step 2 ("**Add the `AD` / `L` (and any `B`)
  entries it produced.**").
- MODIFY `CLAUDE.md` — anchor: the "Working agreement" bullet beginning
  "End-of-feature ritual, in order: (1) update any docs...".

**Context**
Two documents currently describe the same 4/5-step ritual in slightly
different words; `CLAUDE.md`'s is a compressed restatement of
`specs/STATE.md`'s. Both need the same directional change — step/item 2 goes
from "write it now" to "confirm it's already there" — or they go back to
disagreeing, which is the exact problem `specs/STATE.md` rule 6 (Step 2 of
this spec) just named.

**Do**
1. In `specs/STATE.md`, replace the Archive ritual's step 2:
   ```markdown
   2. **Add the `AD` / `L` (and any `B`) entries it produced.** `AD` and `B` go
      in this file in full; each `L` is a one-line headline here **plus** its body
      in `LESSONS.md`. Writing only one of the two fails the pre-push hook.
   ```
   with:
   ```markdown
   2. **Confirm the `AD` / `L` (and any `B`) entries it produced are already
      here.** Per Rule 6 above, they should have been written as they
      happened, not saved up for this step — this is a safety net, not the
      first opportunity. Add anything that was missed. `AD` and `B` go in
      this file in full; each `L` is a one-line headline here **plus** its
      body in `LESSONS.md`. Writing only one of the two fails the pre-push
      hook.
   ```
2. In `CLAUDE.md`, in the "Working agreement" bullet list, find the exact
   sentence (verified verbatim against the file, critic pass R1): "End-of-
   feature ritual, in order: (1) update any docs the feature touched, (2)
   write the `AD`/`B` entries and the `L` headlines the spec produced into
   `specs/STATE.md`, with each lesson's body in `specs/LESSONS.md`, (3)
   **summarize the spec down to what matters**..." and change clause (2) to:
   "(2) confirm the `AD`/`B` entries and `L` headlines the spec produced are
   recorded in `specs/STATE.md` — durable findings should already be there,
   written as they happened (`specs/STATE.md` Rule 6); add anything missed
   here, with each lesson's body in `specs/LESSONS.md`,". Leave clauses (1),
   (3), (4) and everything else in that bullet unchanged.

**Done when**
- `grep -n 'Add the .AD. / .L.' specs/STATE.md` returns no hits (old wording
  gone).
- `grep -n 'Confirm the .AD. / .L.' specs/STATE.md` returns one hit.
- `grep -n 'confirm the .AD./.B. entries and .L. headlines' CLAUDE.md`
  returns one hit.
- `grep -n 'written as they happened' CLAUDE.md` returns one hit.

---

### Step 4 — CHECKPOINT

**Model:** top-level

**Status:** done (2026-08-27, Steps 1-3 Done-when all re-run green; `python3 tools/state_rotate.py --check` reports 238/300 ok. `git status --short` shows a phantom 013 diff: this worktree was never refreshed after its branch ref moved to merge `9cb0e05`, and index+tree are byte-identical to `228360b`. Not spec drift; see the wrap-up note below.)

**Do**
1. Re-run every `Done when` from Steps 1–3.
2. `python3 tools/state_rotate.py --check` — must still pass; this step's
   edits added prose to `specs/STATE.md` and it must not cross the ~300-line
   budget.
3. `git status --short` — only `specs/TEMPLATE.md`, `specs/STATE.md`,
   `CLAUDE.md`, and `specs/014-spec-continuity/` should show as
   changed/untracked. Nothing under `data/spanish/`.

**Done when**
- All three re-checks above pass.

---

### Step 5 — Get 013's real step status before touching it — RESOLVED

**Model:** top-level

**Status:** done (2026-08-27, per-step 1-15 report received from session `Specs/013 server hardening [de2bea]` via `SendMessage` and transcribed verbatim in this step)

**Depends on:** none — this was a coordination step, not a file edit.

**Resolved 2026-08-27.** The implementing session ("Specs/013 server
hardening" `[de2bea]`) replied: **all 15 steps done**, Done-when verified,
with per-step evidence. Reported status (verbatim from their message):

1. deps (`helmet@^8`, `express-rate-limit@^8`) — 39 tests green
2. `server/src/config.ts` + `config.test.ts` — 47 tests
3. `server/src/middleware/auth.ts` + `auth.test.ts` — 56 tests
4. `server/src/app.ts` ordered middleware stack — ordering grep verified
   (`basicAuth` 83 < `express.json` 90 < `/api` 96)
5. CHECKPOINT — build 0, 56 tests, tree clean
6. `/api/import` gated via `buildRouter(store, {allowImport})` — 3-hit grep
   verified
7. `web/angular.json` `inlineCritical:false` — `onload=` and `<style>` both
   0 in built `index.html`
8. SPA fallback middleware in `app.ts`
9. `index.ts` thin bootstrap + `DEV_MODE=1` dev script — no-credentials boot
   exits 1 with "refusing to start"
10. CHECKPOINT dev mode — hardened:false, `/api/collection` 200, CORS present
11. `app.integration.test.ts`, exactly 15 `it()` blocks — 71 tests
12. `specs/013-server-hardening/verify.sh` — full curl matrix passed against
    `node server/dist/index.js`
13. A7 browser check — verified by a human, not automation
14. README.md + CLAUDE.md + ROADMAP.md docs, Phase 0 checkboxes ticked
15. `specs/STATE.md` `AD-011`..`AD-015` + `L-007`/`L-008` headlines,
    `specs/LESSONS.md` bodies, `Analyst.md` retrospective, root `STATE.md`
    marker removed

They also confirmed: they have **not** touched
`specs/013-server-hardening/tasks.md` and have no plans to — it's this
spec's to retrofit. Nothing is committed on their side yet; the user hasn't
been asked about committing/archiving 013.

**Done when** — met: a concrete, per-step (1–15) status list is in hand,
sourced from that session's own report, not inferred from file existence.

---

### Step 6 — Get 013's `Status:` lines applied, by the session that owns the file — RESOLVED (delegated)

**Model:** top-level

**Status:** done (2026-08-27, owning session confirmed via `SendMessage` that all 15 `**Status:**` lines were applied with `Edit`; its own verification: 15 x `### Step` / 15 x `**Status:**` / 15 x `**Model:**`, no orphans. Not visible in this worktree until that branch merges.)

**Depends on:** Step 5 — the per-step status list it produced. Also depends
on Step 1 — the `**Status:**` convention this step is applying.

**Discovered mid-spec, changing this step's approach (see Analyst.md
Discovered):** `specs/013-server-hardening/` is untracked in the shared
checkout and does not exist anywhere in this worktree's git history — a
separate git checkout genuinely cannot see another checkout's untracked
files. This step cannot `MODIFY specs/013-server-hardening/tasks.md`
directly, and copying the peer's live uncommitted file into this worktree
would risk two conflicting copies of the same spec folder across two
branches at merge time.

**Resolved 2026-08-27:** sent the owning session (`Specs/013 server
hardening [de2bea]`) the exact 15 `**Status:** done (2026-08-27, <evidence>)`
lines (condensed from Step 5's report) via `SendMessage`, asking it to apply
them with `Write`/`Edit` (not a Bash heredoc — see the hook-nuance
Discovered note) directly after each step's `**Model:**` line, and to reply
with confirmation or a commit reference.

**Done when — met, 2026-08-27.** The owning session confirmed via
`SendMessage`: all 15 `**Status:**` lines applied with `Edit` (not a
heredoc), one directly after each step's `**Model:**` line. Its own
verification: `15 × ^**Status:**` / `15 × ^**Model:**` / `15 × ### Step`,
and every `Status:` line within 2 lines of a `Model:` line (none orphaned).
It used the supplied evidence verbatim except Step 13, which it expanded to
explain *why* A7 needed a human ("browser automation cannot answer Chrome's
native Basic Auth dialog"). It also confirmed: nothing in 013 is committed
(no SHA to cite — cited "this confirmation" instead, same as this spec's own
wrap-up will have to, per Step 7's numbering note), and this worktree won't
see the applied lines until that branch is merged — noted, not something
this spec's own acceptance criteria depend on seeing directly.

---

### Step 7 — Regression, fix the "Current work" pointer, and wrap-up

**Model:** top-level

**Status:** done (2026-08-27, `commit 228360b` — root `STATE.md` "Current work" rewritten to name 013 finished, 010 next, and the `<spec> - step N of M` format; `AD-016` at `specs/STATE.md:193`; `L-009` headline at `specs/STATE.md:224` with its body at `specs/LESSONS.md:104`; `Analyst.md` `## Retrospective` filled in. A1-A5 re-verified directly; A6's clean-`git status` clause is masked by the stale-worktree artifact noted in Step 4.)

**Depends on:** Step 6 — the accurate 013 status this step's "Current work"
text is built from.

**Files**
- MODIFY root `STATE.md` — anchor: `## Current work`. (**Not**
  `specs/STATE.md` — critic pass caught this: the "Current work" prose
  section lives in the repo-root run-marker file, not the durable-memory
  file. The `## Executing: 013-server-hardening` marker in this same file
  has already been removed by the implementing session — confirmed in Step
  5's report — so this step only needs to fix "Current work", nothing else
  in root `STATE.md`.)
- MODIFY `specs/STATE.md` — new `AD`/`L` entries for *this* spec's own
  decision (see Do #3 — numbering caveat below).
- MODIFY `specs/LESSONS.md` — the `L` entry's body.
- MODIFY `specs/014-spec-continuity/Analyst.md` — anchor: `## Retrospective`.

**Do**
1. Replace root `STATE.md`'s "Current work" section (currently naming
   `specs/010-day-rollover-anchoring/` as "the only live spec") with a
   corrected version naming `specs/013-server-hardening/` as **finished**
   (all 15 steps done, per Step 5/6), and `specs/010-day-rollover-anchoring/`
   as next in line (still has `Analyst.md` + `CriticReview.md`, awaiting
   `tasks.md`). Add one sentence establishing the going-forward format:
   `<spec> — step N of M` while a run is in progress.
2. Walk every acceptance criterion in `specs/014-spec-continuity/Analyst.md`
   §4 (A1–A6) and confirm each one directly (not "should be fine" — run the
   actual grep/check named).
3. Add an `AD` entry to `specs/STATE.md` recording this spec's own decision:
   per-step `Status:` lines in `tasks.md`, plus promoting durable findings
   into `STATE.md` as they happen rather than only at archive time (Rule 6).
   Add an `L` headline plus its body in `specs/LESSONS.md` for the concrete
   lesson: a hand-maintained pointer (the old "Current work" section) decays
   silently once nobody is forced to touch it — durable status needs to live
   next to the artifact it describes, not in separate prose that's easy to
   forget.
   **Numbering (agreed with the 013 session, 2026-08-27):** 013 keeps
   `AD-011`–`AD-015`/`L-007`/`L-008` (finished first, already written and
   cross-referenced). This spec uses **`AD-016`**/**`L-009`**. Still flag to
   the user in the wrap-up report that this was an inter-session agreement,
   not a unilateral choice, and remains overridable before either branch
   merges.
4. Fill in `specs/014-spec-continuity/Analyst.md`'s `## Retrospective`
   section: did Analyst.md catch anything not thought of up front (the live
   013 coordination discovery, the root-vs-specs `STATE.md` mixup caught by
   the critic pass, the corrected hook-heredoc claim, the untracked-spec-
   directory discovery that forced Step 6 to be delegated instead of
   executed directly), and did anything in this `tasks.md` turn out wrong
   during execution.
5. `python3 tools/state_rotate.py --check` one more time.
6. `git status --short` — confirm the file list matches exactly: `STATE.md`
   (root), `specs/TEMPLATE.md`, `specs/STATE.md`, `specs/LESSONS.md`,
   `CLAUDE.md`, `specs/014-spec-continuity/`. (`specs/013-server-hardening/`
   is untracked in this worktree per Step 6's discovery and is not this
   worktree's to show as changed — its `Status:` retrofit lives on the
   other session's branch.)

**Done when**
- All of the above complete and `git status --short` matches the expected
  file list exactly, nothing under `data/spanish/`.

**Do not commit — ask the user first.**
