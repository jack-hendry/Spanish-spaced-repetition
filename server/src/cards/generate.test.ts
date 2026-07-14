import { describe, expect, it } from 'vitest';

import type { Card, Note, NoteType } from '../models/index.js';
import { desiredOrds, reconcileNoteCards } from './generate.js';

const basicReversed: NoteType = {
  id: 'nt-basic-reversed',
  name: 'Basic (and reversed)',
  kind: 'standard',
  fields: [
    { name: 'Front', ord: 0 },
    { name: 'Back', ord: 1 },
  ],
  templates: [
    { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' },
    { name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' },
  ],
  css: '',
};

const cloze: NoteType = {
  id: 'nt-cloze',
  name: 'Cloze',
  kind: 'cloze',
  fields: [
    { name: 'Text', ord: 0 },
    { name: 'Back Extra', ord: 1 },
  ],
  templates: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }],
  css: '',
};

function note(fields: Record<string, string>, id = 'n1'): Note {
  return {
    id,
    noteTypeId: 'nt',
    fields,
    tags: [],
    created: 0,
    modified: 0,
    guid: id,
  };
}

describe('desiredOrds', () => {
  it('emits one ord per template for standard note types', () => {
    expect(desiredOrds(note({ Front: 'a', Back: 'b' }), basicReversed)).toEqual([0, 1]);
  });

  it('emits one ord per distinct cloze number (N -> ord N-1)', () => {
    expect(desiredOrds(note({ Text: '{{c1::a}} {{c2::b}}' }), cloze)).toEqual([0, 1]);
  });

  it('handles sparse cloze numbering', () => {
    expect(desiredOrds(note({ Text: '{{c1::a}} {{c3::b}}' }), cloze)).toEqual([0, 2]);
  });

  it('falls back to a single card when a cloze note has no deletion', () => {
    expect(desiredOrds(note({ Text: 'plain' }), cloze)).toEqual([0]);
  });
});

describe('reconcileNoteCards', () => {
  it('creates a card per ord for a brand-new note', () => {
    const { cards, removedIds } = reconcileNoteCards(
      note({ Front: 'a', Back: 'b' }),
      basicReversed,
      [],
      'd1',
      100,
      1,
    );
    expect(cards.map((c) => c.ord)).toEqual([0, 1]);
    expect(cards.map((c) => c.due)).toEqual([100, 101]);
    expect(cards.every((c) => c.queue === 'new')).toBe(true);
    expect(removedIds).toEqual([]);
  });

  it('preserves scheduling on surviving cards and adds new ords', () => {
    const n = note({ Text: '{{c1::a}} {{c2::b}} {{c3::c}}' });
    const existing: Card = {
      id: 'cn1-0',
      noteId: n.id,
      deckId: 'd1',
      ord: 0,
      type: 'review',
      queue: 'review',
      due: 42,
      reps: 5,
      lapses: 1,
      left: 0,
      lastReviewed: 123,
      created: 0,
      modified: 0,
      ease: 2400,
      interval: 30,
      stability: null,
      difficulty: null,
    };
    const { cards, removedIds } = reconcileNoteCards(n, cloze, [existing], 'd1', 200, 9);
    expect(cards.map((c) => c.ord)).toEqual([0, 1, 2]);
    const kept = cards.find((c) => c.ord === 0)!;
    expect(kept.reps).toBe(5);
    expect(kept.interval).toBe(30);
    expect(kept.type).toBe('review');
    expect(removedIds).toEqual([]);
  });

  it('removes cards whose ord disappears when a deletion is dropped', () => {
    const before = note({ Text: '{{c1::a}} {{c2::b}}' });
    const first = reconcileNoteCards(before, cloze, [], 'd1', 0, 1).cards;
    const after = note({ Text: '{{c1::a}}' });
    const { cards, removedIds } = reconcileNoteCards(after, cloze, first, 'd1', 5, 2);
    expect(cards.map((c) => c.ord)).toEqual([0]);
    expect(removedIds).toEqual([first[1].id]);
  });

  // A template can pin its cards to a fixed deck (e.g. the Listening template),
  // overriding the note's own deck passed as `deckId`.
  const pinnedListening: NoteType = {
    id: 'nt-spanish-2sided',
    name: 'Spanish 2-sided',
    kind: 'standard',
    fields: [
      { name: 'SideA', ord: 0 },
      { name: 'SideB', ord: 3 },
    ],
    templates: [
      { name: 'A → B', ord: 0, qfmt: '{{SideA}}', afmt: '{{SideB}}' },
      { name: 'Listening', ord: 1, qfmt: '{{SideAAudio}}', afmt: '{{SideA}}', deckId: 'dec-x' },
    ],
    css: '',
  };

  it('pins a template with deckId to that deck for a freshly created card', () => {
    const { cards } = reconcileNoteCards(
      note({ SideA: 'a', SideB: 'b' }),
      pinnedListening,
      [],
      'd1',
      0,
      1,
    );
    // ord-0 follows the note's own deck; ord-1 is pinned to the template deck.
    expect(cards.find((c) => c.ord === 0)!.deckId).toBe('d1');
    expect(cards.find((c) => c.ord === 1)!.deckId).toBe('dec-x');
  });

  it('corrects a surviving ord-1 card that drifted to the wrong deck', () => {
    const drifted: Card = {
      id: 'cn1-1',
      noteId: 'n1',
      deckId: 'd1', // wrong — should be the pinned 'dec-x'
      ord: 1,
      type: 'review',
      queue: 'review',
      due: 99,
      reps: 4,
      lapses: 0,
      left: 0,
      lastReviewed: 123,
      created: 0,
      modified: 0,
      ease: 2500,
      interval: 12,
      stability: null,
      difficulty: null,
    };
    const { cards } = reconcileNoteCards(
      note({ SideA: 'a', SideB: 'b' }),
      pinnedListening,
      [drifted],
      'd1',
      0,
      2,
    );
    const ord1 = cards.find((c) => c.ord === 1)!;
    // Deck corrected to the pinned deck, scheduling state preserved.
    expect(ord1.deckId).toBe('dec-x');
    expect(ord1.reps).toBe(4);
    expect(ord1.interval).toBe(12);
    expect(ord1.type).toBe('review');
  });
});
