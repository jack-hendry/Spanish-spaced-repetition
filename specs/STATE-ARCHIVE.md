# STATE — archive

Overflow for `STATE.md`. When that file gets unwieldy (~300 lines), old
`AD` (decisions) and `B` (blockers) entries and closed Quick Tasks move here.
`python3 tools/state_rotate.py --apply` does the move; the pre-push hook only
ever runs `--check`.

Rules:

- **Lessons (`L-NNN`) never move here.** They are permanent and stay in
  `STATE.md`.
- Numbers are preserved exactly — moving an entry never renumbers it.
- A moved entry leaves a one-line stub in `STATE.md` pointing here, so a
  citation like "supersedes AD-004" is always resolvable.
- Superseded decisions are moved here, not deleted. The reasoning that turned
  out to be wrong is the most useful part of the record.

## Decisions

(nothing rotated yet)

**AD-007 — `todayNumber` may be changed by 010, and its ≤1-day transition is
accepted, never migrated.** (2026-08-15, `specs/010-day-rollover-anchoring`)
007 explicitly deferred the root cause and declared changing `todayNumber`
a non-goal; 010 reverses that for this one feature. Day numbers exist in two
populations with different lifetimes — **derived at render time** from epoch-ms
(streaks, forecasts, heat, optimizer histories; these self-correct) and
**persisted** (`card.due` for review cards, `deck.daily.day`,
`collection.lastUnburyDay`; these do not). The correction comes solely from
moving where the boundaries fall. No step may re-base the persisted set, and no
artificial origin offset may be added to keep today's integer at 51 — that
would preserve the stale `deck.daily.day` match and leave the reported bug
unfixed.

**AD-008 — `specs/STATE.md` is the project memory; root `STATE.md` is a run
marker only.** (2026-08-26, migration) Two files named STATE.md is a real cost,
paid deliberately: the root one exists because
`.claude/hooks/enforce-haiku-tasks-pretooluse.sh` greps the **repo root** for
`## Executing: <spec-dir-name>`, and a hook that greps project memory would fire
on any incidental mention. Keeping the marker in a file with nothing else in it
is what makes the signal unambiguous. See **L-004**, **L-005**.

**AD-009 — Adopted habit_tracker's harness shape; retired the `/feature` +
`/resume` pipeline.** (2026-08-26) The old harness used `specs/NNN-slug/` with
`SPEC`/`PLAN`/`STATE`/`CRITIQUE.md`, four subagents, two slash commands and one
Stop hook, and routed models by a planner-assigned `Complexity:` rating. It is
replaced by: `Analyst.md` / `tasks.md` / `CriticReview.md` per
`specs/<feature-name>/`; a repo-wide `specs/STATE.md` + `specs/LESSONS.md` +
`specs/STATE-ARCHIVE.md`; per-step `Model:` fields (`haiku` / `sonnet` /
`top-level`, **never `opus`**); two PreToolUse hooks and one UserPromptSubmit
hook; and a `clean-table-check.sh` pre-push gate mirrored in CI. Why: the
enforcement layer is the part the old harness lacked entirely — its single Stop
hook asked for a STATE.md update and nothing checked archives, lesson
correspondence, memory size, or who was allowed to write what. The top-level
session now orchestrates directly; the `Model:` field replaces `resume.md`'s
complexity routing, and putting it *in the step* makes an absent one a visible
defect rather than a silent inherit of the session model. Cost, accepted: the
nine archived specs keep the old filenames (see Quick Tasks).

## Blockers

(nothing rotated yet)

## Quick Tasks

(nothing rotated yet)
