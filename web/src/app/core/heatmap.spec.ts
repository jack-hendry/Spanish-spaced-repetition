import { describe, expect, it } from 'vitest';

import { buildHeatGrid, heatDateKey } from './heatmap';
import type { Collection } from './models';

function collection(over: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 1,
    created: Date.now(),
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'do1',
    tags: [],
    pausedAt: null,
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
    // 12 reviews on Jan 1, 2024 (noon) -> level 2 (10-19).
    const reviewTimestamps = Array(12).fill(new Date(2024, 0, 1, 12).getTime());

    const grid = buildHeatGrid(reviewTimestamps, coll, 2024);
    const jan1Cell = grid.weeks.flat().find((c) => c.inYear && c.date.getMonth() === 0 && c.date.getDate() === 1);
    expect(jan1Cell?.count).toBe(12);
    expect(jan1Cell?.level).toBe(2);
  });

  it('places a review in the cell for the calendar day it was made on, regardless of created time-of-day (regression)', () => {
    // created's time-of-day (10:20) used to anchor todayNumber's rollover,
    // pushing a same-day review into the next calendar cell. Calendar-date
    // keying must not depend on `created` at all.
    const coll = collection({
      created: new Date(2026, 5, 24, 10, 20).getTime(),
      dayCutoffHour: 4,
    });
    const afternoon = new Date(2024, 6, 8, 15).getTime(); // Jul 8, 2024, 3pm

    const grid = buildHeatGrid([afternoon], coll, 2024);
    const jul8Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 8);
    const jul9Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 9);

    expect(jul8Cell?.count).toBe(1);
    expect(jul9Cell?.count).toBe(0);
  });

  it('rolls a pre-cutoff review back to the previous calendar day (regression)', () => {
    const coll = collection({ dayCutoffHour: 4 });
    const preCutoff = new Date(2024, 6, 8, 3, 30).getTime(); // Jul 8, 2024, 3:30am

    const grid = buildHeatGrid([preCutoff], coll, 2024);
    const jul7Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 7);
    const jul8Cell = grid.weeks
      .flat()
      .find((c) => c.inYear && c.date.getMonth() === 6 && c.date.getDate() === 8);

    expect(jul7Cell?.count).toBe(1);
    expect(jul8Cell?.count).toBe(0);
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

describe('heatDateKey', () => {
  it('returns the local calendar date as YYYY-MM-DD for a mid-afternoon review', () => {
    const ms = new Date(2024, 6, 13, 16, 2).getTime();
    expect(heatDateKey(ms, 4)).toBe('2024-07-13');
  });

  it('shifts a pre-cutoff review to the previous calendar day', () => {
    const ms = new Date(2024, 6, 13, 3, 30).getTime();
    expect(heatDateKey(ms, 4)).toBe('2024-07-12');
  });

  it('returns the same date for a review exactly at the cutoff hour', () => {
    const ms = new Date(2024, 6, 13, 4, 0).getTime();
    expect(heatDateKey(ms, 4)).toBe('2024-07-13');
  });

  it('bucketing with dayCutoffHour: 0 equals the plain local calendar date', () => {
    const ms = new Date(2024, 6, 13, 16, 2).getTime();
    expect(heatDateKey(ms, 0)).toBe('2024-07-13');
  });
});
