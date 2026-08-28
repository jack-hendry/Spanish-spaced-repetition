import { describe, expect, it } from 'vitest';

import type { Card, Note } from './models';
import { parseQuery, type SearchRow } from './search';

function row(over: Partial<SearchRow> = {}, card: Partial<Card> = {}): SearchRow {
  const note = { id: 'n1', tags: [] } as unknown as Note;
  const c: Card = {
    id: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ord: 0,
    type: 'review',
    queue: 'review',
    due: 50,
    reps: 0,
    lapses: 0,
    left: 0,
    lastReviewed: null,
    created: 0,
    modified: 0,
    ease: 2500,
    interval: 5,
    stability: null,
    difficulty: null,
    ...card,
  };
  return {
    card: c,
    note,
    deckName: 'spanish::verbs',
    text: 'el gato come pescado',
    tags: ['grammar::nouns'],
    ...over,
  };
}

const TODAY = 100;

describe('parseQuery', () => {
  it('matches everything for an empty query', () => {
    expect(parseQuery('')(row(), TODAY)).toBe(true);
    expect(parseQuery('   ')(row(), TODAY)).toBe(true);
  });

  it('AND-s bare words against note text, case-insensitively', () => {
    expect(parseQuery('Gato PESCADO')(row(), TODAY)).toBe(true);
    expect(parseQuery('gato perro')(row(), TODAY)).toBe(false);
  });

  it('supports quoted phrases', () => {
    expect(parseQuery('"come pescado"')(row(), TODAY)).toBe(true);
    expect(parseQuery('"come perro"')(row(), TODAY)).toBe(false);
  });

  it('filters by deck name substring', () => {
    expect(parseQuery('deck:verbs')(row(), TODAY)).toBe(true);
    expect(parseQuery('deck:nouns')(row(), TODAY)).toBe(false);
  });

  it('matches a tag and its ancestor', () => {
    expect(parseQuery('tag:grammar')(row(), TODAY)).toBe(true);
    expect(parseQuery('tag:grammar::nouns')(row(), TODAY)).toBe(true);
    expect(parseQuery('tag:verbs')(row(), TODAY)).toBe(false);
  });

  it('filters by card state', () => {
    expect(parseQuery('is:review')(row(), TODAY)).toBe(true);
    expect(parseQuery('is:new')(row({}, { queue: 'new', type: 'new' }), TODAY)).toBe(true);
    expect(parseQuery('is:suspended')(row({}, { queue: 'suspended' }), TODAY)).toBe(true);
    expect(parseQuery('is:buried')(row({}, { queue: 'schedBuried' }), TODAY)).toBe(true);
  });

  it('is:due respects the day for review cards and is always true for learning', () => {
    expect(
      parseQuery('is:due')(row({}, { queue: 'review', type: 'review', due: 100 }), TODAY),
    ).toBe(true);
    expect(
      parseQuery('is:due')(row({}, { queue: 'review', type: 'review', due: 101 }), TODAY),
    ).toBe(false);
    expect(parseQuery('is:due')(row({}, { queue: 'learning', type: 'learning' }), TODAY)).toBe(
      true,
    );
  });

  it('combines qualifiers and text with AND', () => {
    const p = parseQuery('gato deck:verbs is:review');
    expect(p(row(), TODAY)).toBe(true);
    expect(p(row({ deckName: 'spanish::nouns' }), TODAY)).toBe(false);
  });
});
