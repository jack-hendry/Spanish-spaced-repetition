# STATE: 004-ui-mockup-parity

## Status
- **Phase:** plan   <!-- specify | plan | implement | done -->
- **Current task:** none
- **Last updated:** 2026-07-07

## Original request
> This file explains the features /Users/jhend/Library/Mobile\ Documents/com\~apple\~CloudDocs/Personal/MAC\ anki.md [Image #1] [Image #2] [Image #3] [Image #4] [Image #5] [Image #6] [Image #7] [Image #8] [Image #9]

(The referenced file compares target mockups against the current app —
deck/dashboard page, sidebar, heatmap, Browse page, Stats page — with
notes: heatmap should get month/date labels like Heat.js and a hover
tooltip per day, and use the design's color legend; navigation between
Decks/Browse/Stats is functionally the same, only the UI differs.)

## Completed
- [x] Spec written
- [ ] Spec approved (human)
- [ ] Plan written
- [ ] Plan approved (human)
<!-- planner appends task checkboxes here: - [ ] T001: ... -->

## Decisions log
- 2026-07-07: Feature initiated. Builds on the completed 003-app-ui-redesign:
  this is a parity/refinement pass to close the visual + interaction gaps
  between the shipped dark redesign and the target mockups (9 reference
  images provided). Images cannot be seen by the spec-writer subagent; full
  written descriptions of every mockup and each current-vs-target diff will
  be passed in the delegation prompt.
- 2026-07-07: SPEC.md written by spec-writer (143 lines). Scope: (1) move the
  deck list into the persistent shell sidebar (segmented Decks/Browse/Stats
  control, color-dot deck rows with new/learning/review pills, pinned "Study
  all due") — the largest structural item, since the deck list currently
  lives inside features/deck-list, not the shell; (2) heatmap upgrade (month
  + weekday labels, month gaps, hover tooltip with date+count, blue 5-step
  legend with numeric ranges) on both the dashboard and stats year-in-review;
  (3) forecast card polish; (4) Browse rebuild (FRONT/DECK/STATE/DUE table
  with pills + relative due, row selection, EDIT CARD panel with front/back/
  tags + Suspend/Save); (5) Stats rebuild (stat cards with vs-last-month
  deltas, last-14-days chart, answer-button percentages + true retention,
  year-in-review heatmap). Key findings: RevlogEntry.timeMs exists so all new
  stats are frontend-computable; browse editing mostly exists (tag saving
  needs only a small CollectionStore.saveNoteFields change — server PATCH
  already accepts tags); search engine/500-cap stays as-is (chrome only).
  Non-goals: no server changes, no Heat.js dependency, "Pause scheduling"
  stays a stub, no rename to "Recall". Seven open questions with recommended
  defaults (sidebar search/add icons, subdeck expand + gear placement,
  young-pill granularity, stats-heatmap labels, dropping card-counts/
  future-due panels, empty-baseline deltas). Phase advanced to plan; awaiting
  human review of SPEC + open questions before planning.

## Discovered
(empty)

## Next action
review SPEC.md, then /resume to run planner

## Blockers
(none)
