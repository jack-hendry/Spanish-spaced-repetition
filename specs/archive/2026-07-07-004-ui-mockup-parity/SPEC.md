# SPEC 004 — UI Mockup Parity

## Problem
Feature 003 shipped a dark theme and a real dashboard, but a side-by-side
comparison against a fresh set of target mockups shows the shipped UI still
diverges in structure. The navigation and deck list are split between the shell
and the dashboard column; the activity heatmap has no month/weekday labels, no
hover tooltip and an unlabelled legend; the Browse and Stats pages are only
theming-passes over their pre-redesign layouts. This feature is a refinement /
parity pass to close those gaps. Navigation semantics (Decks/Browse/Stats route
to the same places) are unchanged — this is restyle and re-layout, not
re-architecture.

## Goals
- Move the deck list and primary navigation into a persistent shell sidebar that
  looks and behaves like the target on every route.
- Upgrade both activity heatmaps (dashboard + Stats) with month/weekday labels,
  month gaps, a hover tooltip (date + count) and a labelled blue legend.
- Polish the dashboard forecast card to the target one-line + thin stacked-bar form.
- Rebuild the Browse page: search + result count, a FRONT/DECK/STATE/DUE table
  with state pills and relative due strings, row selection, and an EDIT CARD side
  panel (front/back/tags editing, Suspend + Save).
- Rebuild the Stats page: four stat cards with deltas, a last-14-days bar chart,
  answer-button percentages + true-retention line, and a year-in-review heatmap.

## Non-goals (OUT of scope — do not drift here)
- No scheduling, study-queue, on-disk, or server API-shape changes. Everything new
  is frontend-computed from `CollectionStore` + `ApiService.getRevlog()`, per
  CLAUDE.md. (Extending the existing `PATCH /api/notes/:id` usage to also send
  `tags` is a frontend store change only — the route already accepts `Partial<Note>`.)
- No routing changes. Routes in `app.routes.ts` (`/`, `study/:deckId`,
  `options/:optionsId`, `browse`, `stats`) stay exactly as they are.
- "Pause scheduling" stays a non-functional stub (a rendered button that does
  nothing / is disabled), as in 003.
- No new charting/heatmap dependency. Heat.js is a visual reference only; the
  heatmap stays hand-rolled in Angular templates.
- No product rename. App keeps the name "Spanish SRS"; mockup content
  ("Biology", "Recall", 12,371 cards) is illustrative only.
- No "add deck" / deck-creation feature (no such API exists).
- No change to the search query language in `core/search.ts` (`deck:`, `tag:`,
  `is:` still work) or to the 500-row render cap.

## Requirements

### A. Shell sidebar (app.html / app.ts / app.scss)
The deck list currently lives in the dashboard component (`features/deck-list`);
the target shows it in the sidebar on **all** routes. It therefore moves into the
shell so it persists across navigation.
1. The sidebar top shows a segmented (pill) control with three tabs — Decks,
   Browse, Stats — replacing the current "Spanish SRS" brand + vertical nav. The
   active tab reflects the current route (Decks = `/` exact). Tabs navigate to the
   same routes as today.
2. Below the tabs: an all-caps "DECKS" label with two small icon buttons on its
   right (search, add). See open questions Q1/Q2 for their behaviour.
3. Deck rows render for each top-level deck: a rounded color square
   (`deckColor()`), the deck name, and up to three right-aligned count pills —
   new (blue), learning (red), review (green) — from `DeckNode.total`. A pill is
   omitted when its count is zero. Rows use the roll-up totals already computed by
   `CollectionStore.deckTree()`.
4. Clicking a deck row starts that deck's study session (`/study/:deckId`).
5. Subdeck expand/collapse and the per-deck options (gear) affordance from the
   current dashboard must survive — see Q3 for placement.
6. A full-width "Study all due" button is pinned to the sidebar bottom, showing
   the total due count as a trailing pill, linking to `/study/all` (unchanged).
7. The dashboard (`/`) main area loses its deck-sidebar column and shows only the
   stat cards, heatmap, and forecast.
8. The sidebar and its states are unit- or render-testable from `CollectionStore`
   fixtures (pills hidden at zero, active-tab reflects route).

### B. Heatmap (dashboard + Stats "Year in review")
Applies to both the dashboard heatmap and the Stats year-in-review heatmap; build
once and reuse. Current grid is in `features/deck-list` (`buildYearGrid`,
`HeatCell`, 53×7) using `yearlyHeat` + `heatLevel` from `core/stats.ts`.
9. Month labels appear across the top, aligned over each month's first column;
   weekday labels (Mon…Sun, one per row) appear down the left.
10. A small horizontal gap separates each month's block of columns.
11. Hovering a day cell shows a tooltip with that day's date and review count
    (the level thresholds already exist as `heatLevel`).
12. The legend shows five swatches on the blue scale labelled with their numeric
    ranges: 0, 1–9, 10–19, 20–39, 40+ (matching `heatLevel`'s buckets).
13. A "Cards studied per day" caption sits under the grid (dashboard); the year
    selector is a styled button and the streak badge is an amber "🔥 N day streak"
    pill placed per the target. Colours come from the existing CSS custom
    properties in `styles.scss`; the scale is blue (not green).

### C. Dashboard forecast card (features/deck-list)
14. The forecast card shows a single line "N due · ~X min at your usual pace"
    (`totalDue()` + `estTimeMs()` already exist) and a thin rounded stacked bar
    split New (blue) / Learning (red) / Review (green) with a dot legend, from the
    existing `forecastSegments()`.

### D. Browse page (features/browser)
Existing: query-language search, 500-row cap, an edit panel that saves fields, and
Suspend — all reusable.
15. Header: a single search input placeholder "Search cards, tags, decks…" and, to
    its right, a muted count "M of N cards" (M = rendered matches, N = `totalCount()`).
16. Table columns FRONT / DECK / STATE / DUE. FRONT = the card's question text
    (cloze shown with "[…]"); DECK = deck leaf name, muted; STATE = a tinted pill
    (Review green, Learning red, Young amber, New blue — reuse `MATURE_THRESHOLD`
    to split young/mature if surfaced); DUE = a relative string ("today", "8 min",
    "2 days", "—" for new). A due-formatting helper is added to `core/stats.ts`
    (or a browser helper) and unit-tested.
17. Selecting a row highlights it and opens that note in the EDIT CARD panel.
18. The EDIT CARD panel shows a muted caption ("<deck> · <notetype> · due <when>"),
    labelled Front and Back textareas bound to the note's fields, editable Tag
    chips with an add-tag affordance, and pinned Suspend + Save buttons. Save
    persists fields **and** tags (extend the store's `saveNoteFields`/`patchNote`
    call to include `tags`); Suspend reuses `toggleSuspend`.

### E. Stats page (features/stats)
19. Four stat cards: (a) Reviews — 30 days, with a coloured "▲/▼ X% vs last month"
    delta; (b) Study time — 30 days (sum of `RevlogEntry.timeMs`), same delta form;
    (c) Current streak (days) with muted "best: N"; (d) Mature cards with muted
    "X% of collection". All values are frontend-computed from revlog + cards.
20. A "Reviews — last 14 days" bar chart (one blue bar/day via `reviewsByDay`,
    days=14), first bar date-labelled, today's bar highlighted.
21. An "Answer buttons" card: four horizontal bars on track backgrounds —
    Again/Hard/Good/Easy with right-aligned percentages (reuse `buttons()`), and a
    "True retention: R% over N reviews" line with the percentage coloured green.
22. A "Year in review — <year>" card reusing the section-B heatmap and its legend.
23. New pure helpers (best-ever streak; a period-over-period delta; a 30-day
    study-time sum) are added to `core/stats.ts` and unit-tested; the existing
    `dayStreak`, `reviewsByDay`, `buttonCounts`, `cardStateCounts` are reused.

## Open questions (recommended defaults in brackets)
- Q1 Sidebar search icon behaviour. [Navigate to `/browse` and focus its search
  input.]
- Q2 Sidebar add (⊕) icon. [Render disabled / stubbed — no deck-creation feature;
  note in non-goals.]
- Q3 Subdeck expand/collapse and per-deck options (gear) in the compact sidebar.
  [Keep expand/collapse (a disclosure toggle on parent rows); surface options via
  a small per-row affordance on hover linking to `/options/:optionsId`.]
- Q4 Browse "young vs new/review" pill granularity. Target shows a distinct
  "Young" pill; current `stateLabel` has no young/mature split. [Add a Young pill
  using `MATURE_THRESHOLD` for review cards under 21-day interval.]
- Q5 Stats month labels on the year-in-review heatmap. The Stats mockup omits
  them, but the global heatmap note (section B) asks for labels everywhere. [Use
  the same labelled heatmap on both pages for consistency.]
- Q6 Dropped current Stats content (card-counts stacked bar, future-due forecast).
  Target keeps neither. [Drop both from the Stats page; card-state counts remain
  available via Browse. Confirm at plan gate.]
- Q7 Delta baseline when there is no prior-period data (fresh installs). [Render
  the value with no delta line rather than a misleading "▲∞%".]
