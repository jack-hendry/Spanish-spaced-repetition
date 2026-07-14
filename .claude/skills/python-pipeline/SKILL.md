---
name: python-pipeline
description: The content pipeline contract — scrape.py / tools/convert_apkg.py output shape, the (slug, Card_ID) identity rule that re-import scheduling survival depends on, media handling, and how to verify without a Python test suite. Read before touching scrape.py, convert_apkg.py, the importer, or any _source/*.json shape.
---

# Python content pipeline

Verified against source 2026-07-07. If code and this file disagree, trust the
code and update this file.

Flow: `scrape.py` / `tools/convert_apkg.py` → McGraw-Hill-shaped book JSON →
`npm run import` (`server/src/import/`) normalises into the canonical store.
Both Python tools emit the same shape; `server/src/import/transform.ts` is the
single consumer.

## The identity contract (breaking it loses review history)

In `transform.ts`: `guid = sha1("${book.slug}:${sc.Card_ID}").slice(0,16)`;
note id = `n{guid}`, card id = `c{guid}-{ord}`, deck id = `d{hash(fullName)}`
(reused by *name* from existing decks). Re-import preserves scheduling only
because these are deterministic. Therefore:

- **The source filename is identity.** `book.slug` is the `_source/*.json`
  basename — renaming the file orphans every note's scheduling state.
- **`Card_ID` must be stable per card.** The scraper uses the upstream API's
  `Card_ID`; the converter uses the Anki note id (stable across re-exports of
  the same deck). Never generate `Card_ID`s positionally.
- Renaming a deck/book title changes deck *names*, so cards move to
  fresh decks — survivable, but don't do it casually.
- `Menu_ID` is NOT part of identity (only `_index.json` cosmetics);
  `stable_menu_id()` in the converter just keeps files diff-stable.

## Source book JSON shape

```
root: { Menu_ID, MenuTitle, language, noteType?, children: [node] }
node: { Menu_ID, MenuTitle, DeckType, children?: [node], cards?: [card] }
card: { Card_ID, SideA, SideB, SideAAudio, SideBAudio, SideAImage, SideBImage }
```

- Nested branch nodes become `::`-joined subdecks; a node that carries `cards`
  is **collapsed into its parent** (its own title, usually "Flashcards: Study
  Mode", is dropped from the deck path).
- Optional root `noteType: "spanish2both"` generates both study directions;
  default is `spanish2` (one card per note).
- Media fields must be a clean `http(s)://` URL or a local `/media/...` path;
  anything else is silently dropped by the importer. Audio becomes
  `[sound:url]`, images `<img src>` (extension-sniffed).

## Tool specifics

`scrape.py` (McGraw Hill Language Lab): walks the Spanish menu tree, keeps
only `DeckType == "Flashcards: Study Mode"`, prunes empty branches, strips
`Base64Image`, rewrites relative media to the S3 `MEDIA_BASE`. Politeness is
deliberate: retry adapter (5 tries, backoff 1.0 — the Azure backend
cold-starts) plus `REQUEST_DELAY = 0.2`s; keep both when editing.
**Quirk:** `OUTPUT_DIR` is `data/spanish/`, NOT `_source/` — outputs must land
in `data/spanish/_source/` before `npm run import` will see them.

`tools/convert_apkg.py`: unzips the apkg, opens `collection.anki21` (falls
back to `.anki2`), splits note fields on 0x1f (`FIELD_SEP`). Model routing:
"Spanish Vocabulary Practice" is special-cased (word + example sentence per
side, two audio fields); "Basic" notes are skipped; any other model uses
positional `--front`/`--back` indices with a single `[sound:...]` field.
Media is copied to `data/spanish/media/` (gitignored, regenerable) as
`{number}-{slug}.mp3` and referenced as `/media/...`. Title/slug default to
the apkg's own main deck name (`pick_deck_name`); pass `--slug` explicitly
when re-converting an existing book so the filename (= identity) matches.

Python style: stdlib + `requests` only (`requirements.txt`, not npm); scripts
run directly, no package structure.

## Verification (there is no Python test suite)

1. Run the tool against real input (a sample `.apkg`, or one book for the
   scraper) and check its printed tallies (converted/skipped/missing-media).
2. `npm run import`, then confirm: expected note/card counts, and — for a
   re-convert of an existing book — that note/card ids in
   `data/spanish/notes.json`/`cards.json` are unchanged and reviewed cards
   kept their `queue`/`due`/`reps`.
3. The importer's own logic is covered by `server/src/import/transform.test.ts`
   — extend that (see [[testing-playbook]]) when changing the contract, and
   keep this file plus both Python emitters in sync with it.

## Lessons (auto-appended)

Dated entries promoted from feature STATE.md Pitfalls by the critic's drift
audit. Append-only; humans prune. If a lesson contradicts the body above,
trust the code, then fix both.

_None yet._
