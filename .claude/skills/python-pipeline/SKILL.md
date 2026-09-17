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

Dated entries for domain gotchas that belong next to the rules above, added
during the archive ritual in `specs/STATE.md` (step 2) by whoever closes the
feature. Append-only; humans prune. If a lesson contradicts the body above,
trust the code, then fix both.

Project and process lessons go to `specs/STATE.md` + `specs/LESSONS.md` as
`L-NNN` instead -- that pair is what the pre-push gate enforces (AD-009).

### 2026-09-17 — Moving `media/` off macOS carries AppleDouble junk, and `ls | wc -l` cannot see it

(`specs/archive/2026-09-17-021-fly-deploy` Step 15)

Seeding the Fly volume meant tarring `data/spanish/` on macOS and extracting on
Linux. macOS `tar` embeds extended attributes as **AppleDouble** entries, so the
extract created **7250** `._*` files on the remote: one shadowing every mp3 in
`media/`, seven shadowing the top-level JSON files, two in `_source/`.

The integrity check missed all of them. It was:

```sh
ls /data/spanish/media | wc -l     # reported a clean 7241 = 7241
```

**`ls` hides dotfiles by default, and `._foo.mp3` begins with a dot.** The count
was right and the directory was dirty. Found only by cross-checking with
`find /data/spanish -name '._*' -type f | wc -l`, and cleared with the same
predicate plus `-delete` (after listing them by name first). Re-verified
afterwards: media still 7241, all seven JSON files still byte-identical.

Two rules:

- **Transfer out of macOS with `COPYFILE_DISABLE=1 tar …`** (or `--no-xattrs`),
  or the AppleDouble files travel with it.
- **Never use bare `ls` for a count that is acting as an integrity check.** Use
  `ls -A`, or `find`, whenever the thing you are screening for could be a
  dotfile. This is the domain-specific instance of L-019.

Worth knowing for `media/` specifically: it is 252MB and **regenerable** by the
converter, so a contaminated media transfer is always cheaper to redo than to
repair — but the same tar carried the seven state files, which are not.

