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
});
