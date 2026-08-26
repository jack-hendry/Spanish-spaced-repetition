# CRITIQUE: 009-lessons-capture
- **Mode:** drift
- **Date:** 2026-07-14
- **Verdict:** PASS WITH NOTES

## Findings
1. **[NIT]** Unlogged (benign) deviation from PLAN.md: T002's edit to
   `.claude/agents/critic.md` adds a sentence not in the plan's specified
   text ("You have Write but not Edit, so an append means rewriting the
   whole file: … reproduce it byte-identically apart from the appended
   entries"). This directly answers the plan-mode critique's WARN 1, so it
   is the right call — but it is a deviation from plan text that the
   implementer protocol says belongs in STATE.md's Decisions log, and it
   isn't there.
2. **[NIT]** T001/T005 done-when says the litmus sentence is
   "character-identical" in implementer.md and CLAUDE.md; it is word-for-word
   identical but wrapped at different columns, so the check holds only
   ignoring line breaks (exactly the ambiguity the plan-mode critique's
   WARN 2 predicted). Meets R9's intent; no action needed unless you want
   the wording strictly literal.

## Drift audit detail
- **Files touched vs plan:** exact match. The 009 working-tree changes are
  precisely the 8 planned markdown files (`.claude/agents/implementer.md`,
  `.claude/agents/critic.md`, the four `.claude/skills/*/SKILL.md`,
  `.claude/templates/STATE.md`, `CLAUDE.md`) plus `specs/009-lessons-capture/`.
  No planned file untouched; no unplanned file touched. (The branch's
  committed `server/`, `web/`, `data/`, `specs/008-*` changes belong to
  feature 008 and are excluded from this audit per instruction.)
- **Non-goal compliance:** no source code, tests, toolsets, agents, or
  SKILL.md prescriptive bodies changed; scheduling-domain's Recipe section
  intact; the critic exception is scoped to drift mode / append-only /
  Lessons section only and doesn't contradict the remaining hard rules.
- **Done-when evidence (verified mechanically):** implementer.md still has
  8 protocol steps, capture clause in step 7, litmus bullet beside the
  scope-discipline rule; critic.md has the scoped exception, sub-points
  (a)–(e), the audit-trail requirement, and no litmus; the four SKILL.md
  tails are byte-identical (matching md5 over `tail -8`), exactly one
  `## Lessons (auto-appended)` heading per file, additions-only diffs;
  the template has `## Pitfalls` / `(empty)` after `## Discovered`; the
  litmus string occurs in exactly two files (implementer.md, CLAUDE.md);
  T006's dated Decisions-log entry records the read-through result.
- **Decisions log vs spec:** all entries consistent with SPEC.md (the R9
  rescope and Q1 resolution are already folded into the spec text).
- **Discovered:** empty; no signs of inline fixes.

## Pitfalls promotion
- This feature's own `## Pitfalls` section exists but is `(empty)` — per
  step (a), promotion skipped. Promotions made: none. Duplicates skipped:
  none. All four Lessons sections still carry the `_None yet._`
  placeholder, as expected for the mechanism's first feature.
