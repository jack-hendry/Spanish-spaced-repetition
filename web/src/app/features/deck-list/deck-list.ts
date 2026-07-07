import { Component, computed, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { RevlogEntry } from '../../core/models';
import {
  buttonCounts,
  dayStreak,
  heatLevel,
  pace,
  studiedToday,
  timeToday,
  yearlyHeat,
  type DayTime,
} from '../../core/stats';

/** One day cell in the activity heatmap grid. */
interface HeatCell {
  date: Date;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** False for padding cells outside the selected calendar year. */
  inYear: boolean;
}

interface ForecastSegment {
  key: string;
  count: number;
  cls: string;
  pct: number;
}

@Component({
  selector: 'app-deck-list',
  imports: [],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.scss',
})
export class DeckList {
  private readonly store = inject(CollectionStore);
  private readonly api = inject(ApiService);

  readonly loading = this.store.loading;
  readonly error = this.store.error;

  /** True until both the collection and the review log have loaded once. */
  readonly statsLoading = signal(true);
  private readonly revlog = signal<RevlogEntry[]>([]);

  /** Total due across every top-level deck (children are already rolled up). */
  readonly totalDue = computed(() => {
    const roots = this.store.deckTree().filter((n) => n.depth === 0);
    return roots.reduce((sum, n) => sum + n.total.new + n.total.learning + n.total.review, 0);
  });

  /** New/learning/review split across every top-level deck, for the forecast bar. */
  readonly forecastCounts = computed(() => {
    const roots = this.store.deckTree().filter((n) => n.depth === 0);
    return roots.reduce(
      (acc, n) => ({
        new: acc.new + n.total.new,
        learning: acc.learning + n.total.learning,
        review: acc.review + n.total.review,
      }),
      { new: 0, learning: 0, review: 0 },
    );
  });

  readonly forecastSegments = computed<ForecastSegment[]>(() => {
    const c = this.forecastCounts();
    const total = Math.max(1, c.new + c.learning + c.review);
    const seg = (key: string, count: number, cls: string) => ({
      key,
      count,
      cls,
      pct: Math.round((count / total) * 100),
    });
    return [
      seg('New', c.new, 'seg--new'),
      seg('Learning', c.learning, 'seg--learning'),
      seg('Review', c.review, 'seg--review'),
    ].filter((s) => s.count > 0);
  });

  // ---- day-mapped revlog inputs ---------------------------------------------
  // core/stats.ts helpers take already day-mapped inputs; map reviewedAt -> a
  // study-day number here, same idiom as features/stats/stats.ts.

  private readonly today = computed(() => {
    const coll = this.store.collection();
    return coll ? todayNumber(coll) : 0;
  });

  private readonly reviewDays = computed<number[]>(() => {
    const coll = this.store.collection();
    if (!coll) return [];
    return this.revlog().map((e) => todayNumber(coll, e.reviewedAt));
  });

  private readonly dayTimes = computed<DayTime[]>(() => {
    const coll = this.store.collection();
    if (!coll) return [];
    return this.revlog().map((e) => ({ day: todayNumber(coll, e.reviewedAt), timeMs: e.timeMs }));
  });

  // ---- stat cards ------------------------------------------------------------

  readonly studiedTodayCount = computed(() => studiedToday(this.reviewDays(), this.today()));
  readonly timeTodayMs = computed(() => timeToday(this.dayTimes(), this.today()));
  readonly paceMs = computed(() => pace(this.timeTodayMs(), this.studiedTodayCount()));

  /** Pass rate = share of non-Again answers across the log (same formula as features/stats). */
  readonly retention = computed<number | null>(() => {
    const c = buttonCounts(this.revlog());
    const total = c[1] + c[2] + c[3] + c[4];
    if (!total) return null;
    return Math.round(((total - c[1]) / total) * 100);
  });

  /**
   * Consecutive-day streak up to today. `dayStreak` itself is literal (0 if
   * today has no reviews yet, even with an active streak through yesterday);
   * here we display yesterday's streak until the first review of the day so
   * the badge doesn't flash to 0 every morning. The pure helper is unchanged.
   */
  readonly displayStreak = computed(() => {
    const days = this.reviewDays();
    const today = this.today();
    return this.studiedTodayCount() > 0 ? dayStreak(days, today) : dayStreak(days, today - 1);
  });

  /** Estimated minutes to clear today's due queue at today's pace; null until a baseline exists. */
  private readonly estTimeMs = computed<number | null>(() => {
    if (this.studiedTodayCount() === 0) return null;
    return this.totalDue() * this.paceMs();
  });

  // ---- activity heatmap -------------------------------------------------------

  readonly yearOptions = computed<number[]>(() => {
    const nowYear = new Date().getFullYear();
    const coll = this.store.collection();
    const createdYear = coll ? new Date(coll.created).getFullYear() : nowYear;
    const years: number[] = [];
    for (let y = nowYear; y >= createdYear; y--) years.push(y);
    return years;
  });

  readonly selectedYear = signal(new Date().getFullYear());

  /** Weeks (columns) of 7 day-cells (rows, Sun..Sat) covering the selected year. */
  readonly heatWeeks = computed<HeatCell[][]>(() => this.buildYearGrid(this.selectedYear()));

  readonly heatmapTotal = computed(() =>
    this.heatWeeks()
      .flat()
      .filter((c) => c.inYear)
      .reduce((sum, c) => sum + c.count, 0),
  );

  private buildYearGrid(year: number): HeatCell[][] {
    const coll = this.store.collection();
    if (!coll) return [];

    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const gridStart = new Date(jan1);
    gridStart.setDate(jan1.getDate() - jan1.getDay());
    const gridEnd = new Date(dec31);
    gridEnd.setDate(dec31.getDate() + (6 - dec31.getDay()));

    const startDay = todayNumber(coll, gridStart.getTime());
    const endDay = todayNumber(coll, gridEnd.getTime());
    const heat = yearlyHeat(this.reviewDays(), startDay, endDay);
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
    return weeks;
  }

  onYearChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!Number.isNaN(value)) this.selectedYear.set(value);
  }

  // ---- formatting --------------------------------------------------------

  formatDuration(ms: number): string {
    if (ms <= 0) return '0m';
    const totalMinutes = Math.round(ms / 60_000);
    if (totalMinutes < 1) return '<1m';
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  formatPace(): string {
    if (this.studiedTodayCount() === 0) return '—';
    return `${Math.round(this.paceMs() / 1000)}s`;
  }

  formatRetention(r: number | null): string {
    return r === null ? '—' : `${r}%`;
  }

  formatEstTime(): string {
    const ms = this.estTimeMs();
    return ms === null ? '—' : this.formatDuration(ms);
  }

  formatCellDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  cellTitle(cell: HeatCell): string {
    if (!cell.inYear) return '';
    const noun = cell.count === 1 ? 'review' : 'reviews';
    return `${cell.count} ${noun} on ${this.formatCellDate(cell.date)}`;
  }

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.collection() === null) {
      await this.store.load();
    }
    this.revlog.set(await lastValueFrom(this.api.getRevlog()));
    this.statsLoading.set(false);
  }
}
