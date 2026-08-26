# SPEC: 009-lessons-capture

Durable gotchas that survive /clear. Docs-only process feature: every change
is a markdown file under `.claude/` or `CLAUDE.md`. No source code.

## Problem

The SDD harness loses hard-won knowledge at every /clear: gotchas discovered
mid-task live only in conversation context. There is already an ad-hoc
precedent — `scheduling-domain/SKILL.md` contains a "Recipe" section distilled
from feature 008 — but no defined mechanism produces such content. The read
path already exists (the implementer reads SKILL.md for every skill on a
task's `Skills:` line; the critic mechanically polices that line), so captured
lessons in SKILL.md files are guaranteed to be re-read. What is missing is the
write path: capture during implementation, promotion at the drift audit.

## Goals

- Pitfalls discovered mid-task are recorded in the feature's STATE.md as part
  of the implementer's existing STATE.md-update ceremony.
- Durable pitfalls are promoted into the matching skill's SKILL.md at the
  end-of-feature drift audit, so they enter the existing implementer read path.
- The promotion is safe by construction: append-only, dated, confined to one
  delimited section; pruning and merging remain human-only.
- The three documents defining the loop (implementer.md, critic.md, CLAUDE.md)
  use identical section names and litmus wording, so no agent has to guess.

## Non-goals (out of scope)

- No `knowledge/` tree, no domain aliases, no new skills. Domain key = one of
  the four existing skill names. Revisit only if a skill ever splits.
- No automated pruning or merging of lessons. Staleness is editorial judgment
  with no review gate; the critic reports suspected-stale lessons as
  CRITIQUE.md findings and never deletes or edits existing lines.
- No changes to source code, tests, the pipeline's phases/gates, or any agent's
  toolset. No new agents, commands, or templates beyond the edits listed here.
- No editing of any SKILL.md prescriptive body by any agent (the
  scheduling-domain "Recipe" section stays untouched).
- No promotion path outside the drift audit. Accepted coverage gap: abandoned
  features' Pitfalls stay in STATE.md until a human or a later /resume rescues
  them.
- The critic never invents a destination for a homeless pitfall (one matching
  no skill); routing those is a human decision.

## Design decisions (locked in — do not reopen)

- **D1** Lessons live in a delimited `## Lessons (auto-appended)` section at
  the bottom of each of the four SKILL.md files.
- **D2** STATE.md gains a `## Pitfalls` section alongside `## Discovered`.
  Litmus: Discovered = "someone should fix this later" (out-of-scope work);
  Pitfall = "future me will trip on this again" (durable knowledge).
- **D3** The critic promotes Pitfalls → Lessons during drift mode only, as a
  narrow append-only exception to its "only write CRITIQUE.md" hard rule.
- **D4** Lesson format: dated one-line entry by default
  (`- YYYY-MM-DD ({NNN}-{slug}): <lesson>`); a few lines when the failure
  mode needs them. Prescriptive-body treatment is a flagged human decision.
- **D5** The one legitimate merge sliver: the critic reads the existing
  Lessons section first and skips appending a near-duplicate.

## Requirements

Files affected (8, all markdown): `.claude/agents/implementer.md`,
`.claude/agents/critic.md`, `.claude/templates/STATE.md`, the four
`.claude/skills/*/SKILL.md` files, `CLAUDE.md`.

**R1 — implementer.md: capture.** Protocol step 7 (the existing "Update
STATE.md" step) additionally instructs appending task-relevant gotchas to a
`## Pitfalls` section. No new protocol step; same ceremony.

**R2 — implementer.md: litmus.** The Discovered-vs-Pitfall litmus (D2 wording)
appears next to the existing scope-discipline hard rule ("note them in
STATE.md under a 'Discovered' section"), so both sections are defined in one
place.

**R3 — critic.md: scoped exception.** The hard rule "The ONLY file you ever
write is {feature-dir}/CRITIQUE.md" is amended with exactly one exception: in
drift mode only, the critic may append dated entries to the
`## Lessons (auto-appended)` section of `.claude/skills/*/SKILL.md` — never
editing or deleting existing lines, never touching the prescriptive body. The
remaining hard rules (read-only Bash; report, never fix) are unchanged and
not contradicted.

**R4 — critic.md: promotion step.** "Mode: drift" gains a promotion step
covering: (a) read STATE.md's Pitfalls — if the section is absent or empty
(features created before this change), note that in CRITIQUE.md and skip the
rest of the promotion step; (b) per durable pitfall, match to a
skill by name, read that skill's existing Lessons section, skip if already
covered, else append in D4 format; (c) no matching skill → leave in STATE.md
and flag in CRITIQUE.md ("no skill home — human decides: CLAUDE.md, new
skill, or drop"); (d) lesson too big for a bullet → append the short form and
flag "consider promoting into the body"; (e) existing lesson looks stale or
contradicted by code → report as a finding, do not delete.

**R5 — critic.md: audit trail.** The critic lists promotions made and
duplicates skipped in CRITIQUE.md so the human can review them.

**R6 — SKILL.md sections.** Each of the four SKILL.md files ends with a
byte-identical section, placed after all existing content:

    ## Lessons (auto-appended)

    Dated entries promoted from feature STATE.md Pitfalls by the critic's drift
    audit. Append-only; humans prune. If a lesson contradicts the body above,
    trust the code, then fix both.

    _None yet._

The `_None yet._` placeholder is removed by the first real append.

**R7 — STATE.md template.** `.claude/templates/STATE.md` gains a
`## Pitfalls` section (initially `(empty)`) alongside `## Discovered`, so new
features get the section without the implementer improvising it. (This file
was omitted from the original 7-file list; without it, R1 asks the
implementer to write to a section the template never creates.)

**R8 — CLAUDE.md.** One short paragraph under "SDD Harness Rules" describes
the mechanism: implementer logs Pitfalls in STATE.md (with the litmus),
critic's drift audit append-promotes durable ones into the matching skill's
Lessons section, pruning is human-only.

**R9 — consistency.** implementer.md, critic.md, CLAUDE.md, and the STATE.md
template use the exact same section names (`## Pitfalls`,
`## Lessons (auto-appended)`). The litmus wording (D2) appears verbatim in
the two documents that state it — implementer.md (R2) and CLAUDE.md (R8);
critic.md and the template do not carry the litmus.

## Verification

Docs-only; no tests or runtime surface. Pass/fail by consistency read-through
against R1–R9, plus optionally a paper dry-run: take a real pitfall from
`specs/008-listening-comprehension-card/STATE.md` and walk it through the
critic's new drift instructions, confirming they are executable without
judgment calls the text doesn't cover.

## Open questions

- **Q1** — RESOLVED (human, 2026-07-14): forward-only. No retrofit of
  existing features' STATE.md; the critic's drift step tolerates an absent
  Pitfalls section (folded into R4(a)).
- **Q2** Does /resume need any wording change to "rescue" abandoned features'
  Pitfalls (the accepted coverage gap), or is that left entirely to humans for
  now? (Current lean: leave it; noting the gap in CLAUDE.md's paragraph is
  optional.)
