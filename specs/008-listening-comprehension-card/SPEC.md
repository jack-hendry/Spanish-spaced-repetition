# SPEC: Listening-comprehension card template

## Problem
Every `nt-spanish-2sided` note already carries two Spanish audio clips — a
spoken word (`SideAAudio`) and a spoken example sentence (`SideBAudio`, a
legacy field-name mislabel) — but they are only ever heard while reading the
text on the existing `A → B` card. Learners get no drill that trains pure
listening comprehension: hearing Spanish audio and recalling its meaning
without seeing the words. The content to support this already exists; only a
new way to study it is missing.

## Goals
- Add a second card **template** ("Listening") to the existing
  `nt-spanish-2sided` note type.
- Front face: play `SideAAudio` (word) then `SideBAudio` (sentence), with **no
  text or images** shown, so the learner guesses meaning from audio alone.
- Back face: reveal the same word/sentence content the `A → B` card's answer
  shows (SideA + SideB text, images, audio) so the learner can self-check.
- Grade with the normal Again/Hard/Good/Easy self-grading.
- Every existing note gains a Listening card automatically, with its own
  independent scheduling state, without disturbing the existing card.
- Listening cards live in a single dedicated top-level **"Listening"** deck,
  separate from the deck the note otherwise belongs to, so the note's original
  deck contains only its existing (ord-0) card and is otherwise unchanged.

## Non-goals (explicitly OUT of scope)
- **No new note type.** This is a template added to `nt-spanish-2sided` only.
  `nt-spanish-2sided-both` and all other note types are untouched.
- **No new scraping, content, media, or audio generation.** Both clips already
  exist per note; `scrape.py`, the converter, and the importer are unchanged.
- **No typed-answer grading.** The Listening card is pure self-grade; no
  `{{type:}}` filter, no input box.
- **No changes to scheduling math** (SM-2, FSRS, study-queue, daily limits,
  burying). The two cards of a note schedule independently using the existing
  machinery only.
- **No change to how the `A → B` (ord 0) card renders, plays, or schedules.**
- No per-card autoplay setting, no replay/speed controls, no UI to
  enable/disable the template.

## Requirements
Testable, numbered.

### Note type / template change
1. `nt-spanish-2sided` MUST gain a second template named **"Listening"** at
   **ord 1**; the existing `A → B` template stays at ord 0 unchanged.
2. The Listening `qfmt` MUST render only the two audio clips
   (`SideAAudio` then `SideBAudio`, word before sentence) and MUST NOT render
   `SideA`, `SideB`, `SideAImage`, or `SideBImage` text/images.
3. The Listening `afmt` MUST reveal the full study content: `SideA` text +
   `SideAImage` + `SideAAudio`, and `SideB` text + `SideBImage` + `SideBAudio`.
   Because the front is audio-only, the answer MUST NOT rely on `{{FrontSide}}`
   to surface the SideA text.
4. The seed definition (`server/src/store/seed.ts`) MUST include the new
   template so fresh installs get it, and the Angular model mirror in
   `web/src/app/core/models/` MUST stay consistent with the server model.

### Migration into existing installs
5. `notetypes.json` is only seeded when the file is absent
   (`FileStore.init`), so existing installs already have a one-template
   `nt-spanish-2sided`. A **startup migration** MUST add the Listening template
   to the persisted note type if it is missing, and persist the change.
6. After adding the template, the migration MUST run `reconcileNoteCards` for
   every note of `nt-spanish-2sided` so each note gains its ord-1 Listening
   card as a fresh **"new"** card, then persist `cards.json`.
7. The migration MUST preserve existing ord-0 cards' scheduling state exactly
   (reconcile keeps surviving ords untouched) and MUST be idempotent — running
   it again adds nothing and changes no scheduling.
8. New Listening cards MUST be created in a dedicated, fixed top-level deck
   named **"Listening"** (a single global deck, not per-book/per-deck), not the
   note's own deck, with new-queue positions that do not collide with existing
   new cards in that deck. The migration MUST create the "Listening" deck if it
   does not yet exist.
8a. If any ord-1 Listening cards were previously created in the note's own deck
   (e.g. from a prior run of this migration before the dedicated-deck decision),
   a corrective migration step MUST relocate them into the "Listening" deck,
   preserving all scheduling state — only `deckId` (and `modified`) change.
8b. Re-running the book importer (`import/transform.ts` via `npm run import`)
   MUST NOT move Listening cards back into the note's book deck; the "Listening"
   deck assignment MUST be stable across re-imports, just as scheduling state
   is.

### Front-end rendering & playback
9. On the Listening front face, the two clips MUST play **automatically and
   sequentially** (word first, then sentence) on card display, without the
   learner pressing play.
10. The front face MUST show no word/sentence text or images — audio only.
11. The back face MUST render exactly as required by requirement 3, using the
    existing `[sound:…]` → audio and image rendering path.
12. Grading MUST use the standard reveal-then-rate flow (Show answer, then
    Again/Hard/Good/Easy, keyboard 1–4 / space), identical to a normal card.
    No type-in input appears.
13. Rendering the Listening card MUST NOT change how any other card
    (including the `A → B` card) plays audio; existing cards keep their current
    manual `<audio controls>` behaviour unless a shared change is explicitly
    agreed.

## Acceptance criteria
- A fresh install seeds `nt-spanish-2sided` with two templates (`A → B` ord 0,
  `Listening` ord 1); a note of that type generates two cards (ord 0, ord 1).
- Starting the server against a pre-existing store that has the one-template
  note type results, after startup, in every `nt-spanish-2sided` note having an
  ord-1 Listening card in "new" state, with ord-0 cards' ease/interval/FSRS and
  review history unchanged.
- After startup, a "Listening" deck exists and contains exactly the ord-1
  Listening cards for every `nt-spanish-2sided` note; the note's original deck
  contains only its ord-0 card, unchanged from before the feature.
- Re-running `npm run import` leaves every Listening card's deck assignment as
  "Listening" (does not reset it to the book's deck).
- Studying a Listening card: the front shows no text, plays word audio then
  sentence audio automatically; Show answer reveals SideA + SideB text, images
  and audio; grading Again/Hard/Good/Easy advances and schedules the card
  independently of its ord-0 sibling.
- Re-running the migration (restart) creates no duplicate cards and alters no
  scheduling state.

## Open questions
- **OQ1 (autoplay policy):** Browser autoplay policies commonly block audio
  that plays without a user gesture, and card HTML is injected via
  `innerHTML` (`bypassSecurityTrustHtml`) where an `autoplay` attribute on
  dynamically-inserted `<audio>` is unreliable. How should the front face
  reliably trigger sequential playback (e.g. programmatic `.play()` after
  render, chained on `ended`, possibly behind the first study gesture)? The
  plan must resolve the mechanism; this spec only fixes the required behaviour
  (req 9).
- **OQ2:** Should the front face render a visible audio/replay affordance at
  all (e.g. a play button as a fallback when autoplay is blocked), or stay
  strictly text-free with an invisible player? Current assumption: audio-only,
  no visible text; a minimal fallback control is acceptable if autoplay fails.
- **OQ3:** Should the two front clips have a short gap/pause between word and
  sentence, or play back-to-back? Current assumption: back-to-back on `ended`.
- **OQ4:** Do existing installs want the new Listening cards subject to the
  normal new-cards-per-day limit (a large back-catalogue means a burst of new
  cards)? Current assumption: yes, they flow through the standard new-card
  limit like any other new card — no special handling.
