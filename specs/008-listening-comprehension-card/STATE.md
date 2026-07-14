# STATE: 008-listening-comprehension-card

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** (complete) T006 — dedicated "Listening" deck, independent of note's own deck
- **Last updated:** 2026-07-14

## Original request
> Listening-comprehension card template — a second template ("Listening") on the existing nt-spanish-2sided standard note type. Front face plays SideAAudio (Spanish word audio) then SideBAudio (Spanish sentence audio) with NO text shown; back face reveals SideA/SideB text as today. User self-grades Again/Hard/Good/Easy like any other card. Reuses reconcileNoteCards so every existing note gets the new card automatically with independent scheduling state. No new scraping/content needed — both audio clips already exist per note (SideAAudio = word audio, SideBAudio = sentence audio, despite the legacy field name).

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] Reviewed & verified (server 37 + web 183 green; live store already migrated)

## Tasks
- [x] T001 (low): Seed the Listening template in seed.ts + seed test
- [x] T002 (high): Pure startup migration (migrations.ts) + unit tests
- [x] T003 (medium): Wire migration into FileStore.init + integration test
- [x] T004 (low): Rendering test — audio-only front, full back
- [x] T005 (medium): Sequential autoplay on the Listening front (review.ts/html)
- [x] T006 (high): Dedicated "Listening" deck via `CardTemplate.deckId`, migration deck-creation + relocation, transform.ts re-import stability

## Decisions log
- Reuse existing nt-spanish-2sided note type; new card is a second template, not a new note type (confirmed with user).
- Grading is self-graded Again/Hard/Good/Easy (Anki-style), not typed-answer.
- SideAAudio = Spanish word audio; SideBAudio = Spanish sentence audio (legacy field name mislabel). Both clips already exist per note — no new scraping/content.
- Plan resolutions: OQ1 autoplay = programmatic .play() chained on 'ended' in review.ts only (transformMedia untouched); OQ2 = keep visible <audio controls> as fallback, no text; OQ3 = back-to-back, no gap; OQ4 = standard new-card limit, no special handling.
- Autoplay lives only in review.ts keyed off the Listening front, so req 13 (other cards unchanged) holds without a shared-renderer flag (resolves CRITIQUE finding 2).
- Migration gates per-note on "missing ord-1 card" for idempotency/crash-safety; reconcileNoteCards preserves ord-0 scheduling (only bumps modified).
- Scope change (2026-07-14, user request, pre-commit): Listening cards must live in a dedicated top-level "Listening" deck, not the note's own deck — superseding original req 8. There are no "books" as decks anymore in the live data (just one flat Anki-style deck), so the target is a single global deck, not per-book subdecks. Implemented via `CardTemplate.deckId` (new optional model field) resolved per-ord in `reconcileNoteCards`, the migration (deck creation + relocation of already-created ord-1 cards), and `transform.ts` (re-import stability). See PLAN T006.

## Discovered
- T001: adding the Listening template makes every nt-spanish-2sided note generate 2 cards, which cascaded to importer tests (server/src/import/transform.test.ts) — updated in T001 to expect 2 cards (ord 0 A→B + ord 1 Listening). Sound and necessary; verified the diff. Slightly beyond T001's named files but a required consequence of the seed change.
- notetypes.json is seeded only when the file is absent (FileStore.init, server/src/store/file-store.ts:99,108). Editing seed.ts alone will NOT reach existing installs — spec requires a startup migration that adds the template + reconciles cards. (Captured in SPEC req 5-8, PLAN T002/T003.)
- Audio currently renders as `<audio controls preload="none">` via transformMedia (web/src/app/core/templating/template-renderer.ts:113) — no autoplay today. Sequential autoplay is new behaviour; browser autoplay policy + innerHTML injection is a real risk. (Resolved in PLAN OQ1: programmatic .play() in review.ts.)
- Listening afmt cannot reuse {{FrontSide}} for SideA text because the front is audio-only. (Captured in SPEC req 3, PLAN T001 afmt.)
- Front-end needs no rendering-code change to produce the audio-only front — the qfmt/afmt come from the server note type and drive renderCard directly. Only autoplay is new front-end code.
- The migration fired against the LIVE dev store during T005 (dev server running): data/spanish/notetypes.json gained the Listening template and data/spanish/cards.json gained 3638 ord-1 "new" cards (one per note). Both are tracked files — these are legitimate feature changes, effectively an in-vivo /verify of T002/T003. Commit them with the feature.

## Summary (feature complete)
Added a "Listening" card template (ord 1) to the nt-spanish-2sided note type. Front plays SideAAudio (word) then SideBAudio (sentence) sequentially with no text; back reveals full content; self-graded Again/Hard/Good/Easy. Delivered via:
- T001 seed.ts LISTENING_TEMPLATE (+ cascade fix to transform.test.ts).
- T002 pure idempotent migrateAddListeningTemplate (migrations.ts) preserving ord-0 scheduling.
- T003 wired migration into FileStore.init (ordered awaited flushes).
- T004 rendering test (audio-only front, full back).
- T005 sequential autoplay in review.ts via afterRenderEffect over #questionHost, gated on the Listening template only; visible controls as fallback; transformMedia untouched.
Migration fired in-vivo on the dev store: data/spanish/notetypes.json + 3638 ord-1 cards. Tests: server 32, web 183, all green. Drift audit APPROVE (0 blockers; 1 NIT — req-12 test checks DOM absence rather than the state flag).

## Next action
Feature complete and verified. T006 production code + live-store migration were
already in place; the remaining T006 test suite is now written and green:
- migrations.test.ts / file-store.migration.test.ts: fixtures pass `decks`, assert
  the Listening deck is created and ord-1 cards land in `dec-listening` (not the
  note's own deck); relocation preserves scheduling byte-for-byte; idempotent
  second run is all-false.
- generate.test.ts: template `deckId` override pins new cards and self-heals drift.
- transform.test.ts: re-import keeps ord-1 cards in `dec-listening` and carries the
  Listening deck through the full decks.json replacement.
Tests: server 37, web 183, all green. Live data already migrated
(`data/spanish/decks.json` has the Listening deck; all 3638 ord-1 cards in
`dec-listening`). Ready to commit the feature (include the `data/spanish/` store
changes). Optional: `/code-review` before commit.

## Blockers
(none)
