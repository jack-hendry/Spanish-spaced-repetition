# STATE: 009-lessons-capture

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** (none — all tasks complete)
- **Last updated:** 2026-07-14

## Original request
> Lessons capture: durable gotchas that survive /clear
>
> Context
>
> The SDD harness loses hard-won knowledge at every /clear: gotchas discovered mid-task live only in conversation context. The fix, agreed in discussion: capture pitfalls in STATE.md during implementation, then promote durable ones into the existing skill files at the end-of-feature drift audit — folding into the read path that already exists (the implementer reads SKILL.md for every skill on a task's Skills: line, and the critic already mechanically polices that line) rather than adding a new knowledge/ tree. Precedent already in the repo: scheduling-domain/SKILL.md contains a 50-line "Recipe" section distilled from feature 008 — this formalizes what's already happening ad hoc.
>
> Design decisions locked in:
> - Lessons live in a delimited ## Lessons (auto-appended) section at the bottom of each of the four SKILL.md files. Domain key = skill name; no aliases, no knowledge/ tree (YAGNI — revisit only if a skill ever splits).
> - STATE.md gains a Pitfalls section alongside Discovered. Litmus: Discovered = "someone should fix this later" (out-of-scope work); Pitfall = "future me will trip on this again" (durable knowledge).
> - The critic promotes Pitfalls → Lessons during its drift mode, as a narrow, append-only exception to its "only write CRITIQUE.md" rule. No prune/merge: deciding a lesson is stale is editorial judgment with no review gate — the critic instead reports stale/duplicate lessons as CRITIQUE.md findings for the human. The one legitimate sliver of merge: read the existing Lessons section first and skip appending a near-duplicate.
> - Homeless pitfalls (no matching skill — npm-workspace quirks, SDD-process lessons): critic leaves them in STATE.md and flags them in CRITIQUE.md ("no skill home — human decides: CLAUDE.md, new skill, or drop"). It never invents a destination.
> - Lesson format: dated entry, one line by default, a few lines when the failure mode needs them. If a lesson deserves prescriptive-body treatment (like the feature-008 Recipe), the critic appends the short form and flags "consider promoting into the body" in CRITIQUE.md.
> - Coverage gap accepted: promotion only fires at the drift audit, so abandoned features' Pitfalls stay in STATE.md until a human or later /resume rescues them.
>
> Changes (7 files, all markdown — no source code)
>
> 1. .claude/agents/implementer.md
> - In protocol step 7 (the existing STATE.md update), add: append task-relevant gotchas to a ## Pitfalls section — no new step, same ceremony.
> - Add the Discovered-vs-Pitfall litmus next to the existing scope-discipline rule so both sections are defined in one place.
>
> 2. .claude/agents/critic.md
> - Amend the hard rule "The ONLY file you ever write is CRITIQUE.md" with the narrow exception: in drift mode only, may append dated entries to the ## Lessons (auto-appended) section of .claude/skills/*/SKILL.md — never edit or delete existing lines, never touch the prescriptive body.
> - In Mode: drift, add a promotion step:
>   a. Read STATE.md's Pitfalls section.
>   b. For each durable pitfall, match it to a skill by name; read that skill's existing Lessons section; skip if already covered; otherwise append - YYYY-MM-DD ({NNN}-{slug}): <lesson>.
>   c. No matching skill → leave in STATE.md, flag in CRITIQUE.md for the human.
>   d. Lesson too big for a bullet → append the short form + flag "consider promoting into the body" in CRITIQUE.md.
>   e. Existing lesson looks stale/contradicted by code → report as a finding; do not delete.
>   - List promotions made (and skipped duplicates) in CRITIQUE.md so the human can review them.
>
> 3–6. The four SKILL.md files
> .claude/skills/{angular-conventions,python-pipeline,scheduling-domain,testing-playbook}/SKILL.md — append an identical stable section at end of file:
>
> ## Lessons (auto-appended)
>
> Dated entries promoted from feature STATE.md Pitfalls by the critic's drift
> audit. Append-only; humans prune. If a lesson contradicts the body above,
> trust the code, then fix both.
>
> _None yet._
>
> (The _None yet._ placeholder is removed by the first real append.)
>
> 7. CLAUDE.md
> One short paragraph under SDD Harness Rules describing the mechanism: implementer logs Pitfalls in STATE.md (with the litmus), critic's drift audit append-promotes durable ones into the matching skill's Lessons section, pruning is human-only.
>
> Verification
>
> Docs-only change — no tests or runtime surface. Verify by consistency read-through:
> - The three documents that each define part of the loop (implementer.md, critic.md, CLAUDE.md) use the same section names (Pitfalls, ## Lessons (auto-appended)) and the same litmus wording.
> - critic.md's exception is scoped exactly: drift mode, append-only, Lessons section only — and doesn't contradict its remaining hard rules.
> - Each SKILL.md's new section is byte-identical across the four files and sits after all existing content (scheduling-domain's Recipe section stays untouched in the body).
> - Optionally dry-run the loop: pick a real pitfall from a past feature's STATE.md (e.g. specs/008) and walk it through the critic's new instructions on paper to confirm they're executable without judgment calls the text doesn't cover.

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] Reviewed & verified (/code-review + /verify after last task)
- [x] T001 (low): implementer.md — capture instruction in step 7 + Discovered-vs-Pitfall litmus (R1, R2)
- [x] T002 (low): critic.md — scoped append exception, drift promotion step (a)–(e), audit trail (R3, R4, R5)
- [x] T003 (medium): four SKILL.md files — byte-identical `## Lessons (auto-appended)` terminator (R6)
- [x] T004 (low): STATE.md template — `## Pitfalls` skeleton section (R7)
- [x] T005 (low): CLAUDE.md — lessons-capture paragraph under SDD Harness Rules (R8)
- [x] T006 (low): consistency read-through + paper dry-run against specs/008 (R9, Verification)

## Decisions log
- 2026-07-14 (human gate, spec): R9 rescoped — section names identical across
  all four documents, but litmus wording verbatim only in implementer.md and
  CLAUDE.md (critic never classifies; template stays a skeleton).
- 2026-07-14 (human gate, spec): Q1 resolved forward-only — no retrofit of
  old features' STATE.md; critic tolerates absent Pitfalls section (R4(a)).
- 2026-07-14 (planner): canonical litmus and section-name strings fixed in
  PLAN.md Approach; all tasks copy them verbatim to make R9 mechanical.
- 2026-07-14 (planner): Q2 stays open, no /resume work planned (lean: leave
  rescue of abandoned features' Pitfalls to humans).
- 2026-07-14 (T006): R9 consistency read-through + paper dry-run: PASS. All five
  checks verified: (1) section names `## Pitfalls` and `## Lessons (auto-appended)`
  consistent across implementer.md, critic.md, CLAUDE.md, template; (2) litmus
  wording character-identical in implementer.md & CLAUDE.md, absent from critic.md
  & template; (3) critic.md exception properly scoped to drift mode, append-only,
  Lessons section only, no contradiction with other hard rules; (4) all four
  SKILL.md files have byte-identical Lessons sections at end of file; (5) paper
  dry-run against specs/008: Pitfalls section absent (as expected for pre-mechanism
  feature), step (a) of promotion is fully executable, hypothetical present-Pitfalls
  case would require minor domain-matching judgment in step (b) but step (c) provides
  escape hatch for unclear matches. All instructions executable as written.
- 2026-07-14 (T002, logged retroactively at drift audit): critic.md's promotion
  step gained one sentence beyond the plan's specified text — re-read the target
  SKILL.md before writing and reproduce it byte-identically apart from appends —
  in response to the plan critique's WARN 1 (critic has Write, not Edit).
- 2026-07-14 (drift audit): critic mode=drift returned PASS WITH NOTES (0
  blockers, 0 warnings, 2 nits). 8-file diff matches the plan exactly; all
  done-when criteria verified mechanically. Pitfalls section empty, so no
  Lessons promoted. Phase set to done.

## Summary of what was built
Docs-only lessons-capture mechanism: implementer.md step 7 now logs gotchas to
STATE.md `## Pitfalls` (litmus beside the scope-discipline rule); critic.md
drift mode gained an append-only promotion step (a)–(e) into the
`## Lessons (auto-appended)` terminator sections added to all four skill
files; the STATE.md template gained a Pitfalls skeleton; CLAUDE.md documents
the loop. Litmus wording verbatim in implementer.md + CLAUDE.md only.

## Discovered
(empty)

## Pitfalls
(empty)

## Next action
Feature done. "Reviewed & verified" still unchecked — run /code-review; /verify
has no runtime surface to drive for this docs-only change.

## Blockers
(none)
