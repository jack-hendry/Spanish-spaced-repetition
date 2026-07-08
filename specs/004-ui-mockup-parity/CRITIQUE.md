# CRITIQUE: 004-ui-mockup-parity
- **Mode:** plan
- **Date:** 2026-07-07
- **Verdict:** PASS WITH NOTES

## Findings
1. **[WARN]** T001 (PLAN.md:48–49) specifies the learning-card branch of
   `formatRelativeDue` as "via `due` epoch-seconds minus `now`", but the
   codebase stores learning `due` in epoch **milliseconds**: both schedulers
   write `due: ctx.now + delayMin * 60_000` (`web/src/app/core/scheduling/sm2.ts:76`,
   `fsrs.ts:101`) where `ReviewContext.now` is documented as "epoch ms"
   (`scheduling/types.ts:16`), and `study-queue.service.ts:101` compares
   `c.due <= ctx.now` directly. The plan is echoing the stale doc comment at
   `server/src/models/index.ts:84` ("learning: epoch seconds") rather than
   the real behaviour. Why it matters: T001's done-when is its own unit
   tests, which would be written to the same wrong unit and pass — the
   1000x-off "N min" strings would surface only at T006's manual walkthrough.
   (STATE.md confirms the implementer had to deviate from the plan text here.)
2. **[WARN]** T003's done-when is not self-contained: "renders standalone
   (verified by temporary host or in T005/T007)" defers real verification to
   later tasks, leaving a clean `npm run build -w web` as the only concrete
   criterion. A clean build does not demonstrate that the labels, month gaps,
   tooltip, or legend (the visual half of Reqs 9–12) actually render; a
   render test (as `app.spec.ts` gets in T004) was available and unplanned.
3. **[NIT]** Files affected (PLAN.md:36) marks `web/src/app/app.spec.ts` as
   NEW, but the file has existed since the initial commit (`47e37e1`); the
   plan's NEW convention elsewhere (heatmap.ts/spec, shared/heatmap) means
   "file does not exist". Should read "replaced/extended", not NEW.
4. **[NIT]** SPEC Q6 explicitly asks "Confirm at plan gate" for dropping the
   card-counts stacked bar and future-due forecast, but the plan bakes the
   drop into T007 without surfacing it as a question needing confirmation at
   the gate. Low risk (defaults were pre-accepted at the spec gate per
   STATE.md), but the requested confirmation prompt is missing.
5. **[NIT]** Testing strategy leans heavily on "build + manual" for Reqs 15,
   17, 18, 20–22, and T006's "store signature change is exercised by the
   existing search spec build" only proves compilation, not the tags
   round-trip. Acceptable for visual chrome, but the tags-persistence path
   (Req 18) is behavioural and could have had a cheap unit test.

## Verified clean
- Traceability is complete both directions: Reqs 1–8 → T004; 9–13 → T002/T003/T005;
  14 → T005; 15–18 → T006 (16 partially T001); 19–23 → T007 (T001 for helpers);
  Q1–Q7 each land in a named task. No orphan tasks.
- All other cited files/symbols exist: `MATURE_THRESHOLD`, `heatLevel`,
  `yearlyHeat`, `reviewsByDay`, `dayStreak`, `buttonCounts`, `cardStateCounts`
  (core/stats.ts); `saveNoteFields`, `deckTree`, `todayNumber`
  (collection.store.ts); `getRevlog` (api.service.ts); `totalDue`,
  `estTimeMs`, `forecastSegments` (deck-list.ts); `deckColor`, `parseQuery`,
  `clozeOrds`/`renderCloze`; `PATCH /notes/:id` accepts `Partial<Note>`
  (server/src/routes/index.ts:119–124); `RevlogEntry.timeMs`; the five routes;
  the `--color-accent-*` custom properties in styles.scss. NEW files are
  correctly flagged (modulo finding 3).
- Dependency order sound: helpers → grid → component → shell → dashboard →
  Browse → Stats; no task depends on a later one (T003's forward reference is
  a verification gap, finding 2, not an ordering fault).
- No non-goal violations: frontend-only, no route changes, no new
  dependencies, tags extension stays within the spec's carve-out, add-button
  stubbed per Q2.
- Budget: 181 lines, under the ~200 guideline.
