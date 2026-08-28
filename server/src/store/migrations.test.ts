import { describe, expect, it } from 'vitest';

import type { Card, Deck, Note, NoteType } from '../models/index.js';
import { migrateAddListeningTemplate } from './migrations.js';
import { LISTENING_DECK_ID } from './seed.js';

const NOW = 1_700_000_000_000;

/** A one-template `nt-spanish-2sided` note type as it exists in a legacy store. */
function oneTemplateNoteType(): NoteType {
  return {
    id: 'nt-spanish-2sided',
    name: 'Spanish 2-sided',
    kind: 'standard',
    fields: [
      { name: 'SideA', ord: 0 },
      { name: 'SideAAudio', ord: 1 },
      { name: 'SideAImage', ord: 2 },
      { name: 'SideB', ord: 3 },
      { name: 'SideBAudio', ord: 4 },
      { name: 'SideBImage', ord: 5 },
    ],
    templates: [
      {
        name: 'A → B',
        ord: 0,
        qfmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}',
        afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
      },
    ],
    css: '',
  };
}

function note(id: string): Note {
  return {
    id,
    noteTypeId: 'nt-spanish-2sided',
    fields: {
      SideA: 'hola',
      SideAAudio: '[sound:a.mp3]',
      SideB: 'hello',
      SideBAudio: '[sound:b.mp3]',
    },
    tags: [],
    created: 0,
    modified: 0,
    guid: id,
  };
}

/** An ord-0 card in the `review` queue with distinctive scheduling state. */
function reviewCard(noteId: string, deckId: string): Card {
  return {
    id: `c${noteId}-0`,
    noteId,
    deckId,
    ord: 0,
    type: 'review',
    queue: 'review',
    due: 42,
    reps: 7,
    lapses: 2,
    left: 0,
    lastReviewed: NOW - 86_400_000,
    created: 1000,
    modified: 2000,
    ease: 2650,
    interval: 21,
    stability: 12.5,
    difficulty: 5.4,
  };
}

/** An ord-1 Listening card sitting (wrongly) in the note's own deck. */
function ord1CardIn(noteId: string, deckId: string): Card {
  return {
    id: `c${noteId}-1`,
    noteId,
    deckId,
    ord: 1,
    type: 'review',
    queue: 'review',
    due: 99,
    reps: 3,
    lapses: 1,
    left: 0,
    lastReviewed: NOW - 172_800_000,
    created: 1500,
    modified: 2500,
    ease: 2400,
    interval: 8,
    stability: 6.1,
    difficulty: 4.2,
  };
}

const SCHEDULING_FIELDS = [
  'type',
  'queue',
  'due',
  'ease',
  'interval',
  'stability',
  'difficulty',
  'reps',
  'lapses',
  'left',
  'lastReviewed',
] as const;

describe('migrateAddListeningTemplate', () => {
  it('adds the Listening template, the Listening deck, and an ord-1 new card, preserving ord-0 scheduling', () => {
    const notetypes = [oneTemplateNoteType()];
    const notes = [note('n1')];
    const before = reviewCard('n1', 'deck-a');
    const cards = [{ ...before }];
    const decks: Deck[] = [];

    const result = migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);

    expect(result).toEqual({ changedNoteTypes: true, changedCards: true, changedDecks: true });

    // Note type gained ord-1 "Listening".
    const listening = notetypes[0].templates.find((t) => t.ord === 1);
    expect(listening?.name).toBe('Listening');

    // The dedicated Listening deck was created.
    expect(decks.find((d) => d.id === LISTENING_DECK_ID)?.name).toBe('Listening');

    // A fresh ord-1 "new" card exists in the dedicated Listening deck, NOT the
    // note's own deck.
    const ord1 = cards.find((c) => c.noteId === 'n1' && c.ord === 1);
    expect(ord1).toBeDefined();
    expect(ord1!.type).toBe('new');
    expect(ord1!.queue).toBe('new');
    expect(ord1!.deckId).toBe(LISTENING_DECK_ID);

    // The ord-0 card stays in its own deck with byte-identical scheduling.
    const ord0 = cards.find((c) => c.noteId === 'n1' && c.ord === 0)!;
    expect(ord0.deckId).toBe('deck-a');
    for (const f of SCHEDULING_FIELDS) {
      expect(ord0[f]).toBe(before[f]);
    }
  });

  it('relocates a pre-existing ord-1 card from the note deck into the Listening deck, preserving scheduling', () => {
    const notetypes = [oneTemplateNoteType()];
    notetypes[0].templates.push({
      name: 'Listening',
      ord: 1,
      qfmt: '{{SideAAudio}}{{SideBAudio}}',
      afmt: '{{SideA}}',
      deckId: LISTENING_DECK_ID,
    });
    const notes = [note('n1')];
    const before = ord1CardIn('n1', 'deck-a');
    const cards = [reviewCard('n1', 'deck-a'), { ...before }];
    const decks: Deck[] = [];

    const result = migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);

    // Template already present → not changed; deck created; card relocated.
    expect(result.changedNoteTypes).toBe(false);
    expect(result.changedDecks).toBe(true);
    expect(result.changedCards).toBe(true);

    const ord1 = cards.find((c) => c.noteId === 'n1' && c.ord === 1)!;
    expect(ord1.deckId).toBe(LISTENING_DECK_ID);
    expect(ord1.modified).toBe(NOW);
    // Every scheduling field is untouched by the relocation.
    for (const f of SCHEDULING_FIELDS) {
      expect(ord1[f]).toBe(before[f]);
    }
  });

  it('is idempotent — a second call changes nothing', () => {
    const notetypes = [oneTemplateNoteType()];
    const notes = [note('n1')];
    const cards = [reviewCard('n1', 'deck-a')];
    const decks: Deck[] = [];

    migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);
    const afterFirst = structuredClone(cards);
    const templatesAfterFirst = structuredClone(notetypes[0].templates);
    const decksAfterFirst = structuredClone(decks);

    const second = migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW + 1);

    expect(second).toEqual({ changedNoteTypes: false, changedCards: false, changedDecks: false });
    expect(cards).toEqual(afterFirst);
    expect(notetypes[0].templates).toEqual(templatesAfterFirst);
    expect(decks).toEqual(decksAfterFirst);
    // No duplicate ord-1, no duplicate Listening deck.
    expect(cards.filter((c) => c.ord === 1)).toHaveLength(1);
    expect(decks.filter((d) => d.id === LISTENING_DECK_ID)).toHaveLength(1);
  });

  it('places new ord-1 cards past the max existing new position', () => {
    const notetypes = [oneTemplateNoteType()];
    const notes = [note('n1'), note('n2')];
    const cards: Card[] = [
      reviewCard('n1', 'deck-a'),
      reviewCard('n2', 'deck-a'),
      // An unrelated card occupying new-queue position 5.
      { ...reviewCard('nX', 'deck-a'), id: 'cnX-0', ord: 0, type: 'new', queue: 'new', due: 5 },
    ];
    const decks: Deck[] = [];

    migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);

    const newOrd1 = cards
      .filter((c) => c.ord === 1 && c.queue === 'new')
      .sort((a, b) => a.due - b.due);
    expect(newOrd1.map((c) => c.due)).toEqual([6, 7]);
  });

  it('returns all-false when the note type is absent', () => {
    const notetypes: NoteType[] = [];
    const notes = [note('n1')];
    const cards = [reviewCard('n1', 'deck-a')];
    const decks: Deck[] = [];

    const result = migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);

    expect(result).toEqual({ changedNoteTypes: false, changedCards: false, changedDecks: false });
    expect(cards).toHaveLength(1);
    expect(decks).toHaveLength(0);
  });

  it('skips notes with no existing card (no deck to place the new card)', () => {
    const notetypes = [oneTemplateNoteType()];
    const notes = [note('n1')];
    const cards: Card[] = [];
    const decks: Deck[] = [];

    const result = migrateAddListeningTemplate({ notetypes, notes, cards, decks }, NOW);

    // Template + Listening deck still added, but no card could be created.
    expect(result).toEqual({ changedNoteTypes: true, changedCards: false, changedDecks: true });
    expect(cards).toHaveLength(0);
  });
});
