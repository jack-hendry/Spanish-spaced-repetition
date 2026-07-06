#!/usr/bin/env python3
"""Convert an Anki .apkg deck into this app's source-JSON + local media.

An .apkg is a zip containing a SQLite collection (`collection.anki21`, or the
older `collection.anki2`), a `media` JSON map of `{"<n>": "<filename>"}`, and
numbered media files. We read the notes, copy their referenced audio into
`data/spanish/media/`, and emit a McGraw-Hill-shaped book JSON into
`data/spanish/_source/` so the normal `npm run import` flow picks it up.

Usage:
    python tools/convert_apkg.py <deck.apkg> [--slug SLUG] [--title TITLE]

The converter is generic: any apkg whose notes have an English/Spanish pair plus
an `[sound:...]` field will convert. Field order is assumed Front, Back, Audio
(the layout of the 550 Phrasal Verbs deck); override with --front/--back if a
deck differs.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile

FIELD_SEP = chr(31)  # Anki separates note fields with the 0x1f unit separator.
SOUND_RE = re.compile(r"\[sound:([^\]]+)\]")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(REPO_ROOT, "data", "spanish", "_source")
MEDIA_DIR = os.path.join(REPO_ROOT, "data", "spanish", "media")


def slugify(text):
    """ASCII-safe slug for a filename component."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:80] or "audio"


def stable_menu_id(name):
    """Deterministic positive int from a deck name (for Menu_ID)."""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return h


def extract_apkg(apkg_path, dest):
    with zipfile.ZipFile(apkg_path) as zf:
        zf.extractall(dest)


def open_collection(extract_dir):
    for name in ("collection.anki21", "collection.anki2"):
        path = os.path.join(extract_dir, name)
        if os.path.exists(path):
            return sqlite3.connect(path)
    raise SystemExit("No collection.anki21/anki2 found inside the .apkg")


def load_media_map(extract_dir):
    """Return {filename: number} so we can locate each referenced media file."""
    media_path = os.path.join(extract_dir, "media")
    if not os.path.exists(media_path):
        return {}
    with open(media_path, encoding="utf-8") as fh:
        mapping = json.load(fh)  # {"<number>": "<filename>"}
    return {filename: number for number, filename in mapping.items()}


def load_models(conn):
    """Return {mid(str): {"name": str, "fields": {field_name: index}}}.

    Reads the JSON blob stored in `col.models`, one row per collection, keyed
    by model id (as a string) -> model object with a `flds` list (each field
    dict has a `name` and an `ord`).
    """
    (models_json,) = conn.execute("SELECT models FROM col").fetchone()
    raw_models = json.loads(models_json)

    models = {}
    for mid, model in raw_models.items():
        field_map = {}
        for field in model.get("flds", []):
            field_map[field["name"]] = field["ord"]
        models[mid] = {"name": model.get("name"), "fields": field_map}
    return models


def pick_deck_name(conn):
    """Pick the deck name to derive the book title/slug from, when --title/
    --slug are not given on the command line.

    Reads the JSON blob in `col.decks` (`{deck_id: {"name": ..., ...}}`) and
    picks the deck whose name is not "Default" (Anki's always-present empty
    deck) — that's the real content deck. If more than one non-Default deck
    exists, pick the one with the most notes (counting distinct `nid` in
    `cards` per `did`); ties are broken by ascending deck id for a
    deterministic result. Falls back to whatever deck exists if every deck is
    named "Default".
    """
    (decks_json,) = conn.execute("SELECT decks FROM col").fetchone()
    raw_decks = json.loads(decks_json)

    note_counts = {}
    for did, nid in conn.execute("SELECT did, nid FROM cards"):
        note_counts.setdefault(str(did), set()).add(nid)

    candidates = [
        (did, deck.get("name", "")) for did, deck in raw_decks.items() if deck.get("name") != "Default"
    ]
    if not candidates:
        candidates = [(did, deck.get("name", "")) for did, deck in raw_decks.items()]

    def sort_key(item):
        did, _name = item
        return (-len(note_counts.get(did, ())), int(did))

    candidates.sort(key=sort_key)
    return candidates[0][1]


def build_spanish_card_fields(fields, field_map):
    """Build SideA/SideB text + raw audio values for the "Spanish Vocabulary
    Practice" model.

    `fields` is a note's split field list; `field_map` is the
    field-name -> index map for the note's model (from `load_models`).
    Returns `(side_a, side_b, vocab_audio_raw, sentence_audio_raw)`, or `None`
    if both Spanish and English are empty (caller should skip the note).

    SideA is the Spanish word, with the Spanish example sentence appended as
    a second line (`"<word><br><sentence>"`) when present; SideB mirrors this
    for English. All text is stripped. The audio field values are returned
    raw/unresolved — extracting and copying the referenced media file happens
    later, in `resolve_audio` (T003).
    """

    def field(name):
        idx = field_map.get(name)
        if idx is None or idx >= len(fields):
            return ""
        return fields[idx].strip()

    spanish = field("Spanish")
    english = field("English")
    if not spanish and not english:
        return None

    spanish_sentence = field("Spanish Sentence")
    english_sentence = field("English Sentence")

    side_a = "{}<br>{}".format(spanish, spanish_sentence) if spanish_sentence else spanish
    side_b = "{}<br>{}".format(english, english_sentence) if english_sentence else english

    vocab_audio_raw = field("Vocab Audio")
    sentence_audio_raw = field("Sentence Audio")

    return side_a, side_b, vocab_audio_raw, sentence_audio_raw


def resolve_audio(raw_value, filename_to_number, tmp):
    """Resolve a single field's raw `[sound:...]` value to a copied media file.

    `raw_value` is one note field's raw text (not joined across fields).
    `filename_to_number` is the `{filename: number}` map from `load_media_map`;
    `tmp` is the directory the .apkg was extracted into (numbered media files
    live there). Copies the referenced file into `MEDIA_DIR` under the
    existing `"{number}-{slug}.mp3"` naming convention.

    Returns `(path, copied)` where `path` is a `/media/<name>` string or
    `None`, and `copied` is `True` only when a new file was actually copied
    (so callers can tally copied vs. missing/unresolved audio). Any
    `None`/empty/unmatched input yields `(None, False)` without raising.
    """
    if not raw_value:
        return None, False

    m = SOUND_RE.search(raw_value)
    if not m:
        return None, False

    orig = m.group(1)
    number = filename_to_number.get(orig)
    if number is None:
        return None, False

    src = os.path.join(tmp, number)
    if not os.path.exists(src):
        return None, False

    dest_name = "{}-{}.mp3".format(number, slugify(os.path.splitext(orig)[0]))
    dest = os.path.join(MEDIA_DIR, dest_name)
    shutil.copyfile(src, dest)
    return "/media/" + dest_name, True


def convert(args):
    os.makedirs(SOURCE_DIR, exist_ok=True)
    os.makedirs(MEDIA_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        extract_apkg(args.apkg, tmp)
        conn = open_collection(tmp)
        filename_to_number = load_media_map(tmp)
        models = load_models(conn)

        if not args.title or not args.slug:
            deck_name = pick_deck_name(conn)
            if not args.title:
                args.title = deck_name
            if not args.slug:
                args.slug = slugify(deck_name)

        rows = conn.execute("SELECT id, mid, flds FROM notes ORDER BY id").fetchall()
        conn.close()

        cards = []
        copied = 0
        missing_media = 0
        matched_spanish = 0
        skipped_basic = 0
        skipped_empty = 0
        for note_id, mid, flds in rows:
            fields = flds.split(FIELD_SEP)
            model = models.get(str(mid), {})
            model_name = model.get("name")

            if model_name == "Spanish Vocabulary Practice":
                built = build_spanish_card_fields(fields, model.get("fields", {}))
                if built is None:
                    skipped_empty += 1
                    continue
                side_a, side_b, vocab_audio_raw, sentence_audio_raw = built

                vocab_audio_url, vocab_copied = resolve_audio(vocab_audio_raw, filename_to_number, tmp)
                if vocab_copied:
                    copied += 1
                elif SOUND_RE.search(vocab_audio_raw or ""):
                    missing_media += 1

                sentence_audio_url, sentence_copied = resolve_audio(sentence_audio_raw, filename_to_number, tmp)
                if sentence_copied:
                    copied += 1
                elif SOUND_RE.search(sentence_audio_raw or ""):
                    missing_media += 1

                matched_spanish += 1
                cards.append(
                    {
                        "Card_ID": note_id,
                        "SideA": side_a,  # Spanish word (+ example sentence)
                        "SideB": side_b,  # English translation (+ example sentence)
                        "SideAAudio": vocab_audio_url,
                        "SideBAudio": sentence_audio_url,
                        "SideAImage": None,
                        "SideBImage": None,
                    }
                )
                continue

            if model_name == "Basic":
                skipped_basic += 1
                continue

            # Any other model: keep the original positional Front/Back +
            # single-audio behaviour (the 550-phrasal-verbs path).
            front = fields[args.front].strip() if len(fields) > args.front else ""
            back = fields[args.back].strip() if len(fields) > args.back else ""
            if not front and not back:
                skipped_empty += 1
                continue

            joined = FIELD_SEP.join(fields)
            audio_url, was_copied = resolve_audio(joined, filename_to_number, tmp)
            if was_copied:
                copied += 1
            elif SOUND_RE.search(joined):
                missing_media += 1

            cards.append(
                {
                    "Card_ID": note_id,
                    "SideA": front,  # English phrase — carries the audio
                    "SideB": back,  # Spanish translation
                    "SideAAudio": audio_url,
                    "SideBAudio": None,
                    "SideAImage": None,
                    "SideBImage": None,
                }
            )

    if skipped_basic:
        print(
            "[convert] skipping {} Basic note{}".format(
                skipped_basic, "" if skipped_basic == 1 else "s"
            )
        )

    book = {
        "Menu_ID": stable_menu_id(args.title),
        "MenuTitle": args.title,
        "language": "Spanish",
        "noteType": "spanish2",
        "children": [
            {
                "Menu_ID": stable_menu_id(args.title + "::study"),
                "MenuTitle": "Flashcards: Study Mode",
                "DeckType": "Flashcards: Study Mode",
                "cards": cards,
            }
        ],
    }

    out_path = os.path.join(SOURCE_DIR, args.slug + ".json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(book, fh, ensure_ascii=False, indent=2)

    update_index(args, len(cards))

    print("[convert] wrote {} ({} cards)".format(out_path, len(cards)))
    print("[convert] matched {} Spanish Vocabulary Practice cards".format(matched_spanish))
    print(
        "[convert] skipped {} notes ({} Basic, {} empty)".format(
            skipped_basic + skipped_empty, skipped_basic, skipped_empty
        )
    )
    print("[convert] copied {} media files to {}".format(copied, MEDIA_DIR))
    if missing_media:
        print("[convert] WARNING: {} cards had unresolved audio".format(missing_media))


def update_index(args, card_count):
    """Add/replace this book's row in _source/_index.json."""
    index_path = os.path.join(SOURCE_DIR, "_index.json")
    index = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)

    file_name = args.slug + ".json"
    index = [row for row in index if row.get("file") != file_name]
    index.append(
        {
            "Menu_ID": stable_menu_id(args.title),
            "title": args.title,
            "file": file_name,
            "card_count": card_count,
        }
    )
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Convert an Anki .apkg into source JSON + media.")
    parser.add_argument("apkg", help="Path to the .apkg file")
    parser.add_argument("--slug", help="Output basename (default derived from the apkg's own deck name)")
    parser.add_argument("--title", help="Deck title shown in the app (default derived from the apkg's own deck name)")
    parser.add_argument("--front", type=int, default=0, help="Field index for the English/front text")
    parser.add_argument("--back", type=int, default=1, help="Field index for the Spanish/back text")
    args = parser.parse_args()

    if not os.path.exists(args.apkg):
        raise SystemExit("No such file: " + args.apkg)

    # Title/slug default to the apkg's own deck name (see `pick_deck_name`) when
    # not given explicitly; that requires the collection to be open, so the
    # derivation happens inside `convert()` rather than here.
    convert(args)


if __name__ == "__main__":
    main()
