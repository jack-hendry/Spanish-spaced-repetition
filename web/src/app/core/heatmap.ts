import type { Collection } from './models';
import { heatLevel } from './stats';

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
 * Returns the local calendar date of a review timestamp, shifted by the
 * dayCutoffHour, formatted as YYYY-MM-DD with zero-padded month and day.
 * A review before the cutoff hour shifts to the previous calendar day.
 */
export function heatDateKey(ms: number, dayCutoffHour: number): string {
  const adjusted = new Date(ms - dayCutoffHour * 3600_000);
  const year = adjusted.getFullYear();
  const month = String(adjusted.getMonth() + 1).padStart(2, '0');
  const date = String(adjusted.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/**
 * Builds the Sun-anchored 7-row-week grid of day cells covering `year`
 * (padded at both ends to whole weeks, with `inYear: false` marking the
 * padding), plus, for each month present in the grid, the column (week)
 * index of that month's first in-year cell — used to position top-of-grid
 * month labels and month gaps.
 */
export function buildHeatGrid(
  reviewTimestamps: number[],
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

  const counts = new Map<string, number>();
  for (const t of reviewTimestamps) {
    const key = heatDateKey(t, collection.dayCutoffHour);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cells: HeatCell[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    // Local noon avoids DST-transition edge cases shifting the date.
    const key = heatDateKey(
      new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 12).getTime(),
      collection.dayCutoffHour,
    );
    const count = counts.get(key) ?? 0;
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
