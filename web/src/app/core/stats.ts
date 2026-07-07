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

// ---- dashboard helpers -----------------------------------------------------
// Same idiom as above: callers map `RevlogEntry.reviewedAt` to a study-day
// number via `todayNumber(collection, entry.reviewedAt)` (see
// `collection.store.ts`) before calling these, so the maths here stays a pure,
// trivially-testable function of plain numbers.

/** Count of revlog entries whose mapped study-day equals `today`. */
export function studiedToday(reviewDays: number[], today: number): number {
  return reviewDays.filter((day) => day === today).length;
}

export interface DayTime {
  /** Study-day number the entry was reviewed on. */
  day: number;
  timeMs: number;
}

/** Sum of `timeMs` for entries whose mapped study-day equals `today`. */
export function timeToday(entries: DayTime[], today: number): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.day === today) total += entry.timeMs;
  }
  return total;
}

/** Average time per card in ms. Guards divide-by-zero -> 0 (UI formats the sentinel). */
export function pace(timeMs: number, cards: number): number {
  if (cards <= 0) return 0;
  return timeMs / cards;
}

/**
 * Consecutive days up to and including `today` with at least one review.
 * Walks backward from `today`; stops at the first day (starting at `today`
 * itself) with zero reviews.
 */
export function dayStreak(reviewDays: number[], today: number): number {
  const days = new Set(reviewDays);
  let streak = 0;
  let day = today;
  while (days.has(day)) {
    streak++;
    day--;
  }
  return streak;
}

export interface HeatPoint {
  /** Absolute study-day number. */
  day: number;
  count: number;
}

/**
 * Per-day review counts across an inclusive day-number range, e.g. the ~365
 * days of a heatmap year. Generalises `reviewsByDay`'s bucketing to an
 * arbitrary absolute range instead of an offset window from today, so callers
 * can pick any window (a rolling year, or a specific calendar year mapped to
 * day numbers via the collection's creation date).
 */
export function yearlyHeat(reviewDays: number[], startDay: number, endDay: number): HeatPoint[] {
  const buckets = new Map<number, number>();
  for (const day of reviewDays) {
    if (day < startDay || day > endDay) continue;
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  const out: HeatPoint[] = [];
  for (let day = startDay; day <= endDay; day++) {
    out.push({ day, count: buckets.get(day) ?? 0 });
  }
  return out;
}

/** Heatmap intensity bucket for a day's review count: 0 / 1-9 / 10-19 / 20-39 / 40+. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < 10) return 1;
  if (count < 20) return 2;
  if (count < 40) return 3;
  return 4;
}

// ---- stats-page helpers -----------------------------------------------------

/**
 * The longest run of consecutive study-days with at least one review, over
 * the entire log (all-time best). Unlike `dayStreak`, this is not anchored to
 * `today` and does not require the run to be current.
 */
export function bestStreak(reviewDays: number[]): number {
  if (reviewDays.length === 0) return 0;
  const days = Array.from(new Set(reviewDays)).sort((a, b) => a - b);
  let best = 1;
  let current = 1;
  for (let i = 1; i < days.length; i++) {
    current = days[i] === days[i - 1] + 1 ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}

/**
 * Rounded percentage change from `previous` to `current`, e.g. `periodDelta(120, 100) === 20`.
 * Returns `null` when there's no baseline (`previous === 0`) rather than a
 * misleading infinite/undefined percentage — callers should render no delta
 * line in that case (see spec Q7).
 */
export function periodDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Sum of `timeMs` for entries whose mapped study-day falls within the
 * inclusive `[startDay, endDay]` range. Same range semantics as `yearlyHeat`.
 */
export function sumTimeInRange(entries: DayTime[], startDay: number, endDay: number): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.day >= startDay && entry.day <= endDay) total += entry.timeMs;
  }
  return total;
}

/**
 * Count of reviews whose mapped study-day falls within the inclusive
 * `[startDay, endDay]` range. Same range semantics as `yearlyHeat`/`sumTimeInRange`.
 */
export function countInRange(reviewDays: number[], startDay: number, endDay: number): number {
  let count = 0;
  for (const day of reviewDays) {
    if (day >= startDay && day <= endDay) count++;
  }
  return count;
}

/**
 * A relative due string for the Browse table: "—" for new cards (no due
 * date yet); "today"/"N days" for review cards (`due` is a day number,
 * clamped like `dueForecast` so an overdue card reads "today" rather than a
 * negative count); "today"/"N min" for learning cards (`due` is compared
 * directly against `now`, matching the epoch-ms convention the schedulers
 * already use for `ReviewContext.now` — see `scheduling/types.ts`).
 */
export function formatRelativeDue(card: Card, today: number, now: number): string {
  if (card.queue === 'new') return '—';
  if (card.queue === 'learning') {
    const diffMs = card.due - now;
    if (diffMs <= 0) return 'today';
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    return `${minutes} min`;
  }
  const diffDays = Math.max(0, card.due - today);
  return diffDays === 0 ? 'today' : `${diffDays} days`;
}
