#!/usr/bin/env python3
"""Scrape Spanish two-sided flashcards from McGraw Hill Language Lab.

The Language Lab web app (https://mhe-language-lab.s3.amazonaws.com/index.html)
is an Ionic app backed by a REST API. Content is a menu tree:

    GetSubMenus?parentID=0           -> languages (Spanish = Menu_ID 5)
    GetSubMenus?parentID=<menuID>    -> children of any node
    branch nodes have DeckType == "N/A"; leaf decks have a real DeckType
    GetFlashCards?menuID=<id>        -> the cards for a "Flashcards: Study Mode" leaf

We walk the Spanish subtree and save, one JSON file per book, every
"Flashcards: Study Mode" deck (both sides of each card). All other deck types
(Quiz Mode, Review Quiz, Glossary, Record Yourself, Single Sided) are skipped.

Usage:
    pip install -r requirements.txt
    python scrape.py
"""

import json
import re
import sys
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter, Retry

API_BASE = "https://mhe-language-lab.azurewebsites.net/api/"
MEDIA_BASE = "https://mhelanguagelab.s3.amazonaws.com/"
SPANISH_ID = 5
OUTPUT_DIR = Path(__file__).parent / "data" / "spanish"
REQUEST_DELAY = 0.2  # polite pause between API calls (seconds)

# The only deck type we keep — two-sided flashcards.
FLASHCARD_DECK = "Flashcards: Study Mode"

# Per-card fields that hold relative media paths needing the S3 prefix.
MEDIA_FIELDS = (
    "SideAAudio", "SideBAudio",
    "SideAImage", "SideBImage",
    "SideAVideo", "SideBVideo",
)

session = requests.Session()
session.mount(
    "https://",
    HTTPAdapter(max_retries=Retry(
        total=5,
        backoff_factor=1.0,  # the Azure backend cold-starts and can be slow
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )),
)


def api_get(endpoint):
    """GET an API endpoint and return parsed JSON, or [] on failure."""
    try:
        resp = session.get(API_BASE + endpoint, timeout=60)
        resp.raise_for_status()
        time.sleep(REQUEST_DELAY)
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        print(f"  ! request failed for {endpoint}: {exc}", file=sys.stderr)
        return []


def resolve_media(card):
    """Rewrite relative media paths on a card to fully-qualified S3 URLs."""
    for field in MEDIA_FIELDS:
        value = card.get(field)
        if value and not value.startswith("http"):
            card[field] = MEDIA_BASE + value
    return card


def fetch_cards(leaf):
    """Return the flashcards for a leaf, or [] if it is not a flashcard deck."""
    if leaf.get("DeckType") != FLASHCARD_DECK:
        return []
    cards = api_get(f"GetFlashCards?menuID={leaf['Menu_ID']}")
    return [resolve_media(c) for c in cards]


def walk(menu_id, visited):
    """Recursively build the flashcard-only subtree under menu_id.

    Returns a list of node dicts. Branch nodes with no flashcards anywhere
    beneath them are pruned out.
    """
    if menu_id in visited:
        return []
    visited.add(menu_id)

    nodes = []
    for child in api_get(f"GetSubMenus?parentID={menu_id}"):
        child.pop("Base64Image", None)  # large inline PNG; not needed
        deck_type = child.get("DeckType")
        node = {
            "Menu_ID": child["Menu_ID"],
            "MenuTitle": child.get("MenuTitle"),
            "DeckType": deck_type,
        }

        if deck_type and deck_type != "N/A":
            cards = fetch_cards(child)
            if cards:  # keep only flashcard decks that actually have cards
                node["cards"] = cards
                nodes.append(node)
        else:
            children = walk(child["Menu_ID"], visited)
            if children:  # prune empty branches
                node["children"] = children
                nodes.append(node)

    return nodes


def count_cards(nodes):
    """Total flashcards in a subtree."""
    total = 0
    for node in nodes:
        total += len(node.get("cards", []))
        total += count_cards(node.get("children", []))
    return total


_TAG_RE = re.compile(r"<[^>]+>")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title):
    """Filesystem-safe slug from a (possibly HTML-tagged) book title."""
    text = _TAG_RE.sub("", title or "").lower()
    return _SLUG_RE.sub("-", text).strip("-") or "untitled"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    books = api_get(f"GetSubMenus?parentID={SPANISH_ID}")
    print(f"Found {len(books)} Spanish books.\n")

    index = []
    for book in books:
        book.pop("Base64Image", None)
        title = book.get("MenuTitle", "")
        plain_title = _TAG_RE.sub("", title)
        slug = slugify(title)
        print(f"Scraping: {plain_title} (Menu_ID {book['Menu_ID']})")

        children = walk(book["Menu_ID"], set())
        n_cards = count_cards(children)

        book_data = {
            "Menu_ID": book["Menu_ID"],
            "MenuTitle": title,
            "language": "Spanish",
            "children": children,
        }
        filename = f"{slug}.json"
        out_path = OUTPUT_DIR / filename
        out_path.write_text(
            json.dumps(book_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  -> {filename}: {n_cards} flashcards\n")

        index.append({
            "Menu_ID": book["Menu_ID"],
            "title": plain_title,
            "file": filename,
            "card_count": n_cards,
        })

    (OUTPUT_DIR / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total = sum(b["card_count"] for b in index)
    print(f"Done. {len(index)} books, {total} flashcards total.")
    print(f"Output written to {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
