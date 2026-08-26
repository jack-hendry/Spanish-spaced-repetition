# SPEC: spanish-vocab-apkg-import

## Summary

Import the Anki deck `10000_Spanish_Vocabulary_Part_1_of_3.apkg` into this app
as a studyable Spanish deck. The work is primarily to teach
`tools/convert_apkg.py` to understand this deck's 8-field note model (it is
currently hardcoded for a simpler "Front, Back, Audio" layout), emit the
canonical source-JSON + local media, so that `npm run import` produces a deck
with a Spanish phrase, an English phrase, and audio on each card.

## Motivation

The user has this deck and wants it studyable in the app. The existing
converter only handles a 3-field deck, so this deck (3639 notes, custom
"Spanish Vocabulary Practice" model) cannot currently be imported correctly.

## Facts about the deck (verified)

- Path: `/Users/jhend/Downloads/10000_Spanish_Vocabulary_Part_1_of_3.apkg` (~251 MB),
  containing `collection.anki21`, a `media` map, and numbered media files.
- 3639 notes: 3638 use model **"Spanish Vocabulary Practice"** (fields, in order:
  `Spanish`, `English`, `Spanish Sentence`, `Cloze Sentence`, `English Sentence`,
  `Image`, `Vocab Audio`, `Sentence Audio`); 1 stray note uses built-in **"Basic"**.
- `Vocab Audio` and `Sentence Audio` are BOTH Spanish azure-TTS clips (the word,
  and the example sentence). There is **no English audio** anywhere in the deck.
- Field values carry stray leading/trailing whitespace; `Image` is empty in samples.
- Audio values look like `[sound:azure-<uuid>.mp3]`.

## What the importer consumes (verified, grounds these requirements)

`server/src/import/transform.ts` reads only these per-card fields: `SideA`,
`SideB`, `SideAAudio`, `SideBAudio`, `SideAImage`, `SideBImage`. Audio values
are accepted only if they are a clean `http(s)://…` URL or a `/media/…` local
path (`mediaAudio`); anything else is dropped. `noteType: "spanish2both"`
produces two cards per note (A→B and B→A); `"spanish2"` produces one (A→B).
There are only two audio slots per card (SideAAudio, SideBAudio) — this deck
has two distinct Spanish clips, so both slots can be used.

## Open Questions / Assumptions (need human confirmation)

1. **No English audio.** The user expected "english and spanish audio", but the
   deck has two *Spanish* clips (word + sentence) and no English audio. Assume
   we import the two Spanish clips as-is; do not synthesise English audio.
2. **Study direction / front side.** Recommend SideA = **Spanish**, SideB =
   **English** (see Spanish, recall English). Confirm this vs. English-front.
3. **One direction or both.** Recommend `noteType: "spanish2"` (single A→B,
   ~3638 cards, matching the user's "each card" expectation) over `"spanish2both"`
   (which doubles card count). Confirm.
4. **Two audio clips → two slots.** Recommend `Vocab Audio` → `SideAAudio`
   (plays with the Spanish word) and `Sentence Audio` → `SideBAudio` (plays on
   the answer). Confirm, or drop the sentence clip.
5. **Example sentences.** Recommend appending `Spanish Sentence` under the
   Spanish side and `English Sentence` under the English side as context text.
   Confirm, or keep cards word-only.
6. **Stray "Basic" note.** Recommend skipping it (logged), since it does not fit
   the 8-field model. Confirm vs. mapping it into Front/Back.

## Requirements

1. The converter MUST select notes by their Anki model and map fields by
   **name**, not by fixed positional index, so the 8-field "Spanish Vocabulary
   Practice" model is read correctly.
2. Per note, it MUST populate the source-JSON card as: `SideA` = Spanish text,
   `SideB` = English text, `SideAAudio` = the local `/media/…` path for
   `Vocab Audio`, `SideBAudio` = the local `/media/…` path for `Sentence Audio`
   (per open questions 2–5). `SideAImage`/`SideBImage` = null when `Image` empty.
3. All imported field text MUST be whitespace-trimmed.
4. Every referenced audio file MUST be copied into `data/spanish/media/` and
   referenced as a `/media/<name>` path (the only local form the importer
   accepts). A note whose audio file cannot be resolved is still imported
   (text-only) and the miss is counted/logged.
5. The output MUST be a single McGraw-Hill-shaped book JSON in
   `data/spanish/_source/`, plus an updated `_source/_index.json` row, so
   `npm run import` picks it up with no further flags.
6. Deck title and slug MUST derive from the deck, not the hardcoded
   "550+ Phrasal Verbs" default. Recommended title
   "10000 Spanish Vocabulary (Part 1 of 3)", slug `10000-spanish-vocabulary-part-1-of-3`.
7. The stray "Basic" note MUST be handled deterministically (skip + log per
   open question 6), never silently produce a malformed card.
8. `noteType` in the emitted book MUST be a value the transform recognises
   (`"spanish2"` or `"spanish2both"`), per open question 3.

## Acceptance Criteria

1. Running the converter on the apkg produces `data/spanish/_source/<slug>.json`
   containing ~3638 cards (± the skipped Basic note), each with non-empty
   `SideA` and `SideB`.
2. Cards have `SideAAudio` (and, per open q4, `SideBAudio`) set to `/media/…`
   paths, and the referenced files exist under `data/spanish/media/`.
3. `npm run import` completes successfully and the new deck appears in the app's
   deck list with a positive due count; a study card shows Spanish, English, and
   plays audio.
4. Re-running the converter + import reconciles in place (stable guids from
   `(slug, Card_ID)`) and does not duplicate the deck or lose scheduling state.

## Out of Scope

- Building a general multi-model apkg import framework; changes target this
  deck's model (plus the existing simple layout) only.
- Any change to scheduling, study-queue, or note-type templates in the app.
- Treating `Cloze Sentence` as real cloze cards, or generating cloze note types.
- Importing images (the `Image` field is empty here) beyond null-safe handling.
- Synthesising or sourcing English audio.
- Parts 2 and 3 of the deck.
- Changes to `server/`, `web/`, or the canonical data model.
