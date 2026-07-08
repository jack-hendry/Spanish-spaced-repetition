---
description: Start a new feature through the SDD pipeline
argument-hint: <feature description>
---

## Step 0: Validate input

If $ARGUMENTS is empty, ask the user to describe the feature in one or
two sentences. Do not invent a feature from conversation context.

Before creating anything, glob specs/*/STATE.md and check whether any
existing feature (phase != done) already covers this request. If one
plausibly does, ask the user whether to resume that feature instead of
creating a duplicate.

## Step 1: Create the feature directory

- Determine the next number: list specs/, find the highest NNN prefix,
  increment (start at 001 if specs/ is empty or missing)
- Slugify the feature into 3-5 words: lowercase, hyphens, no stop words
  (e.g. "add rate limiting to the API" → 004-api-rate-limiting)
- Create specs/{NNN}-{slug}/

## Step 2: Initialize STATE.md

Copy .claude/templates/STATE.md to specs/{NNN}-{slug}/STATE.md and
fill in the placeholders:

- Title: {NNN}-{slug}
- Phase: specify
- Last updated: today's date
- Original request: $ARGUMENTS verbatim
- Next action: "spec-writer produces SPEC.md"

Leave every checkbox unchecked.

## Step 3: Delegate to spec-writer

Invoke the spec-writer subagent with:
- The output path: specs/{NNN}-{slug}/SPEC.md
- The original request verbatim
- Any relevant constraints the user stated in conversation
  (pass them explicitly — the subagent cannot see this conversation)

## Step 4: Close out the phase

When spec-writer returns:
1. Verify SPEC.md actually exists and is non-empty. If the subagent
   failed, record the failure under Blockers in STATE.md and stop.
2. Invoke the critic subagent with mode=spec and the feature directory.
   It writes specs/{NNN}-{slug}/CRITIQUE.md and returns a verdict.
   If the critic itself errors out, report that and continue — a
   failed critique never blocks the human gate.
3. Update STATE.md:
   - Set Phase: plan — this is what routes the next /resume to the
     planner. (Approval is recorded separately: /resume checks off
     "Spec approved (human)" when the user advances past the gate.)
   - Check off "Spec written"; leave "Spec approved (human)" unchecked
   - Next action: "review SPEC.md and CRITIQUE.md, then /resume to
     run planner"
   - Last updated: today
4. Report to the user: feature number, spec location, a 3-5 line
   summary of what the spec covers — especially the non-goals — and
   the critique verdict with any BLOCKER findings (point at
   CRITIQUE.md for the rest).
5. STOP. Do not run the planner. Do not offer to "just continue."
   Even on a REVISE verdict, stop — the user decides whether to
   re-describe the feature, hand-edit the spec, or accept it as is.