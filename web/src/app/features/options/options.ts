import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { lastValueFrom } from 'rxjs';
import { map } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { DeckOptions, SchedulerKind } from '../../core/models';
import { buildHistories, optimizeWeights } from '../../core/scheduling/fsrs-optimize';

/** Parse a "1 10 60" / "1, 10" steps string into a clean number array. */
function parseSteps(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

@Component({
  selector: 'app-options',
  imports: [FormsModule, RouterLink],
  templateUrl: './options.html',
  styleUrl: './options.scss',
})
export class Options {
  private readonly store = inject(CollectionStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly optionsId = toSignal(this.route.paramMap.pipe(map((p) => p.get('optionsId'))), {
    initialValue: null,
  });

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly notFound = signal(false);

  // Editable fields (signals so the form is reactive without zone.js).
  readonly name = signal('');
  readonly scheduler = signal<SchedulerKind>('sm2');

  readonly newPerDay = signal(20);
  readonly learningSteps = signal('1 10');
  readonly graduatingInterval = signal(1);
  readonly easyInterval = signal(4);
  readonly startingEase = signal(2500);

  readonly reviewPerDay = signal(200);
  readonly maxInterval = signal(36500);
  readonly easyBonus = signal(1.3);
  readonly hardInterval = signal(1.2);

  readonly relearningSteps = signal('10');
  readonly leechThreshold = signal(8);
  readonly leechAction = signal<'suspend' | 'tagOnly'>('suspend');
  readonly lapseMinInterval = signal(1);

  readonly buryNew = signal(true);
  readonly buryReview = signal(true);

  readonly desiredRetention = signal(0.9);
  readonly fsrsMaxInterval = signal(36500);

  /** Current FSRS weights (replaced by the optimiser; persisted on Save). */
  private readonly weights = signal<number[]>([]);
  readonly optimizing = signal(false);
  readonly optimizeNote = signal<string | null>(null);

  /** The 0..100 retention percentage shown next to the slider. */
  readonly retentionPct = computed(() => Math.round(this.desiredRetention() * 100));

  private original: DeckOptions | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.deckOptions().length === 0) await this.store.load();
    const id = this.optionsId();
    const opts = id != null && id !== '' ? this.store.deckOptionsById(id) : undefined;
    if (!opts) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }
    this.original = opts;
    this.name.set(opts.name);
    this.scheduler.set(opts.scheduler);

    this.newPerDay.set(opts.new.perDay);
    this.learningSteps.set(opts.new.steps.join(' '));
    this.graduatingInterval.set(opts.new.graduatingInterval);
    this.easyInterval.set(opts.new.easyInterval);
    this.startingEase.set(opts.new.startingEase);

    this.reviewPerDay.set(opts.review.perDay);
    this.maxInterval.set(opts.review.maxInterval);
    this.easyBonus.set(opts.review.easyBonus);
    this.hardInterval.set(opts.review.hardInterval);

    this.relearningSteps.set(opts.lapse.steps.join(' '));
    this.leechThreshold.set(opts.lapse.leechThreshold);
    this.leechAction.set(opts.lapse.leechAction);
    this.lapseMinInterval.set(opts.lapse.minInterval);

    this.buryNew.set(opts.display.buryNewSiblings);
    this.buryReview.set(opts.display.buryReviewSiblings);

    this.desiredRetention.set(opts.fsrs.desiredRetention);
    this.fsrsMaxInterval.set(opts.fsrs.maxInterval);
    this.weights.set(opts.fsrs.weights);

    this.loading.set(false);
  }

  /** Fit the FSRS weights to the review log; result is applied on Save. */
  async optimize(): Promise<void> {
    if (this.optimizing()) return;
    this.optimizing.set(true);
    this.optimizeNote.set(null);
    try {
      const coll = this.store.collection();
      const revlog = await lastValueFrom(this.api.getRevlog());
      const histories = buildHistories(revlog, (ms) =>
        coll ? todayNumber(coll, ms) : Math.floor(ms / 86_400_000),
      );
      const result = optimizeWeights(this.weights(), histories);
      if (result.scored === 0) {
        this.optimizeNote.set('No review history yet — study some cards first.');
        return;
      }
      this.weights.set(result.weights);
      const drop = (result.initialLoss - result.loss).toFixed(4);
      const caveat =
        result.scored < 400 ? ' (few reviews — FSRS suggests 1000+ for a good fit)' : '';
      this.optimizeNote.set(
        `Optimised over ${result.scored} reviews; loss ${result.initialLoss.toFixed(4)} → ` +
          `${result.loss.toFixed(4)} (−${drop}). Save to apply.${caveat}`,
      );
    } finally {
      this.optimizing.set(false);
    }
  }

  /** Build the patch from the current form state, preserving untouched fields. */
  private buildPatch(): Partial<DeckOptions> {
    const o = this.original;
    if (!o) throw new Error('buildPatch() called before init() resolved options');
    const learning = parseSteps(this.learningSteps());
    const relearning = parseSteps(this.relearningSteps());
    return {
      name: this.name().trim() || o.name,
      scheduler: this.scheduler(),
      new: {
        ...o.new,
        perDay: this.newPerDay(),
        steps: learning,
        graduatingInterval: this.graduatingInterval(),
        easyInterval: this.easyInterval(),
        startingEase: this.startingEase(),
      },
      review: {
        ...o.review,
        perDay: this.reviewPerDay(),
        maxInterval: this.maxInterval(),
        easyBonus: this.easyBonus(),
        hardInterval: this.hardInterval(),
      },
      lapse: {
        ...o.lapse,
        steps: relearning,
        leechThreshold: this.leechThreshold(),
        leechAction: this.leechAction(),
        minInterval: this.lapseMinInterval(),
      },
      display: {
        ...o.display,
        buryNewSiblings: this.buryNew(),
        buryReviewSiblings: this.buryReview(),
      },
      fsrs: {
        ...o.fsrs,
        desiredRetention: this.desiredRetention(),
        weights: this.weights(),
        // FSRS reuses the learning/relearning steps configured above.
        learningSteps: learning,
        relearningSteps: relearning,
        maxInterval: this.fsrsMaxInterval(),
      },
    };
  }

  async save(): Promise<void> {
    if (!this.original || this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await lastValueFrom(
        this.api.patchDeckOptions(this.original.id, this.buildPatch()),
      );
      this.store.applyDeckOptions(saved);
      await this.router.navigate(['/']);
    } finally {
      this.saving.set(false);
    }
  }
}
