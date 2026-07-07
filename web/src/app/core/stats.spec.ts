import { describe, expect, it } from 'vitest';

import type { Card, RevlogEntry } from './models';
import {
  buttonCounts,
  cardStateCounts,
  dayStreak,
  dueForecast,
  heatLevel,
  pace,
  reviewsByDay,
  studiedToday,
  timeToday,
  yearlyHeat,
  type DayTime,
} from './stats';

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

  it('returns all zeros for an empty log', () => {
    expect(buttonCounts([])).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
  });
});

describe('studiedToday', () => {
  it('counts only entries mapped to the current study-day', () => {
    expect(studiedToday([10, 10, 9, 10, 8], 10)).toBe(3);
  });

  it('is 0 for an empty log', () => {
    expect(studiedToday([], 10)).toBe(0);
  });

  it('is 0 when nothing falls on today', () => {
    expect(studiedToday([8, 9], 10)).toBe(0);
  });
});

describe('timeToday', () => {
  it('sums timeMs only for entries on the current study-day', () => {
    const entries: DayTime[] = [
      { day: 10, timeMs: 1000 },
      { day: 10, timeMs: 2500 },
      { day: 9, timeMs: 9999 },
    ];
    expect(timeToday(entries, 10)).toBe(3500);
  });

  it('is 0 for an empty log', () => {
    expect(timeToday([], 10)).toBe(0);
  });
});

describe('pace', () => {
  it('divides time by card count', () => {
    expect(pace(4000, 4)).toBe(1000);
  });

  it('guards divide-by-zero, returning 0', () => {
    expect(pace(4000, 0)).toBe(0);
    expect(pace(0, 0)).toBe(0);
  });
});

describe('dayStreak', () => {
  it('counts consecutive days up to today with >=1 review', () => {
    // Reviewed today (10), yesterday (9), and 8; gap at 7.
    expect(dayStreak([10, 9, 9, 8], 10)).toBe(3);
  });

  it('is 0 when today has no reviews yet, even if yesterday did', () => {
    expect(dayStreak([9, 8], 10)).toBe(0);
  });

  it('is 0 for an empty log', () => {
    expect(dayStreak([], 10)).toBe(0);
  });

  it('stops at the first gap looking backward from today', () => {
    // today (10) and yesterday (9) reviewed, but day 8 skipped, day 7 reviewed.
    expect(dayStreak([10, 9, 7], 10)).toBe(2);
  });
});

describe('yearlyHeat', () => {
  it('produces a contiguous range with zeros filled in, outside the window ignored', () => {
    const points = yearlyHeat([5, 5, 5, 6, 100], 5, 7);
    expect(points).toEqual([
      { day: 5, count: 3 },
      { day: 6, count: 1 },
      { day: 7, count: 0 },
    ]);
  });

  it('is all-zero for an empty log', () => {
    const points = yearlyHeat([], 0, 2);
    expect(points.every((p) => p.count === 0)).toBe(true);
    expect(points).toHaveLength(3);
  });
});

describe('heatLevel', () => {
  it('buckets at the documented boundaries', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(9)).toBe(1);
    expect(heatLevel(10)).toBe(2);
    expect(heatLevel(19)).toBe(2);
    expect(heatLevel(20)).toBe(3);
    expect(heatLevel(39)).toBe(3);
    expect(heatLevel(40)).toBe(4);
    expect(heatLevel(41)).toBe(4);
  });
});
