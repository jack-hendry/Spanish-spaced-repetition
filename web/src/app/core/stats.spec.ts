import { describe, expect, it } from 'vitest';

import type { Card, RevlogEntry } from './models';
import { buttonCounts, cardStateCounts, dueForecast, reviewsByDay } from './stats';

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c', noteId: 'n', deckId: 'd1', ord: 0,
    type: 'review', queue: 'review', due: 0, reps: 0, lapses: 0, left: 0,
    lastReviewed: null, created: 0, modified: 0, ease: 2500, interval: 5,
    stability: null, difficulty: null, ...over,
  };
}

describe('cardStateCounts', () => {
  it('buckets cards by state with maturity split at 21 days', () => {
    const counts = cardStateCounts([
      card({ queue: 'new', type: 'new' }),
      card({ queue: 'learning', type: 'learning' }),
      card({ queue: 'review', type: 'review', interval: 5 }), // young
      card({ queue: 'review', type: 'review', interval: 21 }), // mature
      card({ queue: 'review', type: 'review', interval: 90 }), // mature
      card({ queue: 'suspended', interval: 50 }),
      card({ queue: 'schedBuried' }),
    ]);
    expect(counts).toEqual({ new: 1, learning: 1, young: 1, mature: 2, suspended: 1, buried: 1 });
  });
});

describe('dueForecast', () => {
  it('buckets review cards by day offset, folding overdue into today', () => {
    const today = 100;
    const cards = [
      card({ due: 98 }), // overdue -> offset 0
      card({ due: 100 }), // today -> 0
      card({ due: 101 }), // +1
      card({ due: 101 }),
      card({ due: 130 }), // outside a 7-day window
      card({ queue: 'new', type: 'new', due: 100 }), // not a review card
    ];
    const f = dueForecast(cards, today, 7);
    expect(f).toHaveLength(7);
    expect(f[0]).toEqual({ offset: 0, count: 2 });
    expect(f[1]).toEqual({ offset: 1, count: 2 });
    expect(f[2].count).toBe(0);
  });
});

describe('reviewsByDay', () => {
  it('produces a contiguous past window with zeros filled in', () => {
    const today = 10;
    const days = [10, 10, 9, 7, 3]; // 3 is outside a 5-day window
    const series = reviewsByDay(days, today, 5);
    expect(series.map((d) => d.offset)).toEqual([-4, -3, -2, -1, 0]);
    const byOffset = new Map(series.map((d) => [d.offset, d.count]));
    expect(byOffset.get(0)).toBe(2); // day 10
    expect(byOffset.get(-1)).toBe(1); // day 9
    expect(byOffset.get(-3)).toBe(1); // day 7
    expect(byOffset.get(-2)).toBe(0);
  });
});

describe('buttonCounts', () => {
  it('tallies each answer button', () => {
    const log = [
      { button: 1 }, { button: 3 }, { button: 3 }, { button: 4 },
    ] as RevlogEntry[];
    expect(buttonCounts(log)).toEqual({ 1: 1, 2: 0, 3: 2, 4: 1 });
  });
});
