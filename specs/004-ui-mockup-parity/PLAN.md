# PLAN 004 — UI Mockup Parity

## Approach
This is a frontend-only restyle/re-layout pass. Nothing in `server/`, no routes,
no scheduling, no on-disk shape changes. All new data is computed in the browser
from `CollectionStore` (already loaded cards + rolled-up `deckTree()`) and
`ApiService.getRevlog()`, exactly as feature 003 did. New maths goes into pure,
unit-tested helpers in `core/`; components stay thin.

Two shared assets are built once and reused. (1) New pure helpers in
`core/stats.ts` (best-ever streak, period-over-period delta, a windowed
time/review sum, and a relative-due formatter). (2) A standalone `app-heatmap`
component backed by a pure grid-builder in a new `core/heatmap.ts`, replacing the
inline `buildYearGrid`/`HeatCell` code in `deck-list` and serving both the
dashboard and the Stats "Year in review" card with month/weekday labels, month
gaps, per-cell tooltip and a labelled blue legend.

The riskiest change is the shell. The deck list currently lives in the dashboard
column of `features/deck-list`; the target wants it in a persistent sidebar on
every route, so the tree logic (expand/collapse, pills, color squares, gear,
"Study all due") moves into `app.*`, which must now consume `CollectionStore`.
To avoid the deck list rendering twice or nowhere, the sidebar restructure and
the dashboard's loss of its aside column land in the **same** task (T004); the
dashboard keeps its existing inline heatmap/forecast until T005 swaps them for the
shared component and polished card. Ordering therefore: helpers → heatmap →
shell+dashboard-slim → dashboard adoption → Browse → Stats.

## Files affected
- `web/src/app/core/stats.ts` — add `bestStreak`, `periodDelta`, `sumTimeInRange`, `countInRange`, `formatRelativeDue` (T001).
- `web/src/app/core/stats.spec.ts` — extend with tests for the new helpers (T001).
- `web/src/app/core/heatmap.ts` — NEW: `buildHeatGrid()` + `HeatCell`/`MonthLabel`/`HeatGrid` types (T002).
- `web/src/app/core/heatmap.spec.ts` — NEW: grid/month-label/gap tests (T002).
- `web/src/app/shared/heatmap/heatmap.{ts,html,scss}` — NEW standalone `app-heatmap` (grid + labels + tooltip + legend) (T003).
- `web/src/app/app.{ts,html,scss}` — shell gains segmented tabs, deck rows, expand/collapse, gear-on-hover, pinned "Study all due", search/add icons (T004).
- `web/src/app/features/deck-list/deck-list.{ts,html,scss}` — drop the deck aside; keep stat cards, heatmap, forecast (T004); adopt `app-heatmap` + polish forecast card (T005).
- `web/src/app/app.spec.ts` — NEW render test (pills hidden at zero; active tab) (T004).
- `web/src/app/features/browser/browser.{ts,html,scss}` — rebuild: count, FRONT/DECK/STATE/DUE table, selection, EDIT CARD panel with tags (T006).
- `web/src/app/core/collection.store.ts` — extend `saveNoteFields` to also send `tags` (T006).
- `web/src/app/features/stats/stats.{ts,html,scss}` — rebuild: stat cards + deltas, 14-day chart, answer buttons, year-in-review heatmap (T007).

## Tasks

### T001 — Pure stat helpers + relative-due formatter
Add to `core/stats.ts`: `bestStreak(reviewDays)` (longest consecutive-day run,
not just the trailing one); `periodDelta(current, previous): number | null`
(rounded % change, **null when `previous === 0`** per Q7); `sumTimeInRange(entries: DayTime[], startDay, endDay)`; `countInRange(reviewDays, startDay, endDay)`;
`formatRelativeDue(card, today, now)` → `"—"` for new, `"today"`/`"N days"` for
review (via `due` day-number minus `today`), `"N min"`/`"today"` for learning
(via `due` epoch-seconds minus `now`). Extend `stats.spec.ts`.
Files: `core/stats.ts`, `core/stats.spec.ts`.
Done when: `npm run test -w web` passes with new describe blocks for all five helpers (incl. the `previous===0 → null` case).
Covers: Req 16 (due string), 19, 23; Q7.

### T002 — Heatmap grid-builder helper
NEW `core/heatmap.ts`: move `HeatCell` here and add `MonthLabel { name; weekIndex }`
and `HeatGrid { weeks: HeatCell[][]; months: MonthLabel[] }`. `buildHeatGrid(reviewDays, collection, year): HeatGrid` ports the current `buildYearGrid` maths
(Sun-anchored 7-row weeks, `todayNumber` date mapping, `yearlyHeat`+`heatLevel`,
`inYear` padding) and additionally records, for each month, the column index of
its first in-year cell (for top labels + month gaps).
Files: `core/heatmap.ts`, `core/heatmap.spec.ts` (NEW).
Done when: unit tests assert week count, `inYear` padding, and that `months` has
12 entries with ascending `weekIndex`; `npm run test -w web` passes.
Covers: Req 9, 10 (data side).

### T003 — Shared `app-heatmap` component
NEW standalone `shared/heatmap/heatmap.{ts,html,scss}`, `selector: app-heatmap`,
inputs `reviewDays: number[]`, `collection: Collection | null`, `year: number`.
Consumes `buildHeatGrid`. Renders: weekday labels (Mon…Sun) down the left, month
labels across the top aligned to each month's first column, a small gap between
month blocks, day cells with `level-0..4` blue classes and a `title` tooltip
(date + count via a `cellTitle`), and a five-swatch legend labelled `0 / 1–9 /
10–19 / 20–39 / 40+`. Blue scale from existing CSS custom properties in
`styles.scss` (not green).
Files: `shared/heatmap/heatmap.{ts,html,scss}`.
Done when: `npm run build -w web` is clean and the component renders standalone
(verified by temporary host or in T005/T007). Testing: build + manual (grid maths
already covered by T002).
Covers: Req 9–12 (and 13 legend/scale).

### T004 — Shell sidebar restructure + dashboard slimming (SAME task)
`app.ts`: inject `CollectionStore`; ensure loaded (guarded `store.load()`); port
from `deck-list.ts` the `expanded`/`toggle`/`visibleNodes`/`leafName`/`colorFor`/
`hasDue`/`totalDue` logic. `app.html`: replace brand+vertical nav with a
segmented pill control (Decks `/` exact, Browse, Stats via `routerLink`+
`routerLinkActive`); a "DECKS" label row with two small icon buttons — search
(navigate `/browse`, Q1) and add (rendered **disabled**, Q2); deck rows with a
rounded `deckColor()` square, name, right-aligned new/learning/review pills
(**pill omitted when its count is 0**, Req 3), a disclosure twisty on parent rows
(Q3), a gear affordance shown on row hover linking `/options/:optionsId` (Q3), the
whole row linking `/study/:deckId` (Req 4); a full-width pinned "Study all due"
button at the sidebar bottom with a trailing total-due pill → `/study/all`.
Simultaneously **remove the deck `<aside>` column** from `deck-list.html`/`.ts`/
`.scss` so the dashboard main area shows only stat cards + heatmap + forecast
(Req 7). Leave the dashboard's existing inline heatmap/forecast as-is for now.
Files: `app.{ts,html,scss}`, `features/deck-list/deck-list.{ts,html,scss}`, `app.spec.ts` (NEW).
Done when: `app.spec.ts` render test (store signals set directly — see Notes)
proves zero-count pills are absent and the active tab matches the route; deck list
appears only in the sidebar (not the dashboard); `npm run build -w web` clean and
`npm run test -w web` green.
Covers: Req 1–8; Q1, Q2, Q3.

### T005 — Dashboard adopts shared heatmap + polished forecast card
In `deck-list`: replace the inline `heatmap`/`buildYearGrid`/`HeatCell` block with
`<app-heatmap>`, keeping the styled year-selector button, the amber
"🔥 N day streak" pill, and a "Cards studied per day" caption around it (Req 13).
Rework the forecast card to the target: one line `"N due · ~X min at your usual
pace"` (reuse `totalDue()` + `estTimeMs()`), a thin rounded stacked bar
New/Learning/Review from `forecastSegments()`, and a dot legend (Req 14). Remove
now-dead heatmap helpers/imports from `deck-list.ts`.
Files: `features/deck-list/deck-list.{ts,html,scss}`.
Done when: dashboard renders the shared heatmap (labels/tooltip/legend) and the
one-line forecast + thin bar; `npm run build -w web` clean. Testing: build + manual.
Covers: Req 13, 14; Req 9–12 on the dashboard.

### T006 — Browse rebuild + tag saving
`collection.store.ts`: change `saveNoteFields(id, fields, tags?)` to send
`{ fields, tags }` in the existing `patchNote` call (route already accepts
`Partial<Note>`). `browser.ts`: header shows one search input (placeholder
"Search cards, tags, decks…") + muted "M of N cards" (`matches().length` /
`totalCount()`); split the STATE label with `MATURE_THRESHOLD` so review cards
< 21-day interval read "Young" (Q4/Req 16); compute a per-row DUE string via
`formatRelativeDue` (T001); row selection sets `editingId` and highlights the row.
`browser.html`: FRONT (question text, cloze shown as "[…]" — reuse `clozeOrds`/
strip to detect cloze) / DECK (muted leaf) / STATE (tinted pill) / DUE columns; an
EDIT CARD panel with a muted "<deck> · <notetype> · due <when>" caption, labelled
Front/Back textareas, editable tag chips with an add-tag input, and pinned Suspend
(reuse `toggleSuspend`) + Save (persists fields **and** tags). Keep the 500-row cap
and `parseQuery` unchanged.
Files: `core/collection.store.ts`, `features/browser/browser.{ts,html,scss}`.
Done when: editing a note's tags + fields and saving round-trips through
`saveNoteFields`; STATE shows a Young pill; DUE shows relative strings;
`npm run build -w web` clean, `npm run test -w web` green. Testing: build + manual;
the store signature change is exercised by the existing search spec build.
Covers: Req 15–18; Q4.

### T007 — Stats rebuild
`stats.ts`/`stats.html`: replace the page with four stat cards — (a) Reviews (30d,
via `countInRange` over reviewDays) with a coloured "▲/▼ X% vs last month"
(`periodDelta`, **no delta line when null**, Q7); (b) Study time (30d, `sumTimeInRange`)
same delta; (c) Current streak (`dayStreak`) with muted "best: N" (`bestStreak`);
(d) Mature cards (`cardStateCounts`) with muted "X% of collection". Then a
"Reviews — last 14 days" bar chart (`reviewsByDay`, days=14; first bar
date-labelled, today's bar highlighted), an "Answer buttons" card (reuse
`buttons()` bars with right-aligned %, plus a "True retention: R% over N reviews"
line with R coloured green), and a "Year in review — <year>" card using
`<app-heatmap>` + its legend (Q5). **Drop** the old card-counts stacked bar and
future-due forecast (Q6). Extend `stats.spec.ts` only if new inline maths appears
(prefer reusing T001 helpers so none does).
Files: `features/stats/stats.{ts,html,scss}`.
Done when: the four cards, 14-day chart, answer-button %s, retention line and
year-in-review heatmap render; card-counts/future-due are gone; `npm run build -w
web` clean, `npm run test -w web` green. Testing: helpers unit-tested in T001;
page is build + manual.
Covers: Req 19–23; Q5, Q6, Q7.

## Testing strategy
- Req 16/19/23 + Q7: unit-tested pure helpers in `stats.spec.ts` (T001).
- Req 9–12 (heatmap geometry): unit-tested via `heatmap.spec.ts` (T002); visual
  chrome (labels/tooltip/legend) is build + manual (T003).
- Req 1–8 + Q1–Q3: `app.spec.ts` render test asserts zero-count pills hidden and
  active-tab-vs-route (T004); rest build + manual.
- Req 13, 14, 15, 17, 18, 20, 21, 22 + Q4/Q5/Q6: build (`npm run build -w web`) +
  manual walkthrough of `/`, `/browse`, `/stats` against the mockups.
- Full suite `npm run test -w web` must stay green after every task.

## Notes / Discovered (log, do not fix inline)
- `app.spec.ts` must populate `CollectionStore` by setting its signals directly
  (do **not** call `load()`): `load()` → `unburyForNewDay()` fires a
  `PATCH /api/collection` that hangs an un-mocked test harness (see 003 STATE
  "Discovered"). Set `collection`/`decks`/`cards` fixtures so `deckTree()` computes.
- `totalDue` is cheap off `deckTree()`; compute it independently in both the shell
  (T004) and the dashboard forecast (T005) rather than sharing state — avoids
  coupling the shell to the dashboard component.
- After T004 the shell owns `store.load()`; the guarded `load()` calls left in
  `browser`/`stats`/`review`/`deck-list` remain harmless (the `loading()` guard
  dedupes) — left as-is to keep each route independently loadable.
- Q1 "focus the Browse search input" is satisfied minimally by autofocusing the
  Browse input on init; the sidebar search icon only needs to `routerLink`
  `/browse`. If deeper focus-on-demand is wanted, revisit — not planned here.
- Cloze FRONT rendering (T006) reuses `core/templating/cloze.ts`; no new cloze
  logic — detect cloze fields and substitute "[…]" for the display string only.
