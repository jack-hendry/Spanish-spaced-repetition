import { describe, expect, it } from 'vitest';

import type { Card } from '../models/index.js';
import { transformBooks, type SourceBook } from './transform.js';
import { LISTENING_DECK_ID, buildListeningDeck } from '../store/seed.js';

const book: SourceBook = {
  slug: 'demo',
  root: {
    Menu_ID: 1,
    MenuTitle: 'Demo Spanish',
    children: [
      {
        Menu_ID: 2,
        MenuTitle: 'Chapter 1',
        children: [
          {
            Menu_ID: 3,
            MenuTitle: 'Flashcards: Study Mode',
            DeckType: 'Flashcards: Study Mode',
            cards: [
              {
                Card_ID: 100,
                SideA: 'aunt',
                SideB: 'la tía',
                SideAAudio: 'https://x.s3.amazonaws.com/a.mp3',
                SideBAudio: null,
                SideAImage: null,
                SideBImage: 'https://x.s3.amazonaws.com/not a url with spaces',
              },
            ],
          },
        ],
      },
    ],
  },
};

const empty = { decks: [], notes: [], cards: [] };

describe('transformBooks', () => {
  it('collapses the study-mode leaf into its parent deck', () => {
    const { decks } = transformBooks([book], empty, 1000);
    const names = decks.map((d) => d.name);
    expect(names).toContain('Demo Spanish');
    expect(names).toContain('Demo Spanish::Chapter 1');
    // The "Flashcards: Study Mode" container must not become a deck level.
    expect(names).not.toContain('Demo Spanish::Chapter 1::Flashcards: Study Mode');
  });

  it('nests subdecks via parentId', () => {
    const { decks } = transformBooks([book], empty, 1000);
    const root = decks.find((d) => d.name === 'Demo Spanish')!;
    const ch1 = decks.find((d) => d.name === 'Demo Spanish::Chapter 1')!;
    expect(root.parentId).toBeNull();
    expect(ch1.parentId).toBe(root.id);
  });

  it('maps a scraped card to one note + two new cards (A→B and Listening) with media filtered', () => {
    const { notes, cards } = transformBooks([book], empty, 1000);
    expect(notes).toHaveLength(1);
    expect(cards).toHaveLength(2);
    const n = notes[0];
    expect(n.fields.SideA).toBe('aunt');
    expect(n.fields.SideB).toBe('la tía');
    // valid audio url -> [sound:...]
    expect(n.fields.SideAAudio).toBe('[sound:https://x.s3.amazonaws.com/a.mp3]');
    // junk image url (spaces / no extension) -> dropped
    expect(n.fields.SideBImage).toBe('');
    // Both cards should be new
    expect(cards[0].type).toBe('new');
    expect(cards[0].queue).toBe('new');
    expect(cards[1].type).toBe('new');
    expect(cards[1].queue).toBe('new');
    // ords should be 0 and 1
    expect(cards.map((c) => c.ord).sort()).toEqual([0, 1]);
  });

  it('escapes quote/angle-bracket characters in an image URL (audit C1)', () => {
    const malicious: SourceBook = {
      slug: 'demo-xss',
      root: {
        Menu_ID: 1,
        MenuTitle: 'Demo XSS',
        children: [
          {
            Menu_ID: 2,
            MenuTitle: 'Flashcards: Study Mode',
            DeckType: 'Flashcards: Study Mode',
            cards: [
              {
                Card_ID: 200,
                SideA: 'x',
                SideB: 'y',
                SideAAudio: null,
                SideBAudio: null,
                SideAImage: 'https://x.s3.amazonaws.com/"><script>alert(1)</script>.jpg',
                SideBImage: null,
              },
            ],
          },
        ],
      },
    };
    const { notes } = transformBooks([malicious], empty, 1000);
    const html = notes[0].fields.SideAImage;
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('accepts site-relative local audio and generates both directions for spanish2both', () => {
    const twoWay: SourceBook = {
      slug: 'phrasal',
      root: {
        Menu_ID: 9,
        MenuTitle: 'Phrasal Verbs',
        noteType: 'spanish2both',
        children: [
          {
            Menu_ID: 10,
            MenuTitle: 'Flashcards: Study Mode',
            DeckType: 'Flashcards: Study Mode',
            cards: [
              {
                Card_ID: 200,
                SideA: 'to call off',
                SideB: 'cancelar',
                SideAAudio: '/media/200-to-call-off.mp3',
                SideBAudio: null,
                SideAImage: null,
                SideBImage: null,
              },
            ],
          },
        ],
      },
    };
    const { notes, cards } = transformBooks([twoWay], empty, 1000);
    expect(notes).toHaveLength(1);
    // local path survives as a [sound:] marker
    expect(notes[0].fields.SideAAudio).toBe('[sound:/media/200-to-call-off.mp3]');
    expect(notes[0].noteTypeId).toBe('nt-spanish-2sided-both');
    // both study directions -> two cards (ord 0 and ord 1)
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.ord).sort()).toEqual([0, 1]);
  });

  it('is idempotent and preserves scheduling on re-import', () => {
    const first = transformBooks([book], empty, 1000);
    // Simulate the ord-0 card having been reviewed.
    const reviewed: Card = {
      ...first.cards[0],
      type: 'review',
      queue: 'review',
      interval: 15,
      ease: 2400,
      reps: 3,
      due: 50,
    };
    const second = transformBooks(
      [book],
      { decks: first.decks, notes: first.notes, cards: [reviewed] },
      2000,
    );
    expect(second.cards).toHaveLength(2);
    // ord-0 card should be preserved with its review state
    expect(second.cards.find((c) => c.ord === 0)?.id).toBe(first.cards[0].id);
    expect(second.cards.find((c) => c.ord === 0)?.type).toBe('review');
    // ord-1 card (Listening) should be new
    expect(second.cards.find((c) => c.ord === 1)?.type).toBe('new');
    expect(second.cards[0].interval).toBe(15);
    expect(second.cards[0].reps).toBe(3);
    // deck ids stable too
    expect(second.decks.map((d) => d.id).sort()).toEqual(
      first.decks.map((d) => d.id).sort(),
    );
  });

  it('imports the ord-1 Listening card into the dedicated Listening deck', () => {
    const { cards } = transformBooks([book], empty, 1000);
    const ord1 = cards.find((c) => c.ord === 1)!;
    expect(ord1.deckId).toBe(LISTENING_DECK_ID);
    // ord-0 stays in the book's own deck.
    expect(cards.find((c) => c.ord === 0)!.deckId).not.toBe(LISTENING_DECK_ID);
  });

  it('keeps a re-imported Listening card in the Listening deck and carries the deck through', () => {
    const first = transformBooks([book], empty, 1000);
    // Simulate a Listening card that had drifted into the book deck, and an
    // existing Listening deck (created by the startup migration).
    const drifted: Card = {
      ...first.cards.find((c) => c.ord === 1)!,
      deckId: 'some-book-deck',
    };
    const existing = {
      decks: [...first.decks.filter((d) => d.id !== LISTENING_DECK_ID), buildListeningDeck()],
      notes: first.notes,
      cards: [first.cards.find((c) => c.ord === 0)!, drifted],
    };

    const second = transformBooks([book], existing, 2000);

    // The re-imported ord-1 card is pinned back to the Listening deck.
    expect(second.cards.find((c) => c.ord === 1)!.deckId).toBe(LISTENING_DECK_ID);
    // The Listening deck survives the full decks.json replacement.
    expect(second.decks.some((d) => d.id === LISTENING_DECK_ID)).toBe(true);
  });
});
