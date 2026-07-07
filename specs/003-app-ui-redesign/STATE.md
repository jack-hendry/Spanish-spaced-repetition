# STATE: 003-app-ui-redesign

## Status
- **Phase:** implement   <!-- specify | plan | implement | done -->
- **Current task:** none (T004 done; T005 next)
- **Last updated:** 2026-07-07

## Original request
> I want to recreate the UI of our application to make something like this [Image #5]  [Image #6]

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] T001: Global dark theme + app shell nav
- [x] T002: Core stat helpers + deck-color, with unit tests
- [x] T003: Dashboard on `/`
- [x] T004: Study screen redesign
- [ ] T005: All-decks study session `study/all`
- [ ] T006: Theming pass on Browse, Stats, Options

## Decisions log
- 2026-07-06: Feature initiated: recreate the app UI to match two provided
  mockups (a dark-themed dashboard/deck-list screen and a dark-themed study
  screen). Images cannot be seen by the spec-writer subagent; a full written
  description of both mockups was passed to it in the delegation prompt.
- 2026-07-06: SPEC.md written by spec-writer (121 lines). Key finding: most of
  the mockup maps onto existing data — per-deck new/learning/review pills come
  from CollectionStore.deckTree(); grading-button interval previews already
  exist via Scheduler.preview() (scheduling/types.ts, rendered by review.ts);
  dashboard stats (studied today / time / pace / retention / heatmap / streak /
  forecast) are computable frontend-side from ApiService.getRevlog() + loaded
  cards, reusing web/src/app/core/stats.ts helpers. Genuinely new (flagged):
  deck color dots (no Deck field), a study-all-due session, session X-of-Y
  progress, a day-streak helper, and a yearly (vs current 30-day) heatmap
  window. Non-goals: no scheduling changes, no on-disk/API shape changes
  (prefer frontend computation), "Pause scheduling" stubbed, no Browse/Stats
  internals rework beyond theming, no rename to "Recall" unless confirmed.
  Open questions surfaced with recommended defaults (product name, study-all
  scoping, deck colors, Stats-vs-dashboard, empty-state on fresh installs,
  retention definition, unpaginated revlog volume). Phase advanced to plan;
  awaiting human review of SPEC + open questions before planning.

- 2026-07-06: Human resumed 003 past the spec gate (approval). Open questions
  resolved with the spec-writer's recommended defaults, to be revisited at the
  plan-review gate if wrong: (1) keep "Spanish SRS" name; (2) add `study/all`
  as frontend-only queue scoping; (3) derive deck-color dots from deck-name
  hash (no persistence); (4) keep the existing `stats` page (restyled) and
  build the dashboard on `/`; (5) empty heatmap/0-streak on fresh installs is
  acceptable; (6) reuse the existing all-buttons pass-rate for retention;
  (7) unpaginated `getRevlog()` is acceptable at current volume. Phase stays
  plan; delegating to planner.
- 2026-07-06: PLAN.md written by planner (6 tasks, T001–T006). No route change
  needed for study/all (existing `study/:deckId` already matches). No Discovered
  issues found. One in-scope assumption flagged for the plan-review gate: T005's
  all-decks session uses the default deck-options group (`deckOptions()[0]`) for
  session limits/scheduling — fine when decks share the default options group;
  cross-deck limits would be approximate if multiple distinct options groups are
  in active use. Phase advanced to implement, awaiting plan-review gate.
- 2026-07-06: Human resumed past the plan gate (Plan approved). T001 implemented
  by implementer (Sonnet). Changed only the four shell files: `styles.scss` (dark
  palette as CSS custom properties `--color-bg #0e0e10` / `--color-surface` /
  `--color-surface-alt` / `--color-border` / `--color-text` / `--color-text-muted`
  + accent + radius/font tokens for later reuse), `app.ts` (added RouterLinkActive;
  title stays "Spanish SRS"), `app.html` (persistent left sidebar shell with
  Decks `/` [exact] / Browse `/browse` / Stats `/stats`, inline SVG icons,
  router-outlet preserved), `app.scss` (dark sidebar styling, `.nav-link.active`
  accent). `npm run build -w web` succeeds; `npm run test -w web` 85/85 pass. No
  routes or feature components touched. Later tasks should reuse the styles.scss
  CSS variables.
- 2026-07-06: T002 implemented. Additive only to `core/stats.ts` (no existing
  export changed): `studiedToday`, `timeToday` (+`DayTime`), `pace`, `dayStreak`,
  `yearlyHeat` (+`HeatPoint`, takes absolute startDay/endDay), `heatLevel`
  (0/1–9/10–19/20–39/40+ → 0–4). New `core/deck-color.ts` `deckColor(name)` =
  djb2 hash → `hsl(hue,65%,55%)` (deterministic). Retention intentionally has NO
  new helper — reuse existing `buttonCounts` + the pass-rate formula already in
  `features/stats/stats.ts` inline in T003. New helpers take already-day-mapped
  inputs (numbers/DayTime), so T003 must map `entry.reviewedAt` via
  `todayNumber(collection, now)` before calling them (same idiom as `reviewsByDay`).
  Specs added: `stats.spec.ts` (widened; new describe blocks) + `deck-color.spec.ts`.
  `npm run test -w web` 103/103 pass (12 files); `npm run build -w web` clean.
  T003 UX note to resolve: `dayStreak` is literal ("consecutive days up to today
  with ≥1 review") — if today has 0 reviews yet, streak shows 0 even if yesterday
  had reviews; T003 may want to show yesterday's streak until the first review of
  the day. Decide during T003 (do not change the pure helper).
- 2026-07-06: T003 implemented (dashboard on `/`). The T003 implementer subagent
  was stopped mid-verification by the human; on review its edits to the three
  `features/deck-list` files (`.ts`/`.html`/`.scss`) were already complete, so
  the main session finished T003 inline rather than restarting. Two-column
  dashboard: left = deck sidebar reusing the existing expand/collapse
  (`visibleNodes`/`toggle`, tree collapsed to roots by default) with per-row
  `deckColor()` dot + new/learning/review pills from `DeckNode.total` + a
  "Study all due" footer linking to `/study/all` (target lives in T005; link only
  here); right = four stat cards (Studied today / Time / Pace / Retention),
  yearly activity heatmap (`yearlyHeat`+`heatLevel`, year selector + legend, 53
  cols), streak badge, and Today's-forecast panel (total due, est = due × pace,
  stacked New/Learning/Review bar). Revlog loaded via `ApiService.getRevlog()`;
  `entry.reviewedAt` mapped through `todayNumber(coll, …)` before the pure
  helpers, per the T002 note. Retention reuses the `features/stats` pass-rate
  formula inline (no new math). dayStreak morning-flash decision RESOLVED in the
  component (not the helper): `displayStreak` shows yesterday's streak until the
  first review of the day. Verified via a throwaway `_verify.spec.ts` render test
  (real + empty data) — all panels rendered with correct values; it was then
  deleted (plan scope has no deck-list component spec; testing strategy for T003
  is manual). One config change: bumped angular.json `anyComponentStyle`
  maximumWarning 4kB→6kB (error stays 8kB) because the larger dashboard SCSS is
  5.29kB — clears the only build warning. `npm run build -w web` clean (no
  warnings); `npm run test -w web` 103/103 pass (12 files).

- 2026-07-07: T004 implemented (study screen redesign). Changed only the three
  `features/review` files (`.ts`/`.html`/`.scss`), frontend only, no server/
  scheduling/queue changes. Top bar now shows "{deck} — {n} of {total}" + a thin
  session progress bar: added `answeredCount` + `sessionTotal` signals in
  `review.ts`; `sessionTotal` captured once in `init()` after `queue.start(id)` as
  `startCounts.new+learning+review` (due count at session start, before loadNext);
  `answeredCount` incremented in `rate()`; computed `sessionN` (clamped
  `min(answeredCount+1, max(total,1))`) and `progressPct` drive the display. The
  old header tally pills were dropped from the template (progress bar replaces
  them) but the `counts` signal is left updating (harmless internal state). Tags
  threaded via a new `tags: string[]` on `RenderState`, populated from `note.tags`
  in `loadNext`; the card breadcrumb renders deck name + `· tags.join(', ')` when
  present. Four grading buttons restyled red/amber/green/blue with stacked
  label + `buttonLabel(rating)` preview + number-key badge; `preview`/`rate()`/
  `RATINGS`/`onKey` unchanged. Divider reused from the existing `afmt` `<hr
  id="answer">` (restyled in dark theme, not reimplemented). Helper line reads
  "space to flip · 1–4 to grade · − suspend": implementer deliberately did NOT add
  the plan's example "U undo" key because there is no undo feature and a global
  `u` keydown would corrupt type-in answers (Spanish text) — kept only the
  existing `-` suspend key. "All done" state restyled, not removed. `npm run build
  -w web` clean; `npm run test -w web` 103/103 pass (no new spec — T004 testing is
  manual per plan). Verified sessionTotal/answeredCount wiring by reading review.ts.

## Discovered
- Optional (not required by the plan): T003 shipped with no permanent automated
  component test for the dashboard (plan's T003 testing is manual-only). A
  corrected version of the scratch render spec could be added later if desired;
  note the mock must set `collection.lastUnburyDay` high (or flush the
  `PATCH /api/collection` that `CollectionStore.load()`→`unburyForNewDay()`
  fires) or the component's `init()` never resolves in a test harness.

## Next action
/resume to start T005 (All-decks study session `study/all`)

## Blockers
(none)
