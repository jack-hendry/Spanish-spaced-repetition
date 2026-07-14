# PLAN: Listening-comprehension card template

## Approach
The Listening card is a second `CardTemplate` (ord 1, name "Listening") on the
existing `nt-spanish-2sided` note type. Its front is audio-only
(`{{SideAAudio}}{{SideBAudio}}`) and its back reveals the full study content
directly (SideA text+image+audio, then SideB text+image+audio) — it cannot use
`{{FrontSide}}` because the front carries no SideA text. Card generation is
entirely template-driven: because `desiredOrds` for a standard note type is
just `templates.map(t => t.ord)`, once the note type has two templates every
note reconciles to two cards with no changes to `reconcileNoteCards`. The
front-end renders whatever qfmt/afmt the server sends, so **no rendering code
change is needed to produce the audio-only front** — the only new front-end
behaviour is sequential autoplay.

The hard part is reaching already-persisted installs. `notetypes.json` is seeded
only when absent (`FileStore.init`), so a live store keeps its one-template
note type forever unless migrated. We add a pure, idempotent startup migration
that (a) appends the Listening template to the persisted `nt-spanish-2sided`
note type if missing, and (b) for every note of that type lacking an ord-1
card, calls `reconcileNoteCards` and merges the result — creating a fresh "new"
ord-1 card while leaving surviving ord-0 cards' scheduling untouched (reconcile
only re-spreads `modified`, never scheduling fields). Gating per-note on
"missing ord 1" makes re-runs no-ops and crash-safe. `FileStore.init` invokes it
after loading and persists notetypes then cards.

Autoplay (OQ1) lives **only in `review.ts`**, keyed off the card being a
Listening front, so the shared `transformMedia` path is untouched and req 13
holds absolutely (resolving CRITIQUE finding 2 without a shared-renderer flag).
The rendered `<audio controls>` elements stay visible as the manual fallback.

### Resolved open questions
- **OQ1 (autoplay mechanism):** After the question renders, the component reads
  the question host element (`viewChild` + a render effect), queries its
  `<audio>` elements, calls `.play()` on the first and chains the next in the
  prior clip's `ended` handler. `play()` returns a promise; a rejection
  (autoplay blocked) is swallowed, leaving the visible `controls` as fallback.
  No change to `transformMedia`; other cards never trigger this path.
- **OQ2 (fallback control):** Keep the audio elements rendered with `controls`
  (their existing form). No text/images on the front; the players are the
  minimal visible fallback if autoplay is blocked. No extra UI.
- **OQ3 (inter-clip gap):** Back-to-back — the second clip starts in the first
  clip's `ended` handler with no delay.
- **OQ4 (new-card daily limit):** No special handling. New Listening cards flow
  through the standard new-card queue and per-day limit like any other new card.

## Files affected
- `server/src/store/seed.ts` — add exported `LISTENING_TEMPLATE`; include it in
  `nt-spanish-2sided` templates so fresh installs get ord 0 + ord 1.
- `server/src/store/seed.test.ts` — assert seed note type has both templates.
- `server/src/store/migrations.ts` (new) — pure `migrateAddListeningTemplate`.
- `server/src/store/migrations.test.ts` (new) — unit tests for the migration.
- `server/src/store/file-store.ts` — call the migration in `init()`; persist
  notetypes + cards when it reports changes.
- `web/src/app/core/templating/template-renderer.spec.ts` — assert the
  Listening qfmt/afmt render audio-only front and full back.
- `web/src/app/features/review/review.ts` — detect Listening front; sequential
  autoplay via a render effect over the question host.
- `web/src/app/features/review/review.html` — add `#questionHost` ref on the
  question `.rendered` div.
- `web/src/app/features/review/review.spec.ts` — autoplay behaviour tests.
- `web/src/app/core/models/index.ts` — read-only consistency check; the
  `CardTemplate`/`NoteType` shapes already match the server — no change expected.

## Tasks

### T001 — Seed the Listening template
Files: `server/src/store/seed.ts`, `server/src/store/seed.test.ts`;
read-only `web/src/app/core/models/index.ts`.
Add `export const LISTENING_TEMPLATE: CardTemplate = { name: 'Listening', ord: 1,
qfmt: '{{SideAAudio}}{{SideBAudio}}', afmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}' }`
(import `CardTemplate` type). Push it into the `nt-spanish-2sided` `templates`
array in `buildSeedNoteTypes` (ord 0 "A → B" stays first, unchanged). Do NOT
touch `nt-spanish-2sided-both` or any other note type. Confirm the web
`CardTemplate`/`NoteType` interfaces already match the server (they do) — no
edit to the mirror.
Done when: a new/extended test in `seed.test.ts` asserts `buildSeedNoteTypes()`'s
`nt-spanish-2sided` has exactly two templates: ord 0 named "A → B" and ord 1
named "Listening" whose qfmt contains only `SideAAudio`/`SideBAudio` (no
`SideA`/`SideB`/`SideAImage`/`SideBImage`), and `npm run test -w server` passes.
Complexity: low
Skills: scheduling-domain, testing-playbook

### T002 — Pure startup migration + unit tests
Files: `server/src/store/migrations.ts` (new),
`server/src/store/migrations.test.ts` (new).
Export `migrateAddListeningTemplate(data, now)` operating on in-memory arrays
`{ notetypes, notes, cards }` (mutating them), returning
`{ changedNoteTypes: boolean; changedCards: boolean }`. Steps:
1. Find the note type with id `nt-spanish-2sided`. If absent, return
   `{false,false}`.
2. If its `templates` has no entry with `ord === 1`, push a deep copy of
   `LISTENING_TEMPLATE` (import from `seed.ts`); set `changedNoteTypes = true`.
3. Compute `basePosition` = (max `due` over cards with `queue === 'new'`) + 1
   (local helper, mirrors `nextNewPosition` in routes; do not refactor routes).
4. For every note with `noteTypeId === 'nt-spanish-2sided'` that has **no** card
   with `ord === 1`: gather that note's existing cards, call
   `reconcileNoteCards(note, updatedNoteType, existingForNote, deckId,
   basePosition, now)` where `deckId = existingForNote[0]?.deckId` (skip the note
   if it has no existing card / no deck), advance `basePosition` past the created
   card, replace that note's cards in the `cards` array with the reconciled set,
   and set `changedCards = true`.
Idempotency: notes that already have an ord-1 card are skipped, so a second call
returns `{false,false}` and mutates nothing. Ord-0 cards keep every scheduling
field (`type/queue/due/ease/interval/stability/difficulty/reps/lapses/left/
lastReviewed`); only `modified` may change.
Done when: `migrations.test.ts` covers, using hand-built arrays: (a) a
one-template note type + one note with only an ord-0 review card → after
migration the note type has ord-1 "Listening", a new ord-1 card exists in `new`
state in the same deck, and the ord-0 card's scheduling fields are byte-identical
to before; (b) calling the migration a second time returns `{false,false}` and
leaves arrays unchanged (card count stable, no duplicate ord-1); (c) new ord-1
`due` equals maxExistingNewPosition+1 (no collision). `npm run test -w server`
passes.
Complexity: high
Skills: scheduling-domain, testing-playbook

### T003 — Wire migration into FileStore.init + integration test
Files: `server/src/store/file-store.ts`, `server/src/store/seed.test.ts` (or a
new `file-store.migration.test.ts`).
In `init()`, after `this.data` is populated and after the seed-persist block,
call `migrateAddListeningTemplate(this.data, Date.now())`; if `changedNoteTypes`
`await this.flush('notetypes')`, and if `changedCards` `await this.flush('cards')`
(awaited flushes, ordered notetypes-then-cards; respect atomic-write style). No
change to debounce/flushAll behaviour.
Done when: an integration test seeds a temp `data` dir by hand with a
one-template `nt-spanish-2sided` notetypes.json, a matching note, and an ord-0
`review` card with distinctive `ease`/`interval`, then constructs
`new FileStore(dir, { debounceMs: 0 })` and `await store.init()`; afterwards
`getNoteTypes()` shows two templates, `getCards()` contains an ord-1 `new` card
for that note, and the ord-0 card's `ease`/`interval` are unchanged. A second
`FileStore(dir).init()` adds no cards. `npm run test -w server` passes.
Complexity: medium
Skills: scheduling-domain, testing-playbook

### T004 — Rendering test: audio-only front, full back
Files: `web/src/app/core/templating/template-renderer.spec.ts`.
No production code change — `renderCard` already handles the Listening
qfmt/afmt. Add a test rendering the Listening template
(`qfmt/afmt` from `LISTENING_TEMPLATE`) against fields with SideA/SideB text,
`[sound:...]` audio and `<img>` images.
Done when: the test asserts the rendered `front` contains both audio elements
(two `<audio ... class="card-audio">` from the two `[sound:]` markers) and does
NOT contain the SideA/SideB text or the image `src`; the rendered `back`
contains SideA text, SideB text, both images, and both audio elements. `npm run
test -w web` passes.
Complexity: low
Skills: angular-conventions, testing-playbook

### T005 — Sequential autoplay on the Listening front
Files: `web/src/app/features/review/review.ts`,
`web/src/app/features/review/review.html`,
`web/src/app/features/review/review.spec.ts`.
Add to `RenderState` a boolean `isListeningFront`, set in `loadNext` when
`noteType.id === 'nt-spanish-2sided'` and the resolved template's `name ===
'Listening'` (equivalently `card.ord === 1`). In `review.html` add a template
ref `#questionHost` to the question `<div class="rendered" [innerHTML]=...>`
(the non-revealed branch only). In `review.ts` add
`readonly questionHost = viewChild<ElementRef<HTMLElement>>('questionHost')` and
a render-time effect (e.g. `afterRenderEffect`/`effect` reading `state()` +
`revealed()` + `questionHost()`) that, when a Listening front is showing and not
revealed, collects `host.querySelectorAll('audio')` and plays them sequentially:
play index 0, and in each element's `ended` handler play the next; guard against
double-arming across card changes (track/detach listeners when the card changes,
and pause any playing clip on teardown). Swallow `play()` promise rejections
(autoplay blocked) so the visible `controls` remain the fallback. Do NOT change
`transformMedia`, the A→B card, or any non-Listening rendering.
Done when: `review.spec.ts` (jsdom) drives a `nt-spanish-2sided` ord-1 card
through `loadNext`, stubs `HTMLMediaElement.prototype.play` (jsdom has no real
media) to a spy returning a resolved promise, and asserts: the first `<audio>`'s
`play` is called after render; dispatching `ended` on the first triggers `play`
on the second; and for a plain A→B (ord 0) or cloze card, no `play` is called.
`npm run test -w web` passes; manual check: studying a Listening card plays word
then sentence automatically with no text shown.
Complexity: medium
Skills: angular-conventions, testing-playbook

## Testing strategy
- **Req 1, 4 (fresh install two templates):** T001 seed test; T003 also proves
  fresh path indirectly.
- **Req 2 (audio-only front qfmt):** T001 asserts qfmt fields; T004 asserts
  rendered front has no text/images.
- **Req 3, 11 (full back, no FrontSide reliance):** T001 afmt content; T004
  rendered back contains SideA+SideB text/images/audio.
- **Req 5, 6, 8 (migration adds template + ord-1 new card in same deck, no
  position collision):** T002 unit tests + T003 init integration test.
- **Req 7 (preserve ord-0 scheduling, idempotent):** T002 (b)/(c) and T003
  second-init assertion.
- **Req 9 (automatic sequential playback):** T005 autoplay spec.
- **Req 10 (front no text/images):** T004 front assertion.
- **Req 12 (standard reveal-then-rate, no type-in):** unchanged flow; Listening
  qfmt has no `{{type:}}` so `isTypeIn` is false — covered by existing review
  behaviour; T005 renders through the normal path.
- **Req 13 (other cards' audio unchanged):** T005 asserts no `play` for A→B/
  cloze and leaves `transformMedia` untouched.

### T006 — Dedicated "Listening" deck, independent of the note's own deck
Files: `server/src/models/index.ts`, `web/src/app/core/models/index.ts`,
`server/src/store/seed.ts`, `server/src/cards/generate.ts`,
`server/src/store/migrations.ts`, `server/src/import/transform.ts`, and their
test files (`generate.test.ts`, `migrations.test.ts`, `transform.test.ts`,
`seed.test.ts`, `file-store.migration.test.ts`).

Scope change (post-implementation, pre-commit): Listening cards must not sit
in the note's own deck (superseding the original req 8) — they go into a
single dedicated top-level "Listening" deck, so the note's original deck is
untouched.

Approach: add an optional `deckId?: string` to `CardTemplate` (server model +
web mirror) meaning "cards generated from this template always live in this
fixed deck, regardless of the note's own deck." Set it on `LISTENING_TEMPLATE`
to a new stable constant `LISTENING_DECK_ID = 'dec-listening'` (seed.ts). Every
producer of cards resolves the effective deck per-ord as
`noteType.templates.find(t => t.ord === ord)?.deckId ?? primaryDeckId` — this
keeps the special-case in one place (the template) instead of duplicated
`ord === 1` checks scattered across callers, and self-heals if a card ever
drifts to the wrong deck (recomputed on every reconcile, not just on create).

1. **Models:** add `deckId?: string` to `CardTemplate` in both
   `server/src/models/index.ts` and `web/src/app/core/models/index.ts`.
2. **seed.ts:** export `LISTENING_DECK_ID`; set `LISTENING_TEMPLATE.deckId =
   LISTENING_DECK_ID`; export `buildListeningDeck(now): Deck` (id
   `LISTENING_DECK_ID`, name `'Listening'`, `parentId: null`, `optionsId:
   DEFAULT_DECK_OPTIONS_ID`, `collapsed: false`) for the migration to insert.
3. **generate.ts (`reconcileNoteCards`):** for each wanted `ord`, look up
   `noteType.templates.find(t => t.ord === ord)`; effective deck =
   `template?.deckId ?? deckId`. Apply to both the kept-card branch (so a prior
   card's `deckId` is corrected if it drifted) and the new-card branch. Cloze
   note types are unaffected (no per-ord templates beyond ord 0).
4. **migrations.ts:** extend `migrateAddListeningTemplate` (or add a sibling
   step in the same function) to (a) push `buildListeningDeck(now)` into
   `data.decks` if no deck with id `LISTENING_DECK_ID` exists, reporting a new
   `changedDecks: boolean`; (b) for every existing card with `ord === 1` on an
   `nt-spanish-2sided` note whose `deckId !== LISTENING_DECK_ID`, set
   `deckId = LISTENING_DECK_ID` and `modified = now` — this is the corrective
   step for the ~3638 ord-1 cards already created in-vivo in the note's own
   deck (req 8a). Newly created ord-1 cards already land correctly via the
   generate.ts change (step 3), reached through the same `reconcileNoteCards`
   call already in the migration.
5. **file-store.ts:** if `changedDecks`, `await this.flush('decks')` alongside
   the existing notetypes/cards flushes.
6. **transform.ts (`transformBooks`):** the per-ord card-building loop
   currently forces `deckId` (the book's ancestor-path deck) onto every card,
   including on re-import of a prior card — this would silently reset
   Listening cards back to the book deck on the next `npm run import`. Compute
   the same effective deck per ord (`resolveNoteType(...).templates.find(t =>
   t.ord === ord)?.deckId ?? deckId`) for both the prior-card and new-card
   branches. Also: `decks.json` is fully replaced by `transformBooks`'s output
   (`store.replaceAll`), and the Listening deck is never an ancestor-path deck,
   so it would be silently dropped on next import unless carried through —
   after computing `decks = reg.order.map(...)`, append
   `existing.decks.find(d => d.id === LISTENING_DECK_ID)` if present (req 8b).
Done when:
- `generate.test.ts`: a note type with an ord-1 template carrying `deckId:
  'dec-x'` reconciles its ord-1 card into `'dec-x'` regardless of the passed-in
  primary `deckId`, for both a freshly created card and one whose prior
  `deckId` was something else (drift is corrected).
- `migrations.test.ts`: (a) migration creates the Listening deck when absent;
  (b) an ord-1 card pre-existing in the note's own deck gets relocated to
  `LISTENING_DECK_ID` with scheduling fields byte-identical apart from
  `deckId`/`modified`; (c) idempotent — second run makes no further changes.
- `file-store.migration.test.ts`: integration test extended to assert
  `getDecks()` contains the Listening deck after `init()`.
- `transform.test.ts`: re-transforming books with an existing ord-1 card whose
  `deckId` is `LISTENING_DECK_ID` keeps it there (not reset to the book deck);
  `result.decks` includes the Listening deck when it was present in `existing`.
- `npm run test -w server` and `npm run test -w web` (mirror-only model change,
  no web logic change) pass.
- Apply the migration to the live dev store (as was done in-vivo for T002/T003)
  so `data/spanish/decks.json` gains the Listening deck and the ~3638 existing
  ord-1 cards in `data/spanish/cards.json` move into it; commit alongside the
  code.
Complexity: high
Skills: scheduling-domain, testing-playbook

## Open Questions
(none — OQ1–OQ4 resolved above; T006 resolves the deck-placement scope change
with no new open questions.)
