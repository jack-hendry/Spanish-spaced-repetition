# STATE: 004-ui-mockup-parity

> **Archived 2026-07-07, summarized 2026-08-26** during the harness migration
> (AD-009). The per-task decisions log (T001–T007 implementation narration,
> ~390 lines) was cut to bring this file under the 20 KB archive summary gate;
> `SPEC.md`, `PLAN.md` and `CRITIQUE.md` are unchanged. What the tasks decided
> that still matters is in the Summary and Discovered sections below.

## Status
- **Phase:** done
- **Last updated:** 2026-07-07

## Original request
> A written comparison of the target mockups against the app then in place —
> deck/dashboard page, sidebar, heatmap, Browse page, Stats page. Notes: the
> heatmap should get month/date labels like Heat.js and a per-day hover
> tooltip, and use the design's colour legend; navigation between
> Decks/Browse/Stats is functionally the same, only the UI differs.

## Completed
- [x] Spec written / approved (human)
- [x] Plan written / approved (human)
- [x] T001: Pure stat helpers + relative-due formatter (core/stats.ts + spec)
- [x] T002: Heatmap grid-builder helper (new core/heatmap.ts + spec)
- [x] T003: Shared `app-heatmap` component (shared/heatmap/)
- [x] T004: Shell sidebar restructure + dashboard slimming
- [x] T005: Dashboard adopts shared heatmap + polished forecast card
- [x] T006: Browse rebuild + tag saving
- [x] T007: Stats rebuild

## Summary
Closed the visual/interaction gaps between the 003 dark redesign and the target
mockups — frontend-only, no server, scheduling or routing changes. Shipped:

1. **Two reusable building blocks.** Pure helpers in `core/stats.ts`
   (`bestStreak`, `periodDelta`, `sumTimeInRange`, `countInRange`,
   `formatRelativeDue`) and a heatmap stack — `core/heatmap.ts`'s
   `buildHeatGrid` plus the standalone `shared/heatmap/app-heatmap` component
   (month/weekday labels, month gaps, hover tooltips, labelled blue legend) —
   now shared by both the dashboard and Stats.
2. **Shell restructure.** The deck list and Decks/Browse/Stats navigation moved
   out of the dashboard into a persistent `app.*` sidebar (segmented tabs,
   colour-dot deck rows with zero-hidden count pills, subdeck expand/collapse,
   hover-revealed per-deck gear, pinned "Study all due"), rendering on every
   route.
3. **Dashboard** (`features/deck-list`) slimmed to stat cards + the shared
   heatmap + a one-line forecast card with a thin stacked bar.
4. **Browse rebuild** (`features/browser`): single search input + result count,
   a FRONT/DECK/STATE/DUE table (state pills including a new Young/mature
   split, relative due strings), row selection, and an EDIT CARD panel with tag
   editing — `CollectionStore.saveNoteFields` was extended to persist tags —
   plus Suspend/Save.
5. **Stats rebuild**: four delta-aware stat cards (Reviews / Study time vs last
   month, Current streak with best-ever, Mature cards with % of collection), a
   14-day reviews bar chart, an answer-buttons card with right-aligned
   percentages and a true-retention line, and a year-in-review heatmap —
   dropping the old card-counts stacked bar and future-due forecast per Q6.

All seven SPEC open questions (Q1–Q7) resolved with their recommended defaults
during implementation. Final state green: server 17/17, web 135/135 (up from
the pre-004 baseline by the T001–T003 unit tests plus new `app.spec.ts` /
`heatmap.spec.ts` render tests); `npm run build -w web` clean throughout.

## Discovered
- `server/src/models/index.ts` (`Card.due` doc-comment, ~line 84) says
  "learning: epoch seconds" but every actual scheduler
  (`web/src/app/core/scheduling/{sm2,fsrs}.ts`) and consumer
  (`study-queue.service.ts`) treats learning `due` as epoch **milliseconds**
  (`ctx.now + delayMin * 60_000`, compared via `card.due <= ctx.now` where
  `ctx.now` is `Date.now()`-scale ms). Not fixed here per scope discipline.
  → Later fixed in the skill doc by 006 T011; see **AD-003** / **L-001**.
