// Pure statistics over the collection's cards and review log. The components
// turn these into bar charts; keeping the maths here makes them unit-testable.

import type { Card, RevlogEntry } from './models';

/** Interval (days) at/above which a review card is considered "mature". */
export const MATURE_THRESHOLD = 21;

export interface StateCounts {
  new: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
  buried: number;
}

/** Count cards by lifecycle state. Suspended/buried take precedence over type. */
export function cardStateCounts(cards: Card[]): StateCounts {
  const c: StateCounts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, buried: 0 };
  for (const card of cards) {
    switch (card.queue) {
      case 'suspended':
        c.suspended++;
        break;
      case 'schedBuried':
      case 'userBuried':
        c.buried++;
        break;
      case 'new':
        c.new++;
        break;
      case 'learning':
        c.learning++;
        break;
      case 'review':
        if (card.interval >= MATURE_THRESHOLD) c.mature++;
        else c.young++;
        break;
    }
  }
  return c;
}

export interface DuePoint {
  /** Days from today (0 = today, including overdue). */
  offset: number;
  count: number;
}

/**
 * Review cards coming due over the next `days` days, bucketed by day offset.
 * Overdue cards (due before today) fall into offset 0.
 */
export function dueForecast(cards: Card[], today: number, days: number): DuePoint[] {
  const buckets = new Array<number>(days).fill(0);
  for (const card of cards) {
    if (card.queue !== 'review' || card.type !== 'review') continue;
    const offset = Math.max(0, card.due - today);
    if (offset < days) buckets[offset]++;
  }
  return buckets.map((count, offset) => ({ offset, count }));
}

export interface DayCount {
  /** Days from today, negative for the past (-1 = yesterday, 0 = today). */
  offset: number;
  count: number;
}

/**
 * Reviews per day over the past `days` days (inclusive of today). `reviewDays`
 * is the study-day number of each revlog entry; `today` is the current day.
 */
export function reviewsByDay(reviewDays: number[], today: number, days: number): DayCount[] {
  const buckets = new Map<number, number>();
  const earliest = today - days + 1;
  for (const day of reviewDays) {
    if (day < earliest || day > today) continue;
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  const out: DayCount[] = [];
  for (let day = earliest; day <= today; day++) {
    out.push({ offset: day - today, count: buckets.get(day) ?? 0 });
  }
  return out;
}

/** Counts of each answer button (1..4) across the review log. */
export function buttonCounts(revlog: RevlogEntry[]): Record<1 | 2 | 3 | 4, number> {
  const c: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const entry of revlog) {
    if (entry.button >= 1 && entry.button <= 4) c[entry.button]++;
  }
  return c;
}
