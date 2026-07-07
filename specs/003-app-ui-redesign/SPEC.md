# SPEC: App UI Redesign

## Problem

The Angular web app (`web/`) works but looks utilitarian: a light-theme deck
list (`features/deck-list/`), a plain review screen (`features/review/`), and a
separate charts page (`features/stats/`). The user wants a cohesive dark-theme
UI matching two mockups: a two-column **dashboard** (deck sidebar + stats panels)
as the home screen, and a focused **study screen**. This is a visual redesign
plus the thin derived-stat layer needed to populate it — not a scheduling or
data-model change.

## Goals

- Restyle the app to a dark, macOS-desktop aesthetic across all existing routes.
- Turn the home route (`/`) into a two-column dashboard: deck sidebar on the
  left, stat cards + activity heatmap + today's forecast on the right.
- Redesign the study screen (`study/:deckId`) to the mockup's card + 4-button
  layout, keeping existing flip/grade/undo keyboard behaviour.
- Populate dashboard stats from data the app already has (cards + revlog),
  computed on the frontend per project architecture.

## Non-goals (OUT of scope)

1. **No scheduling changes.** SM-2/FSRS math, queue ordering, daily limits,
   burying all stay as-is (`web/src/app/core/scheduling/`, `study-queue.service.ts`).
2. **No on-disk / API shape changes.** Prefer computing stats on the frontend
   from `GET /api/revlog` + loaded cards. A new **read-only** stats endpoint is
   allowed only if a computation proves infeasible client-side (see Open Q).
3. **"Pause scheduling" button is out of scope** — it is a real behavioural
   feature with no backing logic today. Render it disabled/stubbed only.
4. **No Browse/Stats internals rework.** The `browse` and `stats` route contents
   get the new theme (colors/typography/panels) but no new features or charts.
   Existing `stats` page may be superseded by the dashboard — see Open Q.
5. **No product rename** unless confirmed. Mockups say "Recall"; current title is
   "Spanish SRS" (`web/src/app/app.ts`, `app.html`). See Open Q.
6. **No new deck metadata** persisted (e.g. per-deck color) unless confirmed.

## Existing data availability (grounding)

- Per-deck **new/learning/review** counts, rolled up over subdecks:
  `CollectionStore.deckTree()` -> `DeckNode.total` (`core/collection.store.ts`).
- Total **due across all decks**: sum of `deckTree()` totals (frontend only).
- Study-button **interval previews** ("1 min / 8 min / 15 min / 4 days") already
  exist: `SchedulerFactory.for(opts).preview(...)` returns per-rating `label` +
  `intervalDays` (`scheduling/types.ts`); `review.ts` already renders them.
- Full **review log** is available via `ApiService.getRevlog()` (server returns
  the entire `revlog.ndjson`); each `RevlogEntry` carries `button`, `timeMs`,
  `reviewedAt` (`core/models`, used today by `features/stats/stats.ts`).
- Reusable stat helpers already exist in `core/stats.ts`: `reviewsByDay`,
  `dueForecast`, `buttonCounts`, `cardStateCounts`.
- **Not present today:** per-deck color; a "study all decks" session (the study
  route requires a real `deckId`); session "X of Y" progress tracking; a
  day-streak helper; a per-day heatmap over ~a year (existing `reviewsByDay`
  uses a 30-day window). All of these are derivable on the frontend from cards +
  revlog except deck color (see Open Q).

## Requirements

### Shell & theme
1. Apply a dark theme globally (near-black background ~#0e0e10, one-shade-lighter
   rounded panels, faint borders) via `web/src/styles.scss` + component styles;
   the light `body` colors there today are replaced.
2. The left sidebar exposes tabs **Decks / Browse / Stats** routing to `/`,
   `/browse`, `/stats`; the active tab is visually distinct. Existing routes in
   `app.routes.ts` are preserved (no route renames).

### Dashboard (home, `/`)
3. Sidebar lists decks with, per row: a leaf name and three count pills
   (new=blue, learning=red, review=green) from `DeckNode.total`. Hierarchical
   expand/collapse (existing `deck-list.ts` behaviour) is preserved.
4. A "Study all due" action pinned at the sidebar bottom shows the total due
   count and starts a study session spanning all decks (see Open Q for how).
5. Four stat cards render: **Studied today** (# revlog entries with
   `reviewedAt` in the current study-day), **Time** (sum of today's `timeMs`),
   **Pace** (time ÷ cards), **Retention** (pass-rate; reuse `stats.ts` logic).
   Each is a pure function over revlog/cards; zero-state renders "0"/"—".
6. An activity **heatmap** shows cards-studied-per-day (GitHub-style, blue
   intensity buckets 0 / 1–9 / 10–19 / 20–39 / 40+), with a year selector and a
   legend. Fed by a per-day rollup of revlog (extend `reviewsByDay` pattern to a
   yearly window). Sparse/empty history renders gracefully (all-grey grid).
7. A **day-streak** badge shows consecutive days (up to today) with ≥1 review,
   derived from the same per-day rollup.
8. A **Today's forecast** panel shows total due, an estimated time
   ("due × pace"), and a stacked New/Learning/Review bar with legend, from
   `deckTree()` totals.
9. All new stat computations live in `web/src/app/core/` (extend `core/stats.ts`)
   and are unit-testable pure functions; the server is not modified.

### Study screen (`study/:deckId`)
10. Top bar shows "{deck} — {n} of {total}" and a thin session progress bar.
    `total` = session due count at start; `n` = cards answered + 1 (new derived
    session state in the component/queue; no persistence).
11. The card panel shows a muted breadcrumb (deck name; a sub-topic from the
    note's tags if available), the rendered question, a divider, and the rendered
    answer on reveal. Card HTML still comes from `renderCard(...)` templates.
12. Four grading buttons (Again/Hard/Good/Easy = red/amber/green/blue), each
    stacking label + interval preview + number key, using the existing
    `preview` labels. Keyboard (space flip, 1–4 grade, U/− undo/suspend) keeps
    working as in `review.ts`.
13. A muted helper line ("space to flip · 1–4 to grade · U undo") appears at the
    bottom; existing "All done" completion state is restyled, not removed.

## Open questions

1. **Product name:** adopt "Recall" from the mockups, or keep "Spanish SRS"?
   Recommended default: keep "Spanish SRS" (rename is trivial to do later).
2. **Study-all-due:** add a reserved route/id (e.g. `study/all`) that seeds the
   queue across every deck, or defer and keep per-deck study only? Recommended:
   add `study/all` as frontend-only queue scoping (no data change).
3. **Deck color dots:** the model has no deck color. Derive a stable color from
   the deck name (hash), or omit dots for now? Recommended: derive (no persistence).
4. **Dashboard vs Stats page:** fold the existing `features/stats` page into the
   new dashboard, or keep both? Recommended: keep `stats` as-is (restyled) and
   build the dashboard on `/`, sharing `core/stats.ts` helpers.
5. **Heatmap/streak with no history:** fresh installs have little/no revlog.
   Confirm empty-state is acceptable (all-grey heatmap, 0-day streak). Recommended: yes.
6. **Retention definition:** reuse the existing all-buttons pass-rate, or
   restrict to review-type cards / a time window? Recommended: reuse existing.
7. **Revlog volume:** `getRevlog()` returns the whole log unpaginated; acceptable
   for the heatmap at current data sizes? Recommended: yes; revisit only if slow.
