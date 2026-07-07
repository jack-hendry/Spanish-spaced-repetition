# STATE: 004-ui-mockup-parity

## Status
- **Phase:** implement   <!-- specify | plan | implement | done -->
- **Current task:** T006
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
- [x] Plan approved (human)
- [x] T001: Pure stat helpers + relative-due formatter (core/stats.ts + spec)
- [x] T002: Heatmap grid-builder helper (new core/heatmap.ts + spec)
- [x] T003: Shared `app-heatmap` component (shared/heatmap/)
- [x] T004: Shell sidebar restructure + dashboard slimming (same task)
- [x] T005: Dashboard adopts shared heatmap + polished forecast card
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

- 2026-07-07: T001 done. Added `bestStreak`, `periodDelta`, `sumTimeInRange`,
  `countInRange`, `formatRelativeDue` to `core/stats.ts`, all unit-tested in
  `core/stats.spec.ts`. Notable implementation choices not spelled out
  verbatim in PLAN/SPEC: (1) `formatRelativeDue`'s review-card day math
  clamps overdue cards to "today" via `Math.max(0, due - today)`, mirroring
  the existing `dueForecast` clamp convention, rather than emitting a
  negative day count; (2) the learning-card branch compares `card.due`
  directly against the `now` param in the same units as `ReviewContext.now`
  (epoch **ms**, per `scheduling/types.ts` and how `study-queue.service.ts`
  actually compares `card.due <= ctx.now`) — this contradicts the stale
  `due: epoch seconds` comment on the server's `Card.due` field
  (`server/src/models/index.ts` line 84) and the PLAN.md task text, which
  both say "epoch seconds" for learning cards; the codebase's real scheduling
  code has never used seconds there. Left the stale comment alone (out of
  scope for this task) but noting it here since a future task/spec author
  should reconcile the comment with reality.

- 2026-07-07: T002 done. Added `web/src/app/core/heatmap.ts` (NEW), exporting
  `HeatCell` (moved verbatim from `features/deck-list/deck-list.ts`),
  `MonthLabel { name; weekIndex }`, `HeatGrid { weeks; months }`, and
  `buildHeatGrid(reviewDays, collection, year)` — a straight port of
  `DeckList.buildYearGrid`'s Sun-anchored 7-row-week grid maths (jan1/dec31
  padded out to whole weeks via `getDay()`, `todayNumber` mapping the grid's
  start/end dates to day numbers, `yearlyHeat`+`heatLevel` from `core/stats.ts`
  filling counts/levels, `inYear` marking padding cells outside the target
  calendar year), plus new logic recording each month's first in-year cell's
  week (column) index for month labels/gaps. `buildHeatGrid(reviewDays, null,
  year)` returns `{ weeks: [], months: [] }` (mirrors the original's `if
  (!coll) return []` guard, extended to the new return shape). Added
  `web/src/app/core/heatmap.spec.ts` (NEW, 6 `it`s under one `describe`)
  asserting: null-collection short-circuit; 53 weeks for 2024 (leap year,
  Jan-1-is-Monday case) with every week 7-cells Sun..Sat; 54 weeks for 2028
  (the rarer leap-year-starting-Saturday case, found by brute-forcing
  2016-2040 in Node, where padding spills a 54th week — included so the
  week-count test isn't just re-deriving the one case already used
  elsewhere); first/last-week `inYear` padding correctness plus a total
  inYear-cell count of 366 for 2024; a review-count/`heatLevel` mapping
  smoke test (12 reviews on Jan 1 -> count 12, level 2); and 12 ascending
  `months` entries with names `Jan`..`Dec`, `months[0].weekIndex === 0`.
  Implementation choices not spelled out verbatim in PLAN.md: (1) imports
  `todayNumber` from `core/collection.store.ts` (same as the original
  `deck-list.ts` did) rather than duplicating it — this pulls in
  `CollectionStore`'s `@Injectable`-decorated class as a side effect of the
  module import, but since the test only calls the plain `todayNumber`
  function (no DI/TestBed needed), `heatmap.spec.ts` runs as a plain vitest
  unit test, matching the "pure helper" framing in PLAN.md; (2) month
  detection scans `weeks` in order and, within each week, cells in order,
  taking the first occurrence of each `cell.date.getMonth()` for `inYear`
  cells only — this is safe because `cells` (and therefore each 7-cell week
  chunk) is built by a single date cursor incrementing one day at a time
  chronologically start-to-end, so a single forward scan naturally yields
  both "first in-year cell of the month" and ascending `weekIndex` order
  with no separate sort needed. Did NOT touch `deck-list.ts` (its inline
  `buildYearGrid`/`HeatCell`/etc. are untouched duplicates for now; removal
  is T005 per plan). `npm run test -w web`: 13 test files, 130 tests, all
  passed (up from 124 pre-T002, i.e. the 6 new heatmap tests).

- 2026-07-07: T003 done. Added `web/src/app/shared/heatmap/heatmap.{ts,html,scss}`
  (NEW), a standalone `app-heatmap` component (`imports: []`, `selector:
  'app-heatmap'`) with three **signal inputs** — `reviewDays =
  input.required<number[]>()`, `collection = input.required<Collection |
  null>()`, `year = input.required<number>()` — feeding a `grid = computed(()
  => buildHeatGrid(...))`. This is the first component in the codebase to use
  Angular signal `input()` (no prior `@Input`/`input()` precedent existed in
  `features/`); chose `.required()` over defaults since all three values are
  meaningless individually and callers (T005/T007) will always supply real
  ones. `Collection` imported from `../../core/models` (matches the
  `features/*` import-path convention one directory shallower). Implementation
  choices not spelled out verbatim in PLAN/SPEC: (1) `core/heatmap.ts`'s
  `HeatGrid.weeks` rows are Sun-anchored (row 0 = Sun … 6 = Sat, per T002's
  own docstring/tests) but Req 9 asks for "Mon…Sun" labels down the left, so
  the component reorders for **display only** via a `ROW_ORDER = [1, 2, 3, 4,
  5, 6, 0]` map (`orderedCell(week, displayRow)`) rather than changing the
  core grid-builder (out of scope, T002 is done); (2) month gaps (Req 10) are
  built as real empty CSS Grid column tracks — `weekColumns()` computes a
  1-based grid column per week, inserting a narrow 6px spacer track before
  every month boundary after the first (via `grid-template-columns` built in
  `gridTemplateColumns()`), and month labels + day cells are placed with
  explicit `[style.grid-column]`/`[style.grid-row]` rather than DOM order, so
  the "gap" is a genuine grid track (not a margin hack) and month labels
  align exactly over their first column with no separate pixel math; (3) the
  heat scale reuses the existing `--color-accent-blue` custom property via
  `color-mix(in srgb, var(--color-accent-blue) N%, var(--color-surface-alt))`
  for levels 1–3 and the bare var for level 4, rather than hardcoding new
  rgba literals (the old inline `deck-list.scss` heatmap hardcoded
  `rgba(79, 141, 253, N)`, which is numerically `--color-accent-blue`'s hex
  `#4f8dfd` — `color-mix` reuses the actual custom property per the task's
  "do not hardcode new colors" instruction; this is the first `color-mix`
  usage in the codebase, no browser-support concerns since the app targets
  evergreen browsers only). Added `heatmap.spec.ts` (NEW, 3 `it`s, TestBed
  render tests following `app.spec.ts`'s existing convention: `setInput` on
  `fixture.componentRef` for the three signal inputs) asserting weekday
  labels are exactly `Mon..Sun`, the legend has 5 swatches labelled `0 / 1–9
  / 10–19 / 20–39 / 40+`, 12 month labels render for a populated year, day
  cells carry a `level-N` class, and a null `collection` input renders zero
  cells/month-labels (mirrors `buildHeatGrid`'s null-collection guard). Did
  **not** touch `deck-list.{ts,html,scss}` (inline heatmap stays until T005)
  or `core/heatmap.ts`/`core/stats.ts` (untouched, per constraints). Not
  wired into any route/component yet (that's T005/T007). `npm run build -w
  web`: clean. `npm run test -w web`: 14 test files, 133 tests, all passed
  (up from 13 files/130 tests pre-T003 — the 3 new heatmap render tests); the
  Angular test pipeline also type-checked the new component even though
  nothing imports it yet, confirming it compiles standalone.

- 2026-07-07: T004 done. `app.ts` now injects `CollectionStore` (+ `Router`)
  and ports `expanded`/`visibleNodes`/`totalDue`/`leafName`/`hasDue`/`colorFor`
  from the old `deck-list.ts` verbatim (same expand-by-default-top-level
  semantics); the shell's `constructor()` calls the same guarded
  `store.load()` deck-list used (`if (collection() === null) void load()`).
  `app.html` replaced the brand + vertical nav with: a 3-tab segmented pill
  (`.tabs`/`.tab`/`.tab--active`, `routerLink`+`routerLinkActive`, Decks exact-
  matched); a "Decks" label row with a search icon (`routerLink="/browse"`,
  Q1) and a `disabled` add `<button>` (Q2, non-functional per non-goals); deck
  rows now each an `<a class="deck-row" [routerLink]="['/study', deck.id]">`
  wrapping a disclosure `<span role="button">` twisty, the color dot, name,
  count pills (each wrapped in `@if (...> 0)` so zero-count pills don't
  render — Req 3), and a `<span class="gear" role="button">` that's
  `opacity: 0` until `.deck-row:hover` (Q3); a pinned `.study-all` anchor at
  the bottom linking `/study/all` with a trailing total-due count. Implementation
  choices not spelled out verbatim in PLAN/SPEC: (1) the twisty and gear are
  `<span role="button" tabindex="0">` rather than `<button>`, specifically to
  avoid nesting interactive `<button>` elements inside the row's outer `<a>`
  (invalid HTML5 — `<a>` must not contain interactive-content descendants);
  their `(click)` handlers (`onToggleClick`/`onGearClick` in `app.ts`) call
  `event.preventDefault()` + `event.stopPropagation()` so clicking them
  doesn't also trigger the row's `/study/:deckId` navigation, and `onGearClick`
  navigates programmatically via injected `Router` since it can't be a nested
  `routerLink` anchor either; (2) unlike the old deck-list's "Study" link,
  the row is **unconditionally** a study link now (Req 4 doesn't condition
  this on `hasDue`, unlike the old aside's `study--disabled` treatment) —
  `hasDue()` is still ported/kept (currently unused in the template) since
  a later task may want it, noted here rather than deleted to stay in scope;
  (3) `totalDue` is computed independently in `app.ts` off `deckTree()`,
  matching the plan's explicit "avoid coupling the shell to the dashboard"
  note — `deck-list.ts` keeps its own separate `totalDue` for the forecast
  card unchanged. Simultaneously removed the `<aside class="dashboard__decks">`
  block and all its backing TS (`expanded`/`visibleNodes`/`toggle`/
  `isExpanded`/`leafName`/`hasDue`/`colorFor`, the `DeckNode`/`deckColor`/
  `RouterLink` imports) and SCSS (`.dashboard__decks`, `.decks__head`,
  `.tree-scroll`, `.tree`, `.row`, `.twisty`, `.deck-dot`, `.name`, `.counts`,
  `.count`, `.study`, `.gear`, `.study-all*`) from `features/deck-list`; the
  dashboard's `<section class="dashboard__stats">` (stat cards + inline
  heatmap + forecast, all untouched per scope) is now the sole content of
  `.dashboard`, which dropped its flex-row layout for a single centered
  column (`max-width: 1000px`). Added `app.spec.ts` (replacing the old
  003-era "renders the brand" smoke test, which no longer applies since the
  brand+nav markup is gone): populates `CollectionStore` signals directly
  (never calls `load()`, per the carried-forward 003 gotcha) with a
  two-deck/one-card fixture (French has zero cards, Spanish has one new
  card) and asserts (a) the zero-count French row renders no `.count`
  elements while Spanish renders exactly one (`.count--new` = "1"); (b) the
  Decks tab is `.tab--active` on `/` and Browse is not; (c) after navigating
  to `/browse`, Browse becomes active and Decks does not. The route-active
  tests needed two things not obvious from other specs in this codebase
  (no prior render test exercised `routerLinkActive` here): `provideRouter`
  needed at least trivial stub routes for `''`/`'browse'`/`'stats'` (navigating
  to a URL with zero configured routes throws `NG04002: Cannot match any
  routes`), and `RouterLinkActive.update()` applies its classes inside a
  `queueMicrotask`, so each navigation needs `fixture.detectChanges()` +
  `await fixture.whenStable()` + a second `detectChanges()` before the
  active class is queryable in the DOM. `npm run build -w web`: clean.
  `npm run test -w web`: 14 test files, 135 tests, all passed (up from 133;
  net +2 since the old app.spec.ts had 2 tests and the new one has 4).

- 2026-07-07: T005 done. In `deck-list.ts`: imported/registered the shared
  `Heatmap` component (`imports: [Heatmap]`); added `readonly collection =
  this.store.collection` (mirrors the existing `readonly loading =
  this.store.loading` pattern) so the template can bind it; widened
  `reviewDays` from `private` to `readonly` (public) so `<app-heatmap
  [reviewDays]>` can read it; deleted the inline `HeatCell` interface, the
  `heatWeeks`/`heatmapTotal` computeds, `buildYearGrid`, and
  `formatCellDate`/`cellTitle` (all redundant now that `<app-heatmap>` owns
  grid-building/tooltips/legend internally), and dropped the now-unused
  `heatLevel`/`yearlyHeat` imports from `core/stats.ts`. Replaced
  `formatEstTime()` with `formatForecastLine(): string` → `"N due · ~X min at
  your usual pace"` (reusing `totalDue()` + `formatDuration()`), degrading to
  just `"N due"` when `estTimeMs()` is `null` (no pace baseline yet today —
  a fallback not spelled out in the plan). In `deck-list.html`: swapped the
  inline heatmap block for `<app-heatmap [reviewDays]="reviewDays()"
  [collection]="collection()" [year]="selectedYear()" />` plus a
  `.heatmap-caption` "Cards studied per day" line beneath it (dropped the old
  "{{ heatmapTotal() }} reviews in {{ selectedYear() }}" line, superseded by
  the caption); kept the `<h3>Activity</h3>`, amber streak badge, and
  `<select class="year-select">` unchanged. Forecast panel's two-stat block
  (Total due / Est. time) became a single `<p class="forecast-line">{{
  formatForecastLine() }}</p>`; the stacked bar + dot legend were left as-is
  (already matched the target). In `deck-list.scss`: removed dead rules
  (`.heatmap*`, `.level-0`..`.level-4` old hardcoded rgba scale,
  `.heatmap-legend`, `.forecast-stats`/`.forecast-stat*`, orphaned `.muted`),
  merged `.stat-card__label`/`.forecast-stat__label` and
  `.stat-card__value`/`.forecast-stat__value` down to the `.stat-card__*`
  half, added `.heatmap-caption`/`.forecast-line`, and restyled
  `.streak-badge` as an amber pill via `color-mix(in srgb,
  var(--color-accent-amber) 16%, transparent)` — first UI use of
  `--color-accent-amber`, no new color literals, following T003's
  `color-mix` convention. Implementation choices not spelled out verbatim:
  (1) streak pill text is literally `"🔥 N day streak"` per Req 13's quoted
  string, dropping the old singular/plural "day"/"days" logic; (2)
  `formatForecastLine()` renders `~{{ formatDuration(ms) }}` (e.g. `"~1h
  20m"`) reusing the existing duration formatter rather than a literal `"N
  min"` string — Req 14's wording treated as illustrative, not a format
  spec; (3) the "Cards studied per day" caption sits below the heatmap grid
  rather than above (minor placement call, plan only said "around it"). No
  `deck-list.spec.ts` exists, so no spec update was needed; grepped the repo
  to confirm no other file referenced the deleted symbols. `npm run build -w
  web`: clean. `npm run test -w web`: 14 test files, 135 tests, all passed —
  unchanged from the T004 baseline (T005 added no new independently-testable
  pure logic).

## Discovered
- `server/src/models/index.ts` (Card.due doc-comment, line ~84) says
  "learning: epoch seconds" but every actual scheduler
  (`web/src/app/core/scheduling/{sm2,fsrs}.ts`) and consumer
  (`study-queue.service.ts`) treats learning `due` as epoch **milliseconds**
  (`ctx.now + delayMin * 60_000`, compared via `card.due <= ctx.now` where
  `ctx.now` is `Date.now()`-scale ms). The doc comment is misleading and
  should probably be corrected in a future pass; not fixed here per scope
  discipline.

## Next action
/resume to start T006 (Browse rebuild + tag saving)

## Blockers
(none)
