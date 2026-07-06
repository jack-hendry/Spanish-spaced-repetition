import { describe, expect, it } from 'vitest';

import type { Card } from '../models/index.js';
import { transformBooks, type SourceBook } from './transform.js';

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

  it('maps a scraped card to one note + one new card with media filtered', () => {
    const { notes, cards } = transformBooks([book], empty, 1000);
    expect(notes).toHaveLength(1);
    expect(cards).toHaveLength(1);
    const n = notes[0];
    expect(n.fields.SideA).toBe('aunt');
    expect(n.fields.SideB).toBe('la tía');
    // valid audio url -> [sound:...]
    expect(n.fields.SideAAudio).toBe('[sound:https://x.s3.amazonaws.com/a.mp3]');
    // junk image url (spaces / no extension) -> dropped
    expect(n.fields.SideBImage).toBe('');
    expect(cards[0].type).toBe('new');
    expect(cards[0].queue).toBe('new');
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
    // Simulate the card having been reviewed.
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
    expect(second.cards).toHaveLength(1);
    expect(second.cards[0].id).toBe(first.cards[0].id);
    expect(second.cards[0].type).toBe('review');
    expect(second.cards[0].interval).toBe(15);
    expect(second.cards[0].reps).toBe(3);
    // deck ids stable too
    expect(second.decks.map((d) => d.id).sort()).toEqual(
      first.decks.map((d) => d.id).sort(),
    );
  });
});
