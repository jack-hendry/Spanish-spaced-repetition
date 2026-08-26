# STATE: 004-ui-mockup-parity

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** none — feature complete
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
- [x] T006: Browse rebuild + tag saving
- [x] T007: Stats rebuild

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

- 2026-07-07: T006 done. `collection.store.ts`: `saveNoteFields(id, fields,
  tags?)` now sends `{ fields, tags }` in one `patchNote` call (was `{ fields }`,
  2-arg); passing `tags: undefined` when a caller omits it is harmless since
  `HttpClient`'s JSON body serialization drops `undefined` properties.
  `browser.ts` (full rewrite of component logic, public shape — `edit`/
  `cancelEdit`/`toggleSuspend`/`isSuspended`/`matches`/`totalCount`/
  `parseQuery`/500-row cap — reused verbatim): renamed `BrowserRow.question`→
  `front`, `state`(string)→`stateLabel`+`stateClass` (pill tint suffix:
  `new|learning|young|review|muted`), added `due` and `noteTypeName`.
  `stateInfo(card)` replaces `stateLabel()`: splits `review` into Young (amber,
  `interval < MATURE_THRESHOLD`) vs Review (green, mature) per Q4/Req16;
  suspended/buried both map to a neutral `muted` pill class (not one of
  Req16's four enumerated colors, so reused the existing "muted" convention
  rather than inventing a fifth accent color). `frontText(note, noteType,
  cardOrd)` reuses `clozeOrds` (to find which field carries cloze markup) and
  `renderCloze(text, cardOrd + 1, false)` (to render that card's own deletion
  hidden) rather than new cloze-stripping regex — for cloze note types this
  produces Anki's own `"[...]"` placeholder (three literal dots, not a unicode
  ellipsis — PLAN.md's "[…]" wording read as descriptive, not a literal format
  spec); non-cloze types keep the old "first non-empty field" fallback. `due`
  is computed once per row inside `allRows()` via `formatRelativeDue(card,
  today, Date.now())` (T001), not a live-ticking clock — only recomputes when
  the store's cards/notes signals change. Added `editingRow` computed
  (`allRows().find(note.id === editingId())`) as the single source of truth
  for the open panel, replacing separate `editingId()`/`store.notes()`
  lookups (small simplification, not spelled out in the plan). Added
  `draftTags`/`newTag` signals + `addTag()`/`removeTag()`; `edit()` seeds
  `draftTags` from `row.note.tags`; `saveEdit()` calls `saveNoteFields(id,
  this.draft(), this.draftTags())`. `browser.html`: header is now just the
  search input (placeholder "Search cards, tags, decks…", `autofocus` per
  Q1) + a muted "M of N cards" span — dropped the old `← Decks` back-link and
  separate "Showing…" paragraph since the shell's persistent sidebar (T004)
  already provides deck navigation and the plan's wording specified only
  those two header elements. Table is FRONT/DECK/STATE/DUE (dropped the old
  inline per-row Suspend-link action column — Suspend now lives only in the
  edit panel per the plan). Rows are `(click)="edit(row)"` on the whole
  `.trow`, `.trow--selected` highlight via `color-mix(in srgb,
  var(--color-accent) 12%, transparent)`. EDIT CARD panel gained a muted
  caption ("<deckLeaf> · <noteTypeName> · due <due>"), a Tags section (chips
  with per-chip ✕ remove + an add-tag input, Enter-to-add), and a two-button
  pinned footer (Suspend/Unsuspend + Save) — dropped the old standalone
  Cancel button since the plan specifies exactly "pinned Suspend + Save" and
  the header ✕ / backdrop-click already cancel. `browser.scss`: new
  `.pill`/`.pill--{new,learning,young,review,muted}` rules following T003/
  T005's `color-mix(in srgb, var(--color-accent-X) 16%, transparent)`
  convention (no new color literals); `.tags`/`.tag-chip`/
  `.tag-chip__remove`/`.tag-input`; `.trow--selected`; `.editor__caption`;
  grid columns changed from 4 cols (incl. action col) to `1fr 140px 110px
  90px` (FRONT/DECK/STATE/DUE). Removed the dead `.back` link rule and the
  old `.trow--suspended` red-tint rule (superseded by the STATE pill itself
  carrying that signal). Did not touch `core/stats.ts`, `core/heatmap.ts`,
  `shared/heatmap/`, `app.*`, or `features/deck-list/` (out of scope, already
  done). `npm run build -w web`: clean. `npm run test -w web`: 14 test files,
  135 tests, all passed — unchanged from the T005 baseline (T006 added no new
  independently-testable pure logic per PLAN.md's "build + manual" testing
  note; `formatRelativeDue`/`MATURE_THRESHOLD`/`clozeOrds`/`renderCloze` were
  already unit-tested in prior tasks and reused here unmodified).

- 2026-07-07: T007 done (final task). Rewrote `features/stats/stats.{ts,html,scss}` —
  full replacement of the pre-redesign page, not a diff. `stats.ts`'s public
  shape: `reviews30`/`reviewsDelta`, `studyTime30`/`studyTimeDelta`, `streak`/
  `best`, `states`/`totalCards`/`maturePct` for the four stat cards;
  `history: HistoryBar[]` for the 14-day chart; `buttons`/`reviewsTotal`/
  `retention` for the answer-buttons card (buttons/retention logic carried
  over unchanged from the old component — same `buttonCounts` + pass-rate
  formula); `reviewDays`/`collection`/`year` feeding `<app-heatmap>` directly,
  same wiring pattern as `deck-list.ts` (T005). Every new number reuses T001
  helpers exactly as planned: `countInRange`+`periodDelta` for (a)/(b)'s
  vs-last-month deltas (30-day window immediately followed by the prior
  30-day window, `[today-59, today-30]`, so the two ranges are contiguous and
  non-overlapping), `sumTimeInRange` for (b)'s value, `dayStreak`+`bestStreak`
  for (c), `cardStateCounts` for (d) — so, per the plan's own prediction,
  **no new inline maths landed** and `stats.spec.ts` was not created (there
  never was one; none was needed). Implementation choices not spelled out
  verbatim in PLAN/SPEC: (1) `toDelta(pct: number | null): Delta | null`
  reshapes `periodDelta`'s signed percentage into `{ value: abs, positive }`
  so the template can pick the ▲/▼ glyph and a `delta--up`/`delta--down`
  colour class (green/red via the existing `--color-accent-green`/`-red`
  custom properties) without doing sign arithmetic in the template; a `null`
  either from `periodDelta` (previous===0) simply renders no delta `<span>`
  at all, satisfying Q7 exactly ("no delta line when null", not a placeholder
  dash); (2) "coloured" was read as *both* directions get a colour (green up,
  red down), not just a highlight on increases — no spec/plan text said
  decreases should be neutral, and green/red up/down is the codebase's
  existing convention for good/bad (e.g. the pill palette); (3) the streak
  card uses the literal `dayStreak` (not `deck-list.ts`'s `displayStreak`
  yesterday-carry trick from T005) since the plan explicitly names
  `dayStreak` for this card, not the dashboard's UX massaging — a 0-until-
  first-review-today streak is arguably more "true" for a stats page anyway;
  (4) the 14-day chart's "first bar date-labelled" is a real calendar-date
  string (e.g. "Jun 24") computed by a small private `dateLabel(offset)`
  helper (`new Date(Date.now() + offset * 86_400_000)`, formatted via
  `toLocaleDateString`) — this is arithmetic, not a `core/stats.ts` helper,
  but judged to be display-only formatting (same category as `deck-list.ts`'s
  pre-existing untested `formatDuration`/`formatForecastLine`/`cellTitle` in
  `shared/heatmap/heatmap.ts`), not the kind of "new inline maths" the plan
  meant to gate behind a spec extension; "today's bar highlighted" is a pure
  CSS treatment (`.bar--today .bar__fill` at full `--color-accent-blue`
  strength vs. a `color-mix(... 45%, transparent)` muted tone for the other
  13 bars) rather than a label, per the plan's wording distinguishing "date-
  labelled" (text) from "highlighted" (visual); (5) answer-button rows now
  right-align `{{ b.pct }}%` (renamed the old `.brow__count`/`b.count` cell
  to `.brow__pct`/`b.pct`) instead of the old raw count, per Req 21's
  "right-aligned percentages"; (6) "True retention: R% over N reviews" only
  renders when `retention() !== null` (an explicit null-check, not `@if
  (retention(); as r)`, since a *true* 0% retention is a legitimate value
  that a truthy-check would incorrectly hide); (7) the "Year in review"
  heatmap has no year `<select>` (unlike the dashboard's T005 adoption) —
  neither PLAN.md's T007 text nor SPEC Req 22 mention a selector for this
  card, so `year` is a fixed `new Date().getFullYear()` component field, not
  a signal; revisit if a future pass wants parity with the dashboard's
  selector. Dropped per Q6: the old `stateSegments`/`stacked`/`.legend`
  card-counts bar and the `dueForecast`/`forecast`/`dueTotal` future-due
  panel, plus their now-dead SCSS (`.stacked`, `.seg--*`, `.dot`, `.legend`,
  `.bar__fill--due`/`--rev`) and the old `← Decks` header bar (dropped for
  the same reason T006 dropped browser's back-link — the persistent T004
  sidebar already provides navigation; grepped to confirm no other file
  referenced the deleted `RouterLink` import or symbols). `stats.scss` is a
  near-full rewrite reusing `deck-list.scss`'s `.stat-card`/`.panel` chrome
  class-for-class (duplicated rather than shared, consistent with this
  codebase's existing per-feature SCSS convention — no shared stylesheet
  module exists) plus new `.stat-card__delta`/`.chart-labels`/
  `.retention-line` rules, all via `color-mix()`/existing custom properties
  (no new colour literals, per constraints). `npm run build -w web`: clean.
  `npm run test -w web`: 14 test files, 135 tests, all passed — unchanged
  from the T006 baseline, confirming no regressions and no new pure logic
  needed a spec. `npm run test` (server + web): server 17/17, web 135/135,
  both green. This was the last task in PLAN.md; feature 004 is complete.

## Discovered
- `server/src/models/index.ts` (Card.due doc-comment, line ~84) says
  "learning: epoch seconds" but every actual scheduler
  (`web/src/app/core/scheduling/{sm2,fsrs}.ts`) and consumer
  (`study-queue.service.ts`) treats learning `due` as epoch **milliseconds**
  (`ctx.now + delayMin * 60_000`, compared via `card.due <= ctx.now` where
  `ctx.now` is `Date.now()`-scale ms). The doc comment is misleading and
  should probably be corrected in a future pass; not fixed here per scope
  discipline.

## Summary
Feature 004 closed the visual/interaction gaps between the 003 dark redesign
and the target mockups, frontend-only, with no server/scheduling/routing
changes. End to end it shipped: (1) two reusable data/UI building blocks —
pure helpers in `core/stats.ts` (`bestStreak`, `periodDelta`, `sumTimeInRange`,
`countInRange`, `formatRelativeDue`) and a full heatmap stack (`core/heatmap.ts`'s
`buildHeatGrid` + the standalone `shared/heatmap/app-heatmap` component with
month/weekday labels, month gaps, hover tooltips and a labelled blue legend)
now shared by both the dashboard and Stats; (2) a shell restructure moving the
deck list and Decks/Browse/Stats navigation out of the dashboard and into a
persistent `app.*` sidebar (segmented tabs, colour-dot deck rows with
zero-hidden count pills, subdeck expand/collapse, hover-revealed per-deck
gear, a pinned "Study all due" button) that now renders on every route; (3)
the dashboard (`features/deck-list`) slimmed to stat cards + the shared
heatmap + a polished one-line forecast card with a thin stacked bar; (4) a
rebuilt Browse page (`features/browser`) with a single search input + result
count, a FRONT/DECK/STATE/DUE table (state pills including a new Young/mature
split, relative due strings), row selection, and an EDIT CARD panel with tag
editing (`CollectionStore.saveNoteFields` extended to persist tags) plus
Suspend/Save; (5) a rebuilt Stats page with four delta-aware stat cards
(Reviews/Study time vs last month, Current streak with best-ever, Mature
cards with % of collection), a 14-day reviews bar chart, an answer-buttons
card with right-aligned percentages and a true-retention line, and a
year-in-review heatmap — dropping the old card-counts stacked bar and
future-due forecast per Q6. All seven open questions from SPEC.md (Q1–Q7)
were resolved with their recommended defaults during implementation. Full
suite is green: server 17/17, web 135/135 (up from the pre-004 baseline by
the T001–T003 unit tests plus the new `app.spec.ts`/`heatmap.spec.ts` render
tests); `npm run build -w web` clean throughout.

## Next action
Feature 004-ui-mockup-parity is complete — all 7 tasks done, build and full
test suite green. Run `/feature {description}` to start a new feature.

## Blockers
(none)
