# CriticReview — 014 spec continuity

One harden round, per the CLAUDE.md sizing rule for a Medium task.

---

## Round 1 — 2026-08-27 (pre-implementation)

Method per `specs/TEMPLATE.md` § "What the critic pass verifies": for every
step that assumes an anchor string exists verbatim in a target file, **open
that file and confirm it**. Four findings.

### R1 — "Current work" lives in root `STATE.md`, not `specs/STATE.md` — FIXED

The draft `tasks.md` (Step 7) and `Analyst.md` (§2.3, A3) both said
`specs/STATE.md`'s "Current work" section was the target. Grepping for
`## Current work` found it in the repo-root `STATE.md` (the run-marker
file, AD-008) instead — `specs/STATE.md` has no such section at all. Easy
mistake: the root file's first line is a pointer *to* `specs/STATE.md`,
inviting the conflation. Corrected in both documents; `tasks.md` Step 7 now
explicitly calls out the two files by name so the executor doesn't repeat
the mistake.

### R2 — `CLAUDE.md` quote had `AD`/`L` where the source says `AD`/`B` — FIXED

`tasks.md` Step 3's `Do` block quoted the sentence to find in `CLAUDE.md`
with `write the \`AD\`/\`L\` entries` — the real text (confirmed by `grep -n
'End-of-feature ritual, in order'` against `CLAUDE.md`) says `AD`/`B`.
`L` is redundant there anyway ("the `L` headlines" follows immediately
after). Fixed the quoted anchor in Step 3; the step's own `Done when` had
already used the correct `AD`/`B` wording, so only the `Do` section was
wrong.

### R3 — 013 finished mid-plan; two claims from the implementing session needed independent verification — ONE CONFIRMED, ONE DISPUTED

While this spec was being planned, `specs/013-server-hardening` (planned but
not started at the start of this conversation) was completed by a separate
session in the shared checkout. Its status report included two claims
relevant to this spec's own conventions:

1. *"`enforce-haiku-tasks-pretooluse.sh` blocks all top-level writes while
   the `## Executing:` marker is present, including spec-doc writes."*
   **Disputed.** Re-read the hook directly: for any non-`Bash` tool, `target
   == *.md` exits `0` unconditionally, before the protected-path check —
   `.md` writes are exempt regardless of the marker. All the files that
   session listed editing (`Analyst.md`, `STATE.md`, `LESSONS.md`,
   `CLAUDE.md`, `README.md`, `ROADMAP.md`) end in `.md`. The claim doesn't
   match the code as it stands in this worktree. Not incorporated into
   `specs/TEMPLATE.md`; flagged back to the reporting session by
   `SendMessage` instead of silently trusting a peer's account of a hook
   neither of us re-read together.
2. *Per-step Done-when evidence for all 15 steps of 013, with an explicit
   note that `specs/013-server-hardening/tasks.md` itself was untouched.*
   **Accepted as reported** — this is exactly the kind of claim this spec's
   own `Status:` convention exists to make cheap to state and cheap to
   trust-but-verify (re-run the boundary step's Done when on resume, not
   the whole history). `tasks.md` Step 6 retrofits it verbatim, attributed
   to that session's report, not independently re-derived from file
   existence — the same discipline Step 5's `If blocked` clause demanded
   before any reply had arrived.

### R4 — `AD`/`L` numbering collision across concurrent branches — SURFACED, NOT FIXED

The 013-implementing session's report also said it had already added
`AD-011`–`AD-015` and `L-007`/`L-008` to `specs/STATE.md`, uncommitted, on
a different branch (`feature/SSD-habit-tracker-algined`'s shared checkout).
This worktree's own `specs/STATE.md` still shows `AD-010`/`L-006` as the
highest entries — the two branches will claim the same numbers for
different content. This is not a defect in either spec's process; it's an
inherent property of two branches concurrently appending to the same
append-only, never-renumbered log with no shared counter. `tasks.md` Step 7
Do #3 proceeds with the locally-next numbers anyway (the alternative —
guessing a number far enough ahead to dodge the collision — just moves the
guess) and requires saying so plainly to the user rather than silently
picking a number and hoping. Not something a markdown edit in this spec can
resolve; it's a merge-time human decision, flagged as such.

### What was NOT re-litigated

Every other anchor string in `tasks.md` (the `**Model:** haiku ...` line,
`### Model field`/`### What each section is for` headers, `specs/STATE.md`
Rule 5's closing text, the Archive ritual's step-2 wording) was grepped and
confirmed to match verbatim before this review — see the tool output in the
conversation this spec was written from. Only the two mismatches above
existed; the rest needed no correction.
