import type { Card, DeckOptions, RevlogEntry } from '../models';
import {
  forgettingCurve,
  initDifficulty,
  initStability,
  nextDifficulty,
  nextForgetStability,
  nextInterval,
  nextRecallStability,
} from './fsrs-math';
import { formatDays, minutesToDays } from './format';
import { clampLeft } from './learning-steps';
import {
  RATING_BUTTON,
  type Rating,
  type ReviewContext,
  type Scheduler,
  type SchedulingResult,
} from './types';

const GRADE: Record<Rating, 1 | 2 | 3 | 4> = RATING_BUTTON;

/**
 * FSRS-5 scheduler. Long-term intervals come from the (stability, difficulty)
 * memory model in `fsrs-math`; short-term learning/relearning steps are reused
 * from the deck options (mirroring Anki, which keeps steps under FSRS). A card's
 * memory state is seeded on graduation from the grade used and updated on every
 * review thereafter.
 */
export class FsrsScheduler implements Scheduler {
  preview(card: Card, opts: DeckOptions, ctx: ReviewContext): Record<Rating, SchedulingResult> {
    switch (card.type) {
      case 'new':
      case 'learning':
        return this.previewLearning(card, opts, ctx);
      case 'relearning':
        return this.previewRelearning(card, opts, ctx);
      case 'review':
        return this.previewReview(card, opts, ctx);
    }
  }

  answer(
    card: Card,
    rating: Rating,
    opts: DeckOptions,
    ctx: ReviewContext,
    timeMs = 0,
  ): { card: Card; revlog: RevlogEntry } {
    const result = this.preview(card, opts, ctx)[rating];
    const revlog: RevlogEntry = {
      id: `r${ctx.now}-${Math.random().toString(36).slice(2, 8)}`,
      cardId: card.id,
      reviewedAt: ctx.now,
      button: GRADE[rating],
      type: card.type === 'review' ? 'review' : card.type === 'relearning' ? 'relearn' : 'learn',
      interval: result.intervalDays,
      lastInterval: card.interval,
      factorOrStability: Math.round((result.card.stability ?? 0) * 100) / 100,
      timeMs,
    };
    return { card: result.card, revlog };
  }

  // ---- shared helpers ------------------------------------------------------

  private touched(card: Card, ctx: ReviewContext): Card {
    return { ...card, reps: card.reps + 1, lastReviewed: ctx.now, modified: ctx.now };
  }

  private weights(opts: DeckOptions): number[] {
    return opts.fsrs.weights;
  }

  /** Round + clamp a stability-derived interval to whole days within bounds. */
  private clampInterval(days: number, opts: DeckOptions): number {
    return Math.min(Math.max(1, Math.round(days)), opts.fsrs.maxInterval);
  }

  private stepResult(
    card: Card,
    ctx: ReviewContext,
    left: number,
    delayMin: number,
    type: 'learning' | 'relearning',
    memory: { stability: number; difficulty: number },
  ): SchedulingResult {
    const next: Card = {
      ...this.touched(card, ctx),
      type,
      queue: 'learning',
      left,
      due: ctx.now + delayMin * 60_000,
      stability: memory.stability,
      difficulty: memory.difficulty,
    };
    const ivl = minutesToDays(delayMin);
    return { card: next, intervalDays: ivl, label: formatDays(ivl) };
  }

  /** Move a card into the review queue with an FSRS-derived interval. */
  private graduate(
    card: Card,
    ctx: ReviewContext,
    stability: number,
    difficulty: number,
    opts: DeckOptions,
    extra: Partial<Card> = {},
  ): SchedulingResult {
    const ivl = this.clampInterval(nextInterval(stability, opts.fsrs.desiredRetention), opts);
    const next: Card = {
      ...this.touched(card, ctx),
      type: 'review',
      queue: 'review',
      left: 0,
      interval: ivl,
      due: ctx.today + ivl,
      stability,
      difficulty,
      ...extra,
    };
    return { card: next, intervalDays: ivl, label: formatDays(ivl) };
  }

  // ---- new / learning ------------------------------------------------------

  private previewLearning(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
    const w = this.weights(opts);
    const steps = opts.fsrs.learningSteps.length ? opts.fsrs.learningSteps : [1];
    const curLeft = clampLeft(card.type === 'new' ? steps.length : card.left, steps.length);
    const stepIndex = Math.max(0, steps.length - curLeft);

    const mem = (g: number) => ({
      stability: initStability(w, g),
      difficulty: initDifficulty(w, g),
    });

    const again = this.stepResult(card, ctx, steps.length, steps[0], 'learning', mem(1));
    const hard = this.stepResult(card, ctx, curLeft, steps[stepIndex], 'learning', mem(2));

    let good: SchedulingResult;
    if (curLeft <= 1) {
      good = this.graduate(card, ctx, initStability(w, 3), initDifficulty(w, 3), opts);
    } else {
      const nextLeft = curLeft - 1;
      const nextStep = steps.length - nextLeft;
      good = this.stepResult(card, ctx, nextLeft, steps[nextStep], 'learning', mem(3));
    }

    const easy = this.graduate(card, ctx, initStability(w, 4), initDifficulty(w, 4), opts);
    return { again, hard, good, easy };
  }

  // ---- relearning (lapsed cards working back to review) --------------------

  private previewRelearning(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
    const steps = opts.fsrs.relearningSteps.length ? opts.fsrs.relearningSteps : [10];
    const curLeft = clampLeft(card.left, steps.length);
    const stepIndex = Math.max(0, steps.length - curLeft);
    const stability = card.stability ?? Math.max(card.interval, 1);
    const difficulty = card.difficulty ?? initDifficulty(this.weights(opts), 3);
    const mem = { stability, difficulty };

    const again = this.stepResult(card, ctx, steps.length, steps[0], 'relearning', mem);
    const hard = this.stepResult(card, ctx, curLeft, steps[stepIndex], 'relearning', mem);

    let good: SchedulingResult;
    if (curLeft <= 1) {
      good = this.graduate(card, ctx, stability, difficulty, opts);
    } else {
      const nextLeft = curLeft - 1;
      const nextStep = steps.length - nextLeft;
      good = this.stepResult(card, ctx, nextLeft, steps[nextStep], 'relearning', mem);
    }

    const easy = this.graduate(card, ctx, stability, difficulty, opts);
    return { again, hard, good, easy };
  }

  // ---- review --------------------------------------------------------------

  private previewReview(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
    const w = this.weights(opts);
    // Migrate SM-2-scheduled cards (no memory state yet) on first FSRS touch.
    const stability = card.stability ?? Math.max(card.interval, 1);
    const difficulty = card.difficulty ?? initDifficulty(w, 3);

    const lastReviewDay = card.due - card.interval;
    const elapsed = Math.max(0, ctx.today - lastReviewDay);
    const r = forgettingCurve(elapsed, stability);

    // AGAIN -> lapse
    const lapseD = nextDifficulty(w, difficulty, 1);
    const lapseS = nextForgetStability(w, difficulty, stability, r);
    const lapses = card.lapses + 1;
    const isLeech = opts.lapse.leechThreshold > 0 && lapses >= opts.lapse.leechThreshold;
    const suspend = isLeech && opts.lapse.leechAction === 'suspend';
    const relearnSteps = opts.fsrs.relearningSteps;

    let again: SchedulingResult;
    const lapseIvl = this.clampInterval(nextInterval(lapseS, opts.fsrs.desiredRetention), opts);
    if (relearnSteps.length) {
      const delay = relearnSteps[0];
      again = {
        card: {
          ...this.touched(card, ctx),
          type: 'relearning',
          queue: suspend ? 'suspended' : 'learning',
          left: relearnSteps.length,
          due: ctx.now + delay * 60_000,
          interval: lapseIvl,
          lapses,
          stability: lapseS,
          difficulty: lapseD,
        },
        intervalDays: minutesToDays(delay),
        label: formatDays(minutesToDays(delay)),
      };
    } else {
      again = {
        card: {
          ...this.touched(card, ctx),
          type: 'review',
          queue: suspend ? 'suspended' : 'review',
          left: 0,
          interval: lapseIvl,
          due: ctx.today + lapseIvl,
          lapses,
          stability: lapseS,
          difficulty: lapseD,
        },
        intervalDays: lapseIvl,
        label: formatDays(lapseIvl),
      };
    }

    // HARD / GOOD / EASY -> successful recall
    const recall = (grade: 2 | 3 | 4): SchedulingResult => {
      const d = nextDifficulty(w, difficulty, grade);
      const s = nextRecallStability(w, difficulty, stability, r, grade);
      return this.graduate(card, ctx, s, d, opts);
    };

    return { again, hard: recall(2), good: recall(3), easy: recall(4) };
  }
}
