# PLAN — 005-review-page-redesign

## Approach

This is a frontend-only restyle of the review feature's three files
(`review.ts` / `review.html` / `review.scss`). All the data the mockup needs
already exists in the component: `counts` (QueueCounts, refreshed by
`loadNext()` after every grade), `progressPct()`, `sessionN()/sessionTotal()`,
and `preview[rating].label` via `buttonLabel()`. The plan therefore splits
into (1) a small, fully-specified logic change in `review.ts` — expose the
current card's full deck path and note-type kind, and add Esc-to-exit — then
(2) a template+style restructure to the two mockup states, then (3) a new
component test file establishing the DOM/keyboard contract (none exists
today).

Key decisions (adopting the spec's Open Question proposals, plus the
critique's two warnings resolved):

- **Chip label** = note-type `kind` uppercased (`CLOZE` / `STANDARD`).
- **Suspend** stays: topbar button kept, hint gains "· − suspend". Final hint
  text: `space to flip · 1–4 to grade · esc to exit · − suspend`.
- **Back link** kept, restyled unobtrusively in the topbar.
- **Legend colours** reuse existing tokens: new = `--color-accent-blue`,
  learning = `--color-accent-red`, review = `--color-accent-green` (same
  mapping the sidebar deck counts already use in `app.scss`).
- **Type-in cards**: Enter-to-reveal exception stands; hint text and the
  "space" key chip do not vary per card type.
- **All-decks breadcrumb** (critique WARN 1): the breadcrumb shows the
  *current card's* deck path, looked up per card via
  `CollectionStore.deckById(card.deckId)` at render time in `loadNext()`.
  The header title still uses `deckName()` ("All decks — n of total").
- **"Full width of the page"** (critique NIT 4): the bar spans the full width
  of the content column (`.app-main`, i.e. viewport minus sidebar). The
  `.review` host drops its `max-width: 720px`; the bar sits flush at the top
  edge; header, legend, card panel, and controls stay in a centered ~700px
  inner column. No change to the global shell.
- **Pre-reveal inert grading**: the four buttons render in both states with
  `[disabled]="!revealed() || busy()"` — native `disabled` covers clicks,
  focus exclusion, and AT announcement (req 9); keys 1–4 are already gated by
  `revealed()` in `onKey()`. Dimming is CSS on `:disabled`. Because the row
  is always rendered, reveal cannot shift its position.
- **Test location** (critique WARN 2): new file
  `web/src/app/features/review/review.spec.ts` (`.spec.ts` naming per
  testing-playbook). This is the repo's first TestBed component test — the
  existing web specs are pure-logic — so that task is rated high and ordered
  last, after the DOM it asserts exists.

Tradeoff: the testing-playbook prefers failing-test-first, but a DOM contract
test cannot precede the template it asserts; T001/T002 rely on the existing
suite + visual `npm run shoot` comparison, and T003 locks the contract in.

## Files affected

| File | Why |
|---|---|
| `web/src/app/features/review/review.ts` | modify — deck path + note-type kind in `RenderState`, `Router` inject, Esc handling |
| `web/src/app/features/review/review.html` | modify — new chrome (top bar, legend, panel, chip, pill, always-on ratings, hint) |
| `web/src/app/features/review/review.scss` | modify — restyle everything to the mockups using existing tokens |
| `web/src/app/features/review/review.spec.ts` | create — component contract tests (reqs 7–14) |

## Tasks

### T001 — Component logic: deck path, note-type kind, Esc exit
**Files:** `web/src/app/features/review/review.ts`
**Skills:** angular-conventions, testing-playbook
**Complexity:** low

Fully specified changes; no other file touched (keep `RenderState.tags` for
now so `review.html` still compiles — T002 removes it):

1. Add to `RenderState`: `deckPath: string[];` (full `::`-split path of the
   card's own deck) and `noteTypeKind: 'standard' | 'cloze';`.
2. In `loadNext()`, when building the state:
   `deckPath: this.store.deckById(card.deckId)?.name.split('::') ?? [this.deckName()],`
   and `noteTypeKind: noteType.kind,`. This gives the correct per-card path
   in `all`-deck sessions too.
3. Inject the router: `private readonly router = inject(Router);`
   (`Router` from `@angular/router`).
4. In `onKey()`, as the **first** branch after the `finished()/loading()`
   guard:
   `if (e.key === 'Escape') { e.preventDefault(); void this.router.navigateByUrl('/'); return; }`
   Do not cancel an in-flight `rate()` — its continuation only touches
   root-provided services and signals, so completing after navigation is
   safe (req 12). Esc works in both revealed and unrevealed states.

Done when: `npm run test` (root) is green and `npm run build` compiles —
no template/behaviour change yet, so no visual check needed.

### T002 — Template + styles: two mockup states
**Files:** `web/src/app/features/review/review.html`, `web/src/app/features/review/review.scss`; remove the now-unused `tags` field from `RenderState` in `review.ts`
**Skills:** angular-conventions, testing-playbook
**Complexity:** medium

Restructure to the mockups (reqs 1–10):

- **Progress bar** (req 1): move out of the topbar to the first element of
  the component, ~4px tall, full content-column width, fill =
  `progressPct()` in `--color-accent`, keep the existing width transition.
  Drop `.review { max-width: 720px }`; constrain inner sections instead.
- **Header line** (req 2): centered "{{ deckName() }} — {{ sessionN() }} of
  {{ sessionTotal() }}". Keep the "← Decks" back link and the Suspend button
  in this top area, restyled unobtrusively (decisions above).
- **Legend** (req 3): centered row of three items, each an ~10px colored
  square + label + count from `counts()`: blue "New", red "Learning", green
  "Review" (token mapping in decisions).
- **Card panel** (reqs 4–6): one centered `article` (~700px max), surface
  `--color-surface`, `--radius-lg`+ corners, soft shadow, generous padding.
  Inside, top line = breadcrumb `s.deckPath.join(' · ')` (uppercase, muted,
  letter-spaced — drop the tags span) followed by an outlined rounded chip
  `{{ s.noteTypeKind }}` (uppercase via CSS). Question large/bold; the
  existing `hr#answer` restyle stays as the divider; style post-divider
  answer content lighter/regular via the rendered HTML's structure. Type-in
  input stays functionally untouched (chrome-only restyle).
- **Show answer pill** (req 7): pre-reveal only, solid `--color-accent`
  pill "Show answer" with an inline darker-blue "space" key chip
  (right-aligned inside the pill); click calls `reveal()`.
- **Ratings row** (reqs 8–9): always rendered (remove the `@else` around
  it); each button `[disabled]="!revealed() || busy()"`; keep the existing
  per-rating border/label colours and label/interval/key stack; interval
  previews visible in both states; `:disabled` style = reduced opacity
  (~0.45), no hover, `cursor: default`. Reserve vertical space so
  toggling the Show-answer pill does not move the row (e.g. fixed-height
  controls block or the pill sits above the always-present row exactly as
  the mockups show).
- **Hint** (req 10): `space to flip · 1–4 to grade · esc to exit · − suspend`.
- Loading and "All done" states restyled only as far as needed to not break.

Done when: root `npm run test` green; with `npm run dev` up,
`npm run shoot -- /study/all` in both states compared against the SPEC.md
mockup descriptions per testing-playbook item 3 (no layout jump on reveal,
all chrome present, colours from tokens), deltas logged non-material.

### T003 — Component contract tests
**Files:** `web/src/app/features/review/review.spec.ts` (create)
**Skills:** angular-conventions, testing-playbook
**Complexity:** medium

Follows an existing pattern: `web/src/app/app.spec.ts` is already a
TestBed-based component test in this repo (not the first, per critique
revision), including a documented test-harness hang gotcha directly
relevant here. Provide fakes for `CollectionStore`,
`StudyQueueService`, and `ApiService` via TestBed `providers`; stub
`ActivatedRoute.paramMap` with a deck id; drive the queue fake to serve one
known card + note + note type. Note: `SchedulerFactory.for()` is a static
call, not DI-injected, so "pre-reveal click doesn't call the scheduler"
must be asserted via spying on the static method (or by asserting no
`ApiService`/queue-advance call fires) rather than via a provider fake;
the `StudyQueueService` fake must also supply a non-null `options` object
(read at review.ts:149/198). Cover, with each case naming its requirement:

- Ratings row: 4 buttons rendered pre-reveal with `disabled`, interval
  labels visible; clicking one pre-reveal does not call the scheduler/API;
  post-reveal buttons enabled and clicking grades (reqs 8, 9, 13).
- Keyboard: Space (keydown dispatch) reveals when unrevealed; `1`–`4` before
  reveal do nothing; `3` after reveal grades Good (reqs 9, 11).
- Esc: dispatching Escape calls `Router.navigateByUrl('/')`; an unresolved
  in-flight `rate()` promise resolving afterwards throws nothing (req 12).
- Chrome: breadcrumb shows the full deck path with "·" separators from the
  card's own deck; chip text equals the note-type kind uppercased; legend
  shows the three counts; hint text exact-matches the decided string
  (reqs 3, 5, 10).

Done when: root `npm run test` green including the new spec (satisfies
req 14's intent — the new contract is asserted, nothing old was deleted).

## Testing strategy

| Req | Verified by |
|---|---|
| 1, 2, 4, 6, 7 | T002 visual comparison via `npm run shoot` vs mockups (layout/colour are visual requirements) |
| 3, 5, 10 | T003 unit assertions (legend counts, breadcrumb path, hint text) + T002 visual |
| 8, 9 | T003 unit assertions (always-rendered, disabled pre-reveal, inert clicks/keys) + T002 no-layout-jump visual check |
| 11, 12 | T003 keyboard tests (Space reveal, 1–4 gating, Esc navigation, post-navigation rate safety) |
| 13 | Existing core suites stay green (root `npm run test` at every task) + T003 grade-path test asserting scheduler/API calls fire once post-reveal |
| 14 | Root suite green after T003; no existing review spec existed, so the new spec *is* the DOM contract coverage (per critique WARN 2) |

## Open questions

None — all five SPEC open questions and both critique warnings are resolved
as decisions above.
