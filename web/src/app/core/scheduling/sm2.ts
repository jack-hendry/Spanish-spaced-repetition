import type { Card, DeckOptions, RevlogEntry } from '../models';
import { formatDays, minutesToDays } from './format';
import {
  RATING_BUTTON,
  type Rating,
  type ReviewContext,
  type Scheduler,
  type SchedulingResult,
} from './types';

const MIN_EASE = 1300; // 130% floor

/** SuperMemo-2 style scheduler with learning/relearning steps and ease factors. */
export class Sm2Scheduler implements Scheduler {
  preview(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
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
      button: RATING_BUTTON[rating],
      type:
        card.type === 'review'
          ? 'review'
          : card.type === 'relearning'
            ? 'relearn'
            : 'learn',
      interval: result.intervalDays,
      lastInterval: card.interval,
      factorOrStability: result.card.ease,
      timeMs,
    };
    return { card: result.card, revlog };
  }

  // ---- builders ------------------------------------------------------------

  private touched(card: Card, ctx: ReviewContext): Card {
    return { ...card, reps: card.reps + 1, lastReviewed: ctx.now, modified: ctx.now };
  }

  private learningStep(
    card: Card,
    ctx: ReviewContext,
    left: number,
    delayMin: number,
    type: 'learning' | 'relearning',
  ): SchedulingResult {
    const next: Card = {
      ...this.touched(card, ctx),
      type,
      queue: 'learning',
      left,
      due: ctx.now + delayMin * 60_000,
    };
    return { card: next, intervalDays: minutesToDays(delayMin), label: formatDays(minutesToDays(delayMin)) };
  }

  private graduate(
    card: Card,
    ctx: ReviewContext,
    intervalDays: number,
    opts: DeckOptions,
    ease?: number,
  ): SchedulingResult {
    const ivl = Math.min(Math.max(1, Math.round(intervalDays)), opts.review.maxInterval);
    const next: Card = {
      ...this.touched(card, ctx),
      type: 'review',
      queue: 'review',
      left: 0,
      interval: ivl,
      due: ctx.today + ivl,
      ease: ease ?? (card.ease || opts.new.startingEase),
    };
    return { card: next, intervalDays: ivl, label: formatDays(ivl) };
  }

  private reviewCard(
    card: Card,
    ctx: ReviewContext,
    intervalDays: number,
    ease: number,
    opts: DeckOptions,
    extra: Partial<Card> = {},
  ): SchedulingResult {
    const ivl = Math.min(Math.max(1, Math.round(intervalDays)), opts.review.maxInterval);
    const next: Card = {
      ...this.touched(card, ctx),
      type: 'review',
      queue: 'review',
      left: 0,
      interval: ivl,
      due: ctx.today + ivl,
      ease,
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
    const steps = opts.new.steps.length ? opts.new.steps : [1];
    const curLeft = card.type === 'new' ? steps.length : card.left || steps.length;
    const stepIndex = Math.max(0, steps.length - curLeft);

    const again = this.learningStep(card, ctx, steps.length, steps[0], 'learning');
    const hard = this.learningStep(card, ctx, curLeft, steps[stepIndex], 'learning');

    let good: SchedulingResult;
    if (curLeft <= 1) {
      good = this.graduate(card, ctx, opts.new.graduatingInterval, opts);
    } else {
      const nextLeft = curLeft - 1;
      const nextStep = steps.length - nextLeft;
      good = this.learningStep(card, ctx, nextLeft, steps[nextStep], 'learning');
    }

    const easy = this.graduate(card, ctx, opts.new.easyInterval, opts);
    return { again, hard, good, easy };
  }

  // ---- relearning (lapsed cards working back to review) --------------------

  private previewRelearning(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
    const steps = opts.lapse.steps.length ? opts.lapse.steps : [10];
    const curLeft = card.left || steps.length;
    const stepIndex = Math.max(0, steps.length - curLeft);
    // card.interval already holds the reduced interval set when the card lapsed.
    const graduateIvl = Math.max(opts.lapse.minInterval, card.interval || opts.lapse.minInterval);

    const again = this.learningStep(card, ctx, steps.length, steps[0], 'relearning');
    const hard = this.learningStep(card, ctx, curLeft, steps[stepIndex], 'relearning');

    let good: SchedulingResult;
    if (curLeft <= 1) {
      good = this.graduate(card, ctx, graduateIvl, opts);
    } else {
      const nextLeft = curLeft - 1;
      const nextStep = steps.length - nextLeft;
      good = this.learningStep(card, ctx, nextLeft, steps[nextStep], 'relearning');
    }

    const easy = this.graduate(card, ctx, graduateIvl, opts);
    return { again, hard, good, easy };
  }

  // ---- review --------------------------------------------------------------

  private previewReview(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult> {
    const ease = card.ease || opts.new.startingEase;
    const ivl = card.interval || 1;
    const mod = opts.review.intervalModifier;

    // AGAIN -> lapse
    const lapseEase = Math.max(MIN_EASE, ease - 200);
    const reducedIvl = Math.max(
      opts.lapse.minInterval,
      Math.round(ivl * opts.lapse.newIntervalPct),
    );
    const lapses = card.lapses + 1;
    const isLeech = lapses >= opts.lapse.leechThreshold && opts.lapse.leechThreshold > 0;
    const suspend = isLeech && opts.lapse.leechAction === 'suspend';

    let again: SchedulingResult;
    if (opts.lapse.steps.length) {
      const steps = opts.lapse.steps;
      again = this.learningStep(card, ctx, steps.length, steps[0], 'relearning');
      again.card = {
        ...again.card,
        lapses,
        ease: lapseEase,
        interval: reducedIvl,
        queue: suspend ? 'suspended' : 'learning',
      };
    } else {
      again = this.reviewCard(card, ctx, reducedIvl, lapseEase, opts, {
        lapses,
        queue: suspend ? 'suspended' : 'review',
      });
    }

    // HARD
    const hardEase = Math.max(MIN_EASE, ease - 150);
    const hardIvl = Math.max(1, Math.round(ivl * opts.review.hardInterval * mod));
    const hard = this.reviewCard(card, ctx, hardIvl, hardEase, opts);

    // GOOD (must exceed hard)
    const goodIvl = Math.max(hardIvl + 1, Math.round(ivl * (ease / 1000) * mod));
    const good = this.reviewCard(card, ctx, goodIvl, ease, opts);

    // EASY (must exceed good)
    const easyEase = ease + 150;
    const easyIvl = Math.max(
      good.intervalDays + 1,
      Math.round(ivl * (ease / 1000) * opts.review.easyBonus * mod),
    );
    const easy = this.reviewCard(card, ctx, easyIvl, easyEase, opts);

    return { again, hard, good, easy };
  }
}
