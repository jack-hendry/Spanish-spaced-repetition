import { describe, expect, it } from 'vitest';

import { bumpDaily, dailyForToday, remainingLimits } from './daily-limits';
import type { Card, Deck, DeckOptions } from './models';

function deck(id: string, daily?: Deck['daily']): Deck {
  return { id, name: id, parentId: null, optionsId: 'o', collapsed: false, daily };
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c',
    noteId: 'n',
    deckId: 'd1',
    ord: 0,
    type: 'new',
    queue: 'new',
    due: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    lastReviewed: null,
    created: 0,
    modified: 0,
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
    ...over,
  };
}

const opts = { new: { perDay: 20 }, review: { perDay: 200 } } as DeckOptions;

describe('dailyForToday', () => {
  it('returns the tally when the day matches', () => {
    const d = deck('d1', { day: 5, newStudied: 3, reviewStudied: 7 });
    expect(dailyForToday(d, 5)).toEqual({ day: 5, newStudied: 3, reviewStudied: 7 });
  });

  it('treats a stale or missing tally as zero', () => {
    expect(dailyForToday(deck('d1', { day: 4, newStudied: 9, reviewStudied: 9 }), 5)).toEqual({
      day: 5,
      newStudied: 0,
      reviewStudied: 0,
    });
    expect(dailyForToday(deck('d1'), 5)).toEqual({ day: 5, newStudied: 0, reviewStudied: 0 });
  });
});

describe('bumpDaily', () => {
  it('increments new for a new card and resets a stale tally first', () => {
    const d = deck('d1', { day: 4, newStudied: 5, reviewStudied: 1 });
    expect(bumpDaily(d, card({ queue: 'new' }), 5)).toEqual({
      day: 5,
      newStudied: 1,
      reviewStudied: 0,
    });
  });

  it('increments review for a review card', () => {
    const d = deck('d1', { day: 5, newStudied: 2, reviewStudied: 2 });
    expect(bumpDaily(d, card({ queue: 'review', type: 'review' }), 5)).toEqual({
      day: 5,
      newStudied: 2,
      reviewStudied: 3,
    });
  });

  it('spends no slot for learning cards', () => {
    expect(bumpDaily(deck('d1'), card({ queue: 'learning', type: 'learning' }), 5)).toBeNull();
  });
});

describe('remainingLimits', () => {
  it('subtracts studied counts summed across the subtree', () => {
    const decks = [
      deck('d1', { day: 5, newStudied: 8, reviewStudied: 50 }),
      deck('d2', { day: 5, newStudied: 4, reviewStudied: 10 }),
      deck('out', { day: 5, newStudied: 99, reviewStudied: 99 }), // not in subtree
    ];
    const r = remainingLimits(decks, new Set(['d1', 'd2']), 5, opts);
    expect(r.newRemaining).toBe(20 - 12);
    expect(r.reviewRemaining).toBe(200 - 60);
  });

  it('never goes negative and ignores stale tallies', () => {
    const decks = [deck('d1', { day: 1, newStudied: 100, reviewStudied: 100 })];
    expect(remainingLimits(decks, new Set(['d1']), 5, opts)).toEqual({
      newRemaining: 20,
      reviewRemaining: 200,
    });
  });
});
