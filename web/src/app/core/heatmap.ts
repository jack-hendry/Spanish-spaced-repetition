import { todayNumber } from './collection.store';
import type { Collection } from './models';
import { heatLevel, yearlyHeat } from './stats';

/** One day cell in the activity heatmap grid. */
export interface HeatCell {
  date: Date;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** False for padding cells outside the selected calendar year. */
  inYear: boolean;
}

/** A month's top label, positioned at the column (week) index of its first in-year cell. */
export interface MonthLabel {
  name: string;
  weekIndex: number;
}

/** Sun-anchored 7-row week grid for a calendar year, plus month label positions. */
export interface HeatGrid {
  weeks: HeatCell[][];
  months: MonthLabel[];
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Builds the Sun-anchored 7-row-week grid of day cells covering `year`
 * (padded at both ends to whole weeks, with `inYear: false` marking the
 * padding), plus, for each month present in the grid, the column (week)
 * index of that month's first in-year cell — used to position top-of-grid
 * month labels and month gaps.
 */
export function buildHeatGrid(
  reviewDays: number[],
  collection: Collection | null,
  year: number,
): HeatGrid {
  if (!collection) return { weeks: [], months: [] };

  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const gridStart = new Date(jan1);
  gridStart.setDate(jan1.getDate() - jan1.getDay());
  const gridEnd = new Date(dec31);
  gridEnd.setDate(dec31.getDate() + (6 - dec31.getDay()));

  // Cells are built from local midnight, but todayNumber's cutoff-hour
  // subtraction means midnight falls before that calendar day's study-day
  // boundary (whenever dayCutoffHour > 0), which floors it into the
  // *previous* day-number. Nudge past the cutoff so each cell's day-number
  // matches what a real review made that calendar day would get.
  const cutoffMs = collection.dayCutoffHour * 3600_000;
  const startDay = todayNumber(collection, gridStart.getTime() + cutoffMs);
  const endDay = todayNumber(collection, gridEnd.getTime() + cutoffMs);
  const heat = yearlyHeat(reviewDays, startDay, endDay);
  const byDay = new Map(heat.map((h) => [h.day, h.count]));

  const cells: HeatCell[] = [];
  const cursor = new Date(gridStart);
  for (let day = startDay; day <= endDay; day++) {
    const count = byDay.get(day) ?? 0;
    cells.push({
      date: new Date(cursor),
      count,
      level: heatLevel(count),
      inYear: cursor.getFullYear() === year,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Cells are chronological both across weeks and within a week (7-day
  // chunks of a day-by-day cursor), so the first scan hit per month is its
  // first in-year cell, and months are emitted in ascending weekIndex order.
  const months: MonthLabel[] = [];
  const seen = new Set<number>();
  weeks.forEach((week, weekIndex) => {
    for (const cell of week) {
      if (!cell.inYear) continue;
      const m = cell.date.getMonth();
      if (seen.has(m)) continue;
      seen.add(m);
      months.push({ name: MONTH_NAMES[m], weekIndex });
    }
  });

  return { weeks, months };
}
