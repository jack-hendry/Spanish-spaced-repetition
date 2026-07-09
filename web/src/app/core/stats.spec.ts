import { describe, expect, it } from 'vitest';

import type { Card, RevlogEntry } from './models';
import {
  bestStreak,
  buttonCounts,
  cardStateCounts,
  countInRange,
  dayStreak,
  dueForecast,
  formatRelativeDue,
  heatLevel,
  pace,
  periodDelta,
  reviewsByDay,
  studiedToday,
  sumTimeInRange,
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

  it('breaks the streak across a gap of more than 1 day', () => {
    // Reviews on days 10 and 11, then a pause/gap of many days, then resume reviewing on day 20.
    // Streak should count only the current consecutive run: just day 20 = streak of 1.
    expect(dayStreak([10, 11, 20], 20)).toBe(1);
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

describe('bestStreak', () => {
  it('finds the longest all-time consecutive-day run, not just the trailing one', () => {
    // Runs: [1,2,3] (len 3), [5] (len 1), [8,9,10,11] (len 4, best), current
    // trailing streak from "today" would be different from this all-time best.
    expect(bestStreak([1, 2, 3, 5, 8, 9, 10, 11])).toBe(4);
  });

  it('is 0 for an empty log', () => {
    expect(bestStreak([])).toBe(0);
  });

  it('ignores duplicate same-day entries', () => {
    expect(bestStreak([1, 1, 2, 2, 3])).toBe(3);
  });

  it('is 1 when there are no consecutive days', () => {
    expect(bestStreak([1, 5, 10])).toBe(1);
  });

  it('is unaffected by unsorted input', () => {
    // Sorted unique days: 1,2,3,8,9,10 -> two runs of length 3 each.
    expect(bestStreak([10, 9, 1, 8, 2, 3])).toBe(3);
  });
});

describe('periodDelta', () => {
  it('computes a rounded percentage increase', () => {
    expect(periodDelta(120, 100)).toBe(20);
  });

  it('computes a rounded percentage decrease', () => {
    expect(periodDelta(80, 100)).toBe(-20);
  });

  it('rounds to the nearest whole percent', () => {
    expect(periodDelta(110, 3)).toBe(Math.round(((110 - 3) / 3) * 100));
  });

  it('returns null when there is no baseline (previous === 0)', () => {
    expect(periodDelta(50, 0)).toBeNull();
    expect(periodDelta(0, 0)).toBeNull();
  });
});

describe('sumTimeInRange', () => {
  it('sums timeMs for entries within an inclusive day range', () => {
    const entries: DayTime[] = [
      { day: 5, timeMs: 1000 },
      { day: 6, timeMs: 2000 },
      { day: 7, timeMs: 4000 },
      { day: 8, timeMs: 9999 }, // outside range
    ];
    expect(sumTimeInRange(entries, 5, 7)).toBe(7000);
  });

  it('is 0 for an empty series', () => {
    expect(sumTimeInRange([], 0, 10)).toBe(0);
  });

  it('includes both range endpoints', () => {
    const entries: DayTime[] = [
      { day: 0, timeMs: 100 },
      { day: 10, timeMs: 200 },
    ];
    expect(sumTimeInRange(entries, 0, 10)).toBe(300);
  });
});

describe('countInRange', () => {
  it('counts reviews within an inclusive day range', () => {
    expect(countInRange([5, 5, 6, 7, 8], 5, 7)).toBe(4);
  });

  it('is 0 for an empty log', () => {
    expect(countInRange([], 0, 10)).toBe(0);
  });

  it('includes both range endpoints', () => {
    expect(countInRange([0, 10, 20], 0, 10)).toBe(2);
  });
});

describe('formatRelativeDue', () => {
  it('returns an em dash for new cards', () => {
    expect(formatRelativeDue(card({ queue: 'new', type: 'new', due: 5 }), 10, Date.now())).toBe('—');
  });

  it('returns "today" for a review card due today', () => {
    expect(formatRelativeDue(card({ queue: 'review', type: 'review', due: 10 }), 10, Date.now())).toBe('today');
  });

  it('returns "N days" for a review card due in the future', () => {
    expect(formatRelativeDue(card({ queue: 'review', type: 'review', due: 13 }), 10, Date.now())).toBe('3 days');
  });

  it('clamps an overdue review card to "today" rather than a negative count', () => {
    expect(formatRelativeDue(card({ queue: 'review', type: 'review', due: 7 }), 10, Date.now())).toBe('today');
  });

  it('returns "today" for a learning card whose due time has already passed', () => {
    const now = 1_000_000;
    expect(formatRelativeDue(card({ queue: 'learning', type: 'learning', due: now - 60_000 }), 0, now)).toBe('today');
  });

  it('returns "N min" for a learning card due later', () => {
    const now = 1_000_000;
    const due = now + 8 * 60_000;
    expect(formatRelativeDue(card({ queue: 'learning', type: 'learning', due }), 0, now)).toBe('8 min');
  });
});
