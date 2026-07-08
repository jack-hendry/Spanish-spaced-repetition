import { describe, expect, it } from 'vitest';

import { todayNumber } from './collection.store';
import { buildHeatGrid } from './heatmap';
import type { Collection } from './models';

function collection(over: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 1,
    created: Date.now(),
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'do1',
    tags: [],
    ...over,
  };
}

describe('buildHeatGrid', () => {
  it('returns an empty grid when there is no collection yet', () => {
    expect(buildHeatGrid([], null, 2024)).toEqual({ weeks: [], months: [] });
  });

  it('produces Sun-anchored 7-row weeks covering the whole year', () => {
    // 2024: Jan 1 is a Monday, leap year -> 371 padded grid days -> 53 weeks.
    const grid = buildHeatGrid([], collection(), 2024);
    expect(grid.weeks).toHaveLength(53);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      expect(week[0].date.getDay()).toBe(0); // Sunday
      expect(week[6].date.getDay()).toBe(6); // Saturday
    }
  });

  it('produces 54 weeks for a year whose padding spills an extra week (2028)', () => {
    // 2028: Jan 1 is a Saturday and it's a leap year -> 378 padded grid days.
    const grid = buildHeatGrid([], collection(), 2028);
    expect(grid.weeks).toHaveLength(54);
  });

  it('pads the first and last weeks with inYear: false cells outside the target year', () => {
    const grid = buildHeatGrid([], collection(), 2024);

    // Jan 1, 2024 is a Monday, so the Sunday before it pads the first week.
    const firstWeek = grid.weeks[0];
    expect(firstWeek[0].inYear).toBe(false);
    expect(firstWeek[0].date.getFullYear()).toBe(2023);
    for (let i = 1; i < 7; i++) {
      expect(firstWeek[i].inYear).toBe(true);
    }

    // Dec 31, 2024 is a Tuesday, so Wed–Sat pad the last week into 2025.
    const lastWeek = grid.weeks[grid.weeks.length - 1];
    expect(lastWeek[0].inYear).toBe(true);
    expect(lastWeek[2].inYear).toBe(true);
    expect(lastWeek[3].inYear).toBe(false);
    expect(lastWeek[3].date.getFullYear()).toBe(2025);
    expect(lastWeek[6].inYear).toBe(false);

    // Exactly the 366 days of the (leap) year should be marked inYear.
    const inYearCount = grid.weeks.flat().filter((c) => c.inYear).length;
    expect(inYearCount).toBe(366);
  });

  it('maps review days into cell counts and heat levels', () => {
    const coll = collection();
    // Anchor a review on the grid's first in-year day (Jan 1, 2024) via its
    // computed study-day number, derived the same way real reviews are
    // stamped: todayNumber() called with an actual in-day timestamp (noon),
    // not midnight, mirroring how callers derive reviewDays.
    const jan1Noon = new Date(2024, 0, 1, 12).getTime();
    const day = todayNumber(coll, jan1Noon);
    const reviewDays = Array(12).fill(day); // 12 reviews -> level 2 (10-19)

    const grid = buildHeatGrid(reviewDays, coll, 2024);
    const jan1Cell = grid.weeks.flat().find((c) => c.inYear && c.date.getMonth() === 0 && c.date.getDate() === 1);
    expect(jan1Cell?.count).toBe(12);
    expect(jan1Cell?.level).toBe(2);
  });

  it('places a review in the cell for the calendar day it was made on, not the next day (regression)', () => {
    // Non-zero dayCutoffHour (the seeded default is 4am) is what exposed the
    // bug: cells were built from local midnight, which floors into the
    // *previous* study-day whenever the cutoff hour hasn't passed yet.
    const coll = collection({ dayCutoffHour: 4 });
    const afternoon = new Date(2024, 6, 8, 15).getTime(); // Jul 8, 2024, 3pm
    const reviewDay = todayNumber(coll, afternoon);

    const grid = buildHeatGrid([reviewDay], coll, 2024);
    const jul8Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 8);
    const jul9Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 9);

    expect(jul8Cell?.count).toBe(1);
    expect(jul9Cell?.count).toBe(0);
  });

  it('returns exactly 12 months with strictly ascending weekIndex', () => {
    const grid = buildHeatGrid([], collection(), 2024);
    expect(grid.months).toHaveLength(12);
    expect(grid.months.map((m) => m.name)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    for (let i = 1; i < grid.months.length; i++) {
      expect(grid.months[i].weekIndex).toBeGreaterThan(grid.months[i - 1].weekIndex);
    }
    // January always starts at the first (possibly padded) week.
    expect(grid.months[0].weekIndex).toBe(0);
  });
});
