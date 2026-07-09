import { Component, computed, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { RevlogEntry } from '../../core/models';
import { PauseService } from '../../core/pause.service';
import { buttonCounts, dayStreak, pace, studiedToday, timeToday, type DayTime } from '../../core/stats';
import { Heatmap } from '../../shared/heatmap/heatmap';

interface ForecastSegment {
  key: string;
  count: number;
  cls: string;
  pct: number;
}

@Component({
  selector: 'app-deck-list',
  imports: [Heatmap],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.scss',
})
export class DeckList {
  private readonly store = inject(CollectionStore);
  private readonly api = inject(ApiService);
  private readonly pauseService = inject(PauseService);

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly collection = this.store.collection;

  /** True while a resume() request is in flight; disables the toggle button. */
  readonly busy = signal(false);

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

  /** Public: fed directly into `<app-heatmap [reviewDays]>`. */
  readonly reviewDays = computed<number[]>(() => {
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

  /** "N due · ~X min at your usual pace", or just "N due" until a pace baseline exists. */
  formatForecastLine(): string {
    const due = this.totalDue();
    const ms = this.estTimeMs();
    if (ms === null) return `${due} due`;
    return `${due} due · ~${this.formatDuration(ms)} at your usual pace`;
  }

  /** The only control in the app that mutates pause state. */
  async togglePause(): Promise<void> {
    if (this.collection()?.pausedAt == null) {
      await this.pauseService.pause();
      return;
    }
    this.busy.set(true);
    try {
      await this.pauseService.resume();
    } finally {
      this.busy.set(false);
    }
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
