# PLAN: 009-lessons-capture

## Approach

Docs-only feature: eight markdown files, no source code, no tests. The write
path for durable lessons is added in three places — capture (implementer.md),
promotion (critic.md), and the human-facing summary (CLAUDE.md) — plus the
container edits: a `## Pitfalls` section in the STATE.md template and a
byte-identical `## Lessons (auto-appended)` terminator in the four SKILL.md
files. R9 (consistency) is the main failure mode, so this plan fixes the two
canonical strings here and every task copies them verbatim rather than
paraphrasing:

- Section names, exact: `## Pitfalls` and `## Lessons (auto-appended)`.
- Litmus, exact (appears verbatim ONLY in implementer.md and CLAUDE.md, per
  the STATE.md Decisions log — critic.md and the template do NOT carry it):
  `Discovered = "someone should fix this later" (out-of-scope work); Pitfall
  = "future me will trip on this again" (durable knowledge).`

Ordering is one-file-per-role tasks first (each fully specified, so they run
cheap), the four-file mechanical append as one grouped task, and a final
verification-only read-through implementing the spec's Verification section
(including the paper dry-run against a feature-008 pitfall). Tradeoff: T003
touches 4 files so it rates medium under the rubric even though it is a
verbatim paste — grouping beats four one-line tasks. Q2 (whether /resume
mentions rescuing abandoned features' Pitfalls) stays open, lean "leave to
humans": no task plans work for it.

## Files affected

- `.claude/agents/implementer.md` — modify: capture instruction in protocol
  step 7 + litmus beside the scope-discipline rule (R1, R2)
- `.claude/agents/critic.md` — modify: scoped write exception + drift-mode
  promotion step + audit trail (R3, R4, R5)
- `.claude/skills/angular-conventions/SKILL.md` — modify: append Lessons section (R6)
- `.claude/skills/python-pipeline/SKILL.md` — modify: append Lessons section (R6)
- `.claude/skills/scheduling-domain/SKILL.md` — modify: append Lessons section (R6)
- `.claude/skills/testing-playbook/SKILL.md` — modify: append Lessons section (R6)
- `.claude/templates/STATE.md` — modify: add `## Pitfalls` skeleton section (R7)
- `CLAUDE.md` — modify: one mechanism paragraph under SDD Harness Rules (R8)

No file under `web/` or `server/` is touched; no tests are written.

## Tasks

### T001 — implementer.md: capture instruction + litmus (R1, R2)
Files: `.claude/agents/implementer.md`
Two edits, no new protocol step:
1. Extend protocol step 7 (currently ends `...log any decisions you made
   that deviate from PLAN.md`) by appending to that same sentence:
   `, and append any task-relevant gotchas to a "## Pitfalls" section
   (see the litmus under Hard rules)`.
2. Immediately after the existing hard rule
   `- Scope discipline: if you notice unrelated problems, note them in
   STATE.md under a "Discovered" section; do not fix them.` add a new
   bullet:
   `- Discovered vs Pitfall litmus: Discovered = "someone should fix this
   later" (out-of-scope work); Pitfall = "future me will trip on this
   again" (durable knowledge). Pitfalls go in STATE.md's "## Pitfalls"
   section — they are what the drift audit later promotes into skills.`
Done when: implementer.md contains both edits; step count is unchanged (still
8 steps); the litmus sentence matches the canonical string in this plan's
Approach section character-for-character.
Skills: none (docs-only — no `web/`/`server/` files; read SPEC.md R1–R2/D2
and the current implementer.md in full before editing)
Complexity: low

### T002 — critic.md: scoped exception, promotion step, audit trail (R3, R4, R5)
Files: `.claude/agents/critic.md`
Three edits:
1. Amend the first hard rule (`The ONLY file you ever write is
   {feature-dir}/CRITIQUE.md. Never touch SPEC.md, PLAN.md, STATE.md, or
   any source file.`) by appending: `One exception: in drift mode only,
   you may APPEND dated entries to the "## Lessons (auto-appended)"
   section of .claude/skills/*/SKILL.md — never edit or delete existing
   lines, never touch anything above that section.` Leave the other two
   hard rules (read-only Bash; report, never fix) untouched.
2. At the end of the `## Mode: drift` section, add a "Promote Pitfalls to
   Lessons" step covering, in order: (a) read STATE.md's `## Pitfalls`
   section — if absent or empty (features created before this mechanism),
   note that in CRITIQUE.md and skip the rest of this step; (b) for each
   durable pitfall, match it to one of the four skills by name, read that
   skill's existing `## Lessons (auto-appended)` section, skip if already
   covered (near-duplicate), else append
   `- YYYY-MM-DD ({NNN}-{slug}): <lesson>` (one line by default, a few
   lines when the failure mode needs them; remove the `_None yet._`
   placeholder on first real append); (c) no matching skill → leave it in
   STATE.md and flag in CRITIQUE.md: "no skill home — human decides:
   CLAUDE.md, new skill, or drop"; (d) lesson too big for a bullet →
   append the short form and flag "consider promoting into the body" in
   CRITIQUE.md; (e) an existing lesson that looks stale or contradicted by
   code → report as a finding, do not delete or edit it.
3. Same step (or CRITIQUE.md output notes): require listing promotions
   made and duplicates skipped in CRITIQUE.md for human review.
Do NOT add the Discovered-vs-Pitfall litmus to critic.md (Decisions log:
the critic never classifies).
Done when: critic.md contains all three edits; the exception names drift
mode, append-only, and the exact section name `## Lessons (auto-appended)`;
sub-points (a)–(e) are all present; the litmus wording appears nowhere in
the file.
Skills: none (docs-only; read SPEC.md R3–R5/D3–D5, the STATE.md Decisions
log, and the current critic.md in full before editing)
Complexity: low

### T003 — four SKILL.md files: byte-identical Lessons section (R6)
Files: `.claude/skills/angular-conventions/SKILL.md`,
`.claude/skills/python-pipeline/SKILL.md`,
`.claude/skills/scheduling-domain/SKILL.md`,
`.claude/skills/testing-playbook/SKILL.md`
Append to the very end of each file (after ALL existing content — in
scheduling-domain that means after "Where the tests live"; its Recipe
section stays untouched) this exact block, preceded by one blank line:

    ## Lessons (auto-appended)

    Dated entries promoted from feature STATE.md Pitfalls by the critic's drift
    audit. Append-only; humans prune. If a lesson contradicts the body above,
    trust the code, then fix both.

    _None yet._

No other line in any of the four files changes (frontmatter descriptions
included).
Done when: `grep -c "^## Lessons (auto-appended)$" .claude/skills/*/SKILL.md`
shows exactly 1 per file; the appended block is byte-identical across all
four (e.g. `tail -7` of each file diffs clean pairwise); `git diff` for the
four files shows additions only.
Skills: none (docs-only mechanical append; the block above is the complete
specification — read SPEC.md R6 to confirm)
Complexity: medium

### T004 — STATE.md template: Pitfalls skeleton (R7)
Files: `.claude/templates/STATE.md`
After the existing `## Discovered` section (lines 22–23: heading +
`(empty)`), insert:

    ## Pitfalls
    (empty)

with a blank line before and after, so new features get the section without
the implementer improvising it. No litmus text in the template (Decisions
log: template stays a skeleton). No other change.
Done when: the template contains `## Pitfalls` followed by `(empty)`
directly after the Discovered section, and the diff touches nothing else.
Skills: none (docs-only; the insertion is fully specified above)
Complexity: low

### T005 — CLAUDE.md: mechanism paragraph (R8)
Files: `CLAUDE.md`
Under "SDD Harness Rules", insert a new paragraph immediately after the
`**Scope discipline:**` paragraph (line ~122):

    **Lessons capture:** while implementing, log durable gotchas in the
    feature's STATE.md under `## Pitfalls`, alongside `## Discovered`.
    Litmus: Discovered = "someone should fix this later" (out-of-scope
    work); Pitfall = "future me will trip on this again" (durable
    knowledge). The critic's end-of-feature drift audit append-promotes
    durable Pitfalls into the matching skill's `## Lessons (auto-appended)`
    section (dated, append-only, duplicates skipped); pruning and merging
    Lessons is human-only.

Done when: the paragraph exists in CLAUDE.md's SDD Harness Rules section;
its litmus sentence is character-identical to the one T001 put in
implementer.md; both section names match the canonical strings exactly.
Skills: none (docs-only; text fully specified above — verify placement
against the current CLAUDE.md before editing)
Complexity: low

### T006 — consistency read-through + paper dry-run (R9, Verification)
Files: none edited (fixes, if any, go back through the task that owns the
file); `specs/009-lessons-capture/STATE.md` Decisions log records the result.
Checklist, per the spec's Verification section:
1. `## Pitfalls` and `## Lessons (auto-appended)` appear with identical
   spelling in implementer.md, critic.md, CLAUDE.md, and the STATE.md
   template (grep each literal across the four docs).
2. The litmus wording is character-identical in exactly two files —
   implementer.md and CLAUDE.md — and absent from critic.md and the
   template (grep `future me will trip`).
3. critic.md's exception is scoped exactly (drift mode, append-only,
   Lessons section only) and does not contradict its remaining hard rules.
4. The four SKILL.md tails are byte-identical and sit after all prior
   content; scheduling-domain's Recipe section is unmodified.
5. Paper dry-run: take one real pitfall-like item from
   `specs/008-listening-comprehension-card/STATE.md` and walk it through
   critic.md's new drift instructions on paper, confirming each of
   (a)–(e) is executable without a judgment call the text doesn't cover.
Done when: all five checks pass and a dated Decisions-log line in this
feature's STATE.md records "R9 consistency read-through + 008 dry-run:
pass" (or a blocker is filed for the owning task).
Skills: none (verification-only; read SPEC.md Verification + R9 and all
eight changed files)
Complexity: low

## Testing strategy

No runtime surface; `npm run test` is unaffected (no task touches `web/` or
`server/`). Verification is the consistency read-through, mapped to
requirements:

- R1, R2 → T001 done-when (edits present, step count unchanged, litmus
  exact) + T006 checks 1–2.
- R3, R4, R5 → T002 done-when (exception scoping, (a)–(e) present, audit
  trail, no litmus) + T006 checks 3 and 5 (the (a)-branch for absent
  Pitfalls is exercised by the dry-run reading 008's pre-mechanism STATE.md).
- R6 → T003 done-when (byte-identical tails, additions-only diff) + T006
  check 4.
- R7 → T004 done-when + T006 check 1.
- R8 → T005 done-when + T006 check 2.
- R9 → T006 as a whole.

## Open questions

- Q2 (from SPEC.md) remains open: no /resume wording change planned; rescuing
  abandoned features' Pitfalls is left to humans, per the current lean.
