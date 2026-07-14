import { Component, computed, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { RevlogEntry } from '../../core/models';
import {
  bestStreak,
  buttonCounts,
  cardStateCounts,
  countInRange,
  dayStreak,
  periodDelta,
  reviewsByDay,
  sumTimeInRange,
  type DayTime,
} from '../../core/stats';
import { Heatmap } from '../../shared/heatmap/heatmap';

/** Window size for the (a)/(b) stat cards and their "vs last month" comparison. */
const RANGE_DAYS = 30;
/** Window size for the "Reviews — last 14 days" bar chart. */
const HISTORY_DAYS = 14;

/** A rendered "▲/▼ X% vs last month" line; absent entirely when there's no prior-period baseline (Q7). */
interface Delta {
  value: number;
  positive: boolean;
}

interface HistoryBar {
  /** Full "<date>: N reviews" string for the hover tooltip. */
  tooltip: string;
  count: number;
  /** Height as a percentage of the tallest bar in the series. */
  pct: number;
  isToday: boolean;
  /** Visible date label under the bar; only the first (earliest) bar carries one. */
  dateLabel: string;
}

interface ButtonRow {
  label: string;
  count: number;
  cls: string;
  pct: number;
}

/** `periodDelta`'s null-on-no-baseline result, reshaped into a signed magnitude + direction for the template. */
function toDelta(pct: number | null): Delta | null {
  if (pct === null) return null;
  return { value: Math.abs(pct), positive: pct >= 0 };
}

@Component({
  selector: 'app-stats',
  imports: [Heatmap],
  templateUrl: './stats.html',
  styleUrl: './stats.scss',
})
export class Stats {
  private readonly store = inject(CollectionStore);
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  private readonly revlog = signal<RevlogEntry[]>([]);

  readonly collection = this.store.collection;
  /** "Year in review" heatmap always shows the current calendar year (no selector on this page). */
  readonly year = new Date().getFullYear();

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.collection() === null) await this.store.load();
    this.revlog.set(await lastValueFrom(this.api.getRevlog()));
    this.loading.set(false);
  }

  // ---- day-mapped revlog inputs ---------------------------------------------
  // core/stats.ts helpers take already day-mapped inputs; map reviewedAt -> a
  // study-day number here, same idiom as features/deck-list/deck-list.ts.

  private readonly today = computed(() => {
    const coll = this.store.collection();
    return coll ? todayNumber(coll) : 0;
  });

  readonly reviewDays = computed<number[]>(() => {
    const coll = this.store.collection();
    if (!coll) return [];
    return this.revlog().map((e) => todayNumber(coll, e.reviewedAt));
  });

  readonly heatTimestamps = computed<number[]>(() => this.revlog().map((e) => e.reviewedAt));

  private readonly dayTimes = computed<DayTime[]>(() => {
    const coll = this.store.collection();
    if (!coll) return [];
    return this.revlog().map((e) => ({ day: todayNumber(coll, e.reviewedAt), timeMs: e.timeMs }));
  });

  // ---- (a) Reviews, 30 days + vs-last-month delta -----------------------------

  readonly reviews30 = computed(() =>
    countInRange(this.reviewDays(), this.today() - RANGE_DAYS + 1, this.today()),
  );
  private readonly reviewsPrev30 = computed(() =>
    countInRange(this.reviewDays(), this.today() - 2 * RANGE_DAYS + 1, this.today() - RANGE_DAYS),
  );
  readonly reviewsDelta = computed<Delta | null>(() =>
    toDelta(periodDelta(this.reviews30(), this.reviewsPrev30())),
  );

  // ---- (b) Study time, 30 days + vs-last-month delta --------------------------

  readonly studyTime30 = computed(() =>
    sumTimeInRange(this.dayTimes(), this.today() - RANGE_DAYS + 1, this.today()),
  );
  private readonly studyTimePrev30 = computed(() =>
    sumTimeInRange(this.dayTimes(), this.today() - 2 * RANGE_DAYS + 1, this.today() - RANGE_DAYS),
  );
  readonly studyTimeDelta = computed<Delta | null>(() =>
    toDelta(periodDelta(this.studyTime30(), this.studyTimePrev30())),
  );

  // ---- (c) Current streak -----------------------------------------------------

  readonly streak = computed(() => dayStreak(this.reviewDays(), this.today()));
  readonly best = computed(() => bestStreak(this.reviewDays()));

  // ---- (d) Mature cards ---------------------------------------------------------

  readonly states = computed(() => cardStateCounts(this.store.cards()));
  readonly totalCards = computed(() => {
    const s = this.states();
    return s.new + s.learning + s.young + s.mature + s.suspended + s.buried;
  });
  readonly maturePct = computed(() => {
    const total = this.totalCards();
    return total > 0 ? Math.round((this.states().mature / total) * 100) : 0;
  });

  // ---- "Reviews — last 14 days" chart ------------------------------------------

  readonly history = computed<HistoryBar[]>(() => {
    const points = reviewsByDay(this.reviewDays(), this.today(), HISTORY_DAYS);
    const max = Math.max(1, ...points.map((p) => p.count));
    return points.map((p, i) => {
      const date = this.dateLabel(p.offset);
      const noun = p.count === 1 ? 'review' : 'reviews';
      return {
        tooltip: `${date}: ${p.count} ${noun}`,
        count: p.count,
        pct: Math.round((p.count / max) * 100),
        isToday: p.offset === 0,
        dateLabel: i === 0 ? date : '',
      };
    });
  });

  // ---- answer buttons + true retention -----------------------------------------

  readonly buttons = computed<ButtonRow[]>(() => {
    const c = buttonCounts(this.revlog());
    const total = Math.max(1, c[1] + c[2] + c[3] + c[4]);
    const row = (label: string, count: number, cls: string) => ({
      label,
      count,
      cls,
      pct: Math.round((count / total) * 100),
    });
    return [
      row('Again', c[1], 'btn--again'),
      row('Hard', c[2], 'btn--hard'),
      row('Good', c[3], 'btn--good'),
      row('Easy', c[4], 'btn--easy'),
    ];
  });

  readonly reviewsTotal = computed(() => this.revlog().length);

  /** True retention = share of non-Again answers across the log (same formula as deck-list's "retention"). */
  readonly retention = computed<number | null>(() => {
    const c = buttonCounts(this.revlog());
    const total = c[1] + c[2] + c[3] + c[4];
    if (!total) return null;
    return Math.round(((total - c[1]) / total) * 100);
  });

  // ---- formatting ----------------------------------------------------------------

  formatDuration(ms: number): string {
    if (ms <= 0) return '0m';
    const totalMinutes = Math.round(ms / 60_000);
    if (totalMinutes < 1) return '<1m';
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /** Approximate calendar-date label for a day offset from today, e.g. "Jun 24". */
  private dateLabel(offset: number): string {
    const d = new Date(Date.now() + offset * 86_400_000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
