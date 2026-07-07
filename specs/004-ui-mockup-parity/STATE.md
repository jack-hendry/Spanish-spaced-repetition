# STATE: 004-ui-mockup-parity

## Status
- **Phase:** implement   <!-- specify | plan | implement | done -->
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
- [x] Spec approved (human)
- [x] Plan written
- [ ] Plan approved (human)
- [ ] T001: Pure stat helpers + relative-due formatter (core/stats.ts + spec)
- [ ] T002: Heatmap grid-builder helper (new core/heatmap.ts + spec)
- [ ] T003: Shared `app-heatmap` component (shared/heatmap/)
- [ ] T004: Shell sidebar restructure + dashboard slimming (same task)
- [ ] T005: Dashboard adopts shared heatmap + polished forecast card
- [ ] T006: Browse rebuild + tag saving
- [ ] T007: Stats rebuild

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
- 2026-07-07: Human approved SPEC at the gate via /resume (open questions
  Q1–Q7 accepted with the spec-writer's recommended defaults, revisitable at
  the plan-review gate). Delegating to planner.
- 2026-07-07: PLAN.md written by planner (181 lines, 7 tasks T001–T007,
  dependency-ordered, frontend-only — no server/route/scheduling changes).
  Slicing: pure helpers (T001: bestStreak, periodDelta [null on empty
  baseline per Q7], sumTimeInRange, countInRange, formatRelativeDue), pure
  grid builder (T002: new core/heatmap.ts porting buildYearGrid + month-label
  indices), shared standalone app-heatmap component (T003: labels, month
  gaps, tooltip, blue labelled legend), shell restructure + dashboard aside
  removal IN THE SAME TASK so the deck list never double-renders (T004, the
  risky one; includes new app.spec.ts), dashboard heatmap/forecast adoption
  (T005), Browse rebuild + saveNoteFields tags extension (T006), Stats
  rebuild dropping card-counts/future-due per Q6 (T007). Notes: app.spec.ts
  must set CollectionStore signals directly, not call load() (unmockable
  PATCH /api/collection hangs the harness — carried from 003); totalDue is
  computed independently in shell and dashboard to avoid coupling. Every
  spec requirement (1–23) and Q1–Q7 default maps to a task. Phase advanced
  to implement, awaiting plan-review gate before T001.

## Discovered
(empty)

## Next action
review PLAN.md, then /resume to start T001

## Blockers
(none)
