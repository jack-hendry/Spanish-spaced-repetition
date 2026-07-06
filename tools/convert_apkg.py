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


def convert(args):
    os.makedirs(SOURCE_DIR, exist_ok=True)
    os.makedirs(MEDIA_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        extract_apkg(args.apkg, tmp)
        conn = open_collection(tmp)
        filename_to_number = load_media_map(tmp)

        rows = conn.execute("SELECT id, flds FROM notes ORDER BY id").fetchall()
        conn.close()

        cards = []
        copied = 0
        missing_media = 0
        for note_id, flds in rows:
            fields = flds.split(FIELD_SEP)
            front = fields[args.front].strip() if len(fields) > args.front else ""
            back = fields[args.back].strip() if len(fields) > args.back else ""
            if not front and not back:
                continue

            audio_url = None
            joined = FIELD_SEP.join(fields)
            m = SOUND_RE.search(joined)
            if m:
                orig = m.group(1)
                number = filename_to_number.get(orig)
                if number is not None:
                    src = os.path.join(tmp, number)
                    dest_name = "{}-{}.mp3".format(number, slugify(os.path.splitext(orig)[0]))
                    dest = os.path.join(MEDIA_DIR, dest_name)
                    if os.path.exists(src):
                        shutil.copyfile(src, dest)
                        copied += 1
                        audio_url = "/media/" + dest_name
                    else:
                        missing_media += 1
                else:
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

    book = {
        "Menu_ID": stable_menu_id(args.title),
        "MenuTitle": args.title,
        "language": "Spanish",
        "noteType": "spanish2both",
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
    parser.add_argument("--slug", help="Output basename (default derived from the file)")
    parser.add_argument("--title", help="Deck title shown in the app")
    parser.add_argument("--front", type=int, default=0, help="Field index for the English/front text")
    parser.add_argument("--back", type=int, default=1, help="Field index for the Spanish/back text")
    args = parser.parse_args()

    if not os.path.exists(args.apkg):
        raise SystemExit("No such file: " + args.apkg)

    base = os.path.splitext(os.path.basename(args.apkg))[0]
    if not args.slug:
        args.slug = slugify(base)
    if not args.title:
        args.title = "550+ Phrasal Verbs Part 1 (English–Spanish)"

    convert(args)


if __name__ == "__main__":
    main()
