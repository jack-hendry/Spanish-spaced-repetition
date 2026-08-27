# tasks — 014 spec continuity

**Archived summary.** All 7 steps executed and verified 2026-08-27 —
this file originally carried full inline Do/Context/Files/Done-when sections
per step, condensed here at archive time (CLAUDE.md end-of-feature ritual)
since the reasoning now lives in `Analyst.md` (scope, Discovered,
Retrospective) and `specs/STATE.md` (`AD-016`, `L-009`). See
`CriticReview.md` for the harden round's four findings.

All steps ran `Model: top-level` — each either wrote to a protected spec doc
(`tasks.md`, blocked from subagent writes by
`protect-spec-docs-from-subagents.sh`) or made small, precise wording changes
to a process document (`specs/TEMPLATE.md`, `specs/STATE.md`, `CLAUDE.md`)
where delegating would have cost more in round-trips than it saved.

**Live coordination, resolved during execution:** `specs/013-server-hardening`
was being actively implemented by a separate session in the shared checkout
while this spec was being written, and finished (all 15 steps) partway
through. That forced real inter-session coordination (`SendMessage`) instead
of inferring status from file existence: the peer session supplied its own
per-step status (Step 5) and applied the `Status:` retrofit to its own file
directly (Step 6 — this worktree couldn't; `specs/013-server-hardening/` was
untracked here), and the two specs agreed by direct message to split the
`AD`/`L` numbering (013 keeps `AD-011`–`AD-015`/`L-007`/`L-008`; this spec
uses `AD-016`/`L-009`) rather than collide. Full account in `Analyst.md`'s
Discovered and Retrospective sections.

---

### Step 1 — Add the `**Status:**` field to the `tasks.md` step-format convention
**Model:** top-level
**Status:** done (2026-08-27, `commit 228360b` — `specs/TEMPLATE.md` step-format
block carries the `**Status:**` line and a new "Status field — resuming after
context loss" subsection)

### Step 2 — Add "promote as you go" as Rule 6 in `specs/STATE.md`
**Model:** top-level
**Status:** done (2026-08-27, `commit 228360b` — `specs/STATE.md` Rule 6,
"safety net, not the only entry point")

### Step 3 — Reword the Archive ritual step 2 and CLAUDE.md's matching bullet
**Model:** top-level
**Status:** done (2026-08-27, `commit 228360b` — `specs/STATE.md` Archive
ritual step 2 now "Confirm the `AD` / `L`..."; `CLAUDE.md`'s end-of-feature
bullet reworded to match)

### Step 4 — CHECKPOINT
**Model:** top-level
**Status:** done (2026-08-27, Steps 1–3 Done-when all re-ran green;
`tools/state_rotate.py --check` 238/300 ok)

### Step 5 — Get 013's real step status before touching it
**Model:** top-level
**Status:** done (2026-08-27, per-step 1–15 status received from the 013
session via `SendMessage`: all 15 steps done, Done-when verified with
per-step evidence)

### Step 6 — Get 013's `Status:` lines applied, by the session that owns the file
**Model:** top-level
**Status:** done (2026-08-27, 013 session confirmed via `SendMessage`: all 15
`**Status:**` lines applied with `Edit`, one per step, no orphans — not
visible in this worktree until that branch merged; discovery that forced
delegation instead of a direct edit is in `Analyst.md`'s Discovered section)

### Step 7 — Regression, fix the "Current work" pointer, and wrap-up
**Model:** top-level
**Status:** done (2026-08-27, `commit 228360b` — root `STATE.md` "Current
work" rewritten to name 013 finished and 010 next, plus the `<spec> — step N
of M` format; `AD-016` and `L-009` (with body in `specs/LESSONS.md`) added to
`specs/STATE.md`; `Analyst.md` Retrospective filled in; A1–A5 re-verified
directly)

---

*(Originally "Do not commit — ask the user first." — superseded: the user
approved the archive move that includes this commit.)*
