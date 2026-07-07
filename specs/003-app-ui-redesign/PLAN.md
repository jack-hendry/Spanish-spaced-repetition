# PLAN: 003-app-ui-redesign

## Approach

This is a visual redesign plus a thin, frontend-only derived-stat layer. Per the
project's core rule, the server is untouched: every new number on the dashboard
is a pure function in `web/src/app/core/` over data the app already loads
(`CollectionStore.cards()`, `deckTree()`, and `ApiService.getRevlog()`). We reuse
the existing helpers in `core/stats.ts` (`reviewsByDay`, `dueForecast`,
`buttonCounts`, `cardStateCounts`) and the existing pass-rate for retention, and
we reuse `SchedulerFactory.for(opts).preview(...)` + `renderCard(...)` + the
keyboard handling in `review.ts` unchanged. No scheduling math, queue ordering,
daily-limit, or bury logic changes.

Two genuinely new pieces of frontend logic are needed and are kept small and
unit-tested: (a) a handful of pure stat helpers (studied-today count, time-today
sum, pace, a day-streak, a yearly heat rollup with intensity buckets) added to
`core/stats.ts`, plus a deterministic deck-name→color hash in a new
`core/deck-color.ts`; and (b) an all-decks study session. The all-decks session
is pure queue scoping: `StudyQueueService.startAll()` sets the subtree to every
deck id and reuses `remainingLimits(...)` against the default deck-options group,
so scheduling for each card is unchanged. The route `study/:deckId` already
matches `study/all` (deckId = `"all"`), so no route change is required.

Key decisions / tradeoffs: we keep the existing `features/stats` page (restyled
only) and build the dashboard by extending the existing `features/deck-list`
component so its expand/collapse tree logic is preserved rather than duplicated.
Persistent nav tabs (Decks / Browse / Stats) live in the app shell so they show
on every route. Deck color dots and the day-streak/heatmap are derived, never
persisted; fresh installs with no revlog render graceful empty states (all-grey
grid, 0 streak, "0"/"—" stat cards). The "Pause scheduling" control is rendered
disabled only, with no backing logic.

## Files affected

Create:
- `web/src/app/core/deck-color.ts` — pure deck-name→stable color hash.
- `web/src/app/core/deck-color.spec.ts` — unit tests for the hash.
- `web/src/app/core/stats.spec.ts` — unit tests for new + existing stat helpers.

Modify:
- `web/src/styles.scss` — global dark theme (replace light body colors).
- `web/src/app/app.ts` / `app.html` / `app.scss` — shell frame + Decks/Browse/Stats nav tabs (title stays "Spanish SRS").
- `web/src/app/core/stats.ts` — add pure helpers: studied-today, time-today, pace, day-streak, heat buckets/yearly rollup.
- `web/src/app/features/deck-list/deck-list.ts` / `.html` / `.scss` — becomes the two-column dashboard (deck sidebar + stat panels).
- `web/src/app/core/study-queue.service.ts` — add `startAll()` for the all-decks session.
- `web/src/app/features/review/review.ts` / `.html` / `.scss` — redesigned study screen + session n-of-total + `all` handling.
- `web/src/app/features/stats/stats.scss` — theming pass only.
- `web/src/app/features/browser/browser.scss` — theming pass only.
- `web/src/app/features/options/options.scss` — theming pass only.

## Tasks

**T001 — Global dark theme + app shell nav.** Edit `styles.scss` to the dark
palette (bg ~#0e0e10, one-shade-lighter rounded panels, faint borders, light
text). Edit `app.html`/`app.scss`/`app.ts` to render the shell frame and a
persistent nav with tabs Decks (`/`), Browse (`/browse`), Stats (`/stats`); the
active route is visually distinct via `routerLinkActive`. Title stays
"Spanish SRS" (no rename). Covers Req 1, 2.
_Done when:_ `npm run build -w web` succeeds and the shell renders dark with the
three nav tabs, active-tab highlighting following the route.

**T002 — Core stat helpers + deck-color, with unit tests.** Add to `core/stats.ts`
pure functions (over already day-mapped inputs so they stay testable): studied-today
count, time-today (sum `timeMs`), pace (time ÷ cards), `dayStreak` (consecutive
days up to today with ≥1 review), and a yearly heat rollup + `heatLevel` bucketer
(0 / 1–9 / 10–19 / 20–39 / 40+). Reuse `buttonCounts` for retention (no new math).
Add `core/deck-color.ts` `deckColor(name)` returning a stable color from a name
hash. Add `core/stats.spec.ts` and `core/deck-color.spec.ts` covering happy path,
empty input, and bucket boundaries. Covers Req 5, 6, 7, 9 (helper layer) and Req 3
(color). _Done when:_ `npm run test -w web` passes with the new specs (this
establishes the first web unit tests).

**T003 — Dashboard on `/`.** Extend `features/deck-list` into the two-column
dashboard. Left column: deck rows using `CollectionStore.deckTree()` with the
existing expand/collapse (`toggle`/`visibleNodes`), each row showing a
`deckColor()` dot, leaf name, and three count pills (new=blue, learning=red,
review=green) from `DeckNode.total`; a "Study all due" action pinned at the
bottom showing total due (sum of root-node `total`) linking to `/study/all`.
Right column: four stat cards (Studied today / Time / Pace / Retention using
T002 helpers + `getRevlog()`), an activity heatmap with a year selector + legend
(T002 rollup/`heatLevel`), a day-streak badge (`dayStreak`), and a Today's
forecast panel (total due, est time = due × pace, stacked New/Learning/Review bar
+ legend from `deckTree()`). Zero-state renders "0"/"—" and an all-grey grid.
Load revlog in the component via `ApiService.getRevlog()` (as `features/stats`
does). Covers Req 3, 4 (UI), 5, 6, 7, 8. _Done when:_ `npm run build -w web`
succeeds and `/` renders the sidebar + all four panels with real and empty data.

**T004 — Study screen redesign.** Rework `review.html`/`review.scss` to the
mockup: a top bar showing "{deck} — {n} of {total}" plus a thin session progress
bar, where `total` = due count at session start and `n` = answered + 1 (new
component-local `answeredCount` signal + captured `sessionTotal` in `review.ts`;
no persistence). Card panel shows a muted breadcrumb (deck name + a `note.tags`
sub-topic when present — thread `tags` through `RenderState`), the rendered
question, a divider, and the rendered answer on reveal (still via
`renderCard(...)`). Four grading buttons Again/Hard/Good/Easy = red/amber/green/
blue, each stacking label + `preview` interval + number key; keep `preview`,
`rate()`, and the `onKey` handler (space flip, 1–4, U/− undo/suspend) working.
Add a muted helper line and restyle (not remove) the "All done" state. Covers
Req 10, 11, 12, 13. _Done when:_ `npm run build -w web` succeeds; a per-deck
study session flips, grades via mouse + keyboard, shows n-of-total advancing and
the progress bar filling, and the redesigned done-state appears at the end.

**T005 — All-decks study session (`study/all`).** Add
`StudyQueueService.startAll()`: subtree = every deck id, opts = default group
(`deckOptions()[0]`), limits via existing `remainingLimits(...)`; ordering and
scheduling reuse the existing `next()`/scheduler unchanged. In `review.ts.init`,
when `deckId === 'all'` call `startAll()` and set the deck label to "All decks";
otherwise unchanged. No `app.routes.ts` change (`study/:deckId` matches `all`).
Covers Req 4 (session behaviour). _Done when:_ clicking "Study all due" on the
dashboard opens a session spanning multiple decks that grades and completes, and
existing per-deck study is unaffected.

**T006 — Theming pass on Browse, Stats, Options.** Apply the dark palette
(colors/typography/panels only) to `stats.scss`, `browser.scss`, and
`options.scss` so they match the new theme. No feature/behaviour/chart changes.
Completes Req 1 across all routes. _Done when:_ `npm run build -w web` succeeds
and `/browse`, `/stats`, `/options/:id` render on-theme with existing behaviour
intact.

## Testing strategy

- Req 1, 2 (theme + nav): T001/T006 — `npm run build -w web` + manual check that
  every route renders dark and the active nav tab is highlighted.
- Req 3 (deck rows, pills, color, expand/collapse): T002 `deck-color.spec.ts`
  (stable/deterministic color) + T003 manual (pills from `DeckNode.total`,
  expand/collapse preserved).
- Req 4 (Study all due): T005 manual — link starts a multi-deck session that
  completes; per-deck study still works.
- Req 5 (four stat cards): T002 `stats.spec.ts` (studied-today, time, pace;
  retention via `buttonCounts`) + T003 manual zero-state ("0"/"—").
- Req 6 (heatmap): T002 `stats.spec.ts` (yearly rollup + `heatLevel` boundaries,
  empty→all level 0) + T003 manual (year selector, legend, all-grey when empty).
- Req 7 (day-streak): T002 `stats.spec.ts` (consecutive-day logic, 0 on empty).
- Req 8 (forecast panel): T003 manual — total/est-time/stacked bar from
  `deckTree()`.
- Req 9 (frontend-only, unit-testable, server untouched): T002 — new specs pass
  under `npm run test -w web`; no `server/` files modified in any task.
- Req 10 (n-of-total + progress bar): T004 manual — counter/bar advance per grade.
- Req 11 (breadcrumb + Q/divider/A via renderCard): T004 manual — breadcrumb
  shows deck + tag; card HTML still rendered by templates.
- Req 12 (four colored buttons + keyboard): T004 manual — labels + previews +
  keys; space/1–4/U/− all work.
- Req 13 (helper line + restyled done): T004 manual — helper line visible; "All
  done" restyled, not removed.

## Open Questions

None — the seven prior open questions were resolved (see STATE.md Decisions log)
and are planned to those resolutions.

## Discovered

(none — no unrelated issues noted during codebase review)
