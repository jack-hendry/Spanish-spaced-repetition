import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { RevlogEntry } from '../../core/models';
import {
  buttonCounts,
  cardStateCounts,
  dueForecast,
  reviewsByDay,
  type DayCount,
  type DuePoint,
} from '../../core/stats';

const FORECAST_DAYS = 30;
const HISTORY_DAYS = 30;

interface Bar {
  label: string;
  count: number;
  /** Height as a percentage of the tallest bar in the series. */
  pct: number;
}

function toBars(points: { offset: number; count: number }[], label: (o: number) => string): Bar[] {
  const max = Math.max(1, ...points.map((p) => p.count));
  return points.map((p) => ({
    label: label(p.offset),
    count: p.count,
    pct: Math.round((p.count / max) * 100),
  }));
}

@Component({
  selector: 'app-stats',
  imports: [RouterLink],
  templateUrl: './stats.html',
  styleUrl: './stats.scss',
})
export class Stats {
  private readonly store = inject(CollectionStore);
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  private readonly revlog = signal<RevlogEntry[]>([]);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.collection() === null) await this.store.load();
    this.revlog.set(await lastValueFrom(this.api.getRevlog()));
    this.loading.set(false);
  }

  private readonly today = computed(() => {
    const coll = this.store.collection();
    return coll ? todayNumber(coll) : 0;
  });

  readonly states = computed(() => cardStateCounts(this.store.cards()));

  readonly totalCards = computed(() => {
    const s = this.states();
    return s.new + s.learning + s.young + s.mature + s.suspended + s.buried;
  });

  /** Card-state breakdown as labelled segments for a stacked bar. */
  readonly stateSegments = computed(() => {
    const s = this.states();
    const total = Math.max(1, this.totalCards());
    const seg = (key: string, count: number, cls: string) => ({
      key,
      count,
      cls,
      pct: Math.round((count / total) * 100),
    });
    return [
      seg('New', s.new, 'seg--new'),
      seg('Learning', s.learning, 'seg--learning'),
      seg('Young', s.young, 'seg--young'),
      seg('Mature', s.mature, 'seg--mature'),
      seg('Suspended', s.suspended, 'seg--suspended'),
      seg('Buried', s.buried, 'seg--buried'),
    ].filter((x) => x.count > 0);
  });

  readonly forecast = computed<Bar[]>(() => {
    const points: DuePoint[] = dueForecast(this.store.cards(), this.today(), FORECAST_DAYS);
    return toBars(points, (o) => (o === 0 ? 'today' : `+${o}`));
  });

  readonly dueTotal = computed(() => this.forecast().reduce((n, b) => n + b.count, 0));

  readonly history = computed<Bar[]>(() => {
    const coll = this.store.collection();
    if (!coll) return [];
    const days = this.revlog().map((e) => todayNumber(coll, e.reviewedAt));
    const points: DayCount[] = reviewsByDay(days, this.today(), HISTORY_DAYS);
    return toBars(points, (o) => (o === 0 ? 'today' : `${o}`));
  });

  readonly reviewsTotal = computed(() => this.revlog().length);

  readonly buttons = computed(() => {
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

  /** Pass rate = share of non-Again answers across the log. */
  readonly retention = computed(() => {
    const c = buttonCounts(this.revlog());
    const total = c[1] + c[2] + c[3] + c[4];
    if (!total) return null;
    return Math.round(((total - c[1]) / total) * 100);
  });
}
