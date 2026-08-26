import { describe, expect, it } from 'vitest';

import type { Card, DeckOptions } from '../models';
import { FsrsScheduler } from './fsrs';
import {
  forgettingCurve,
  initDifficulty,
  initStability,
  nextForgetStability,
  nextInterval,
  nextRecallStability,
} from './fsrs-math';
import type { ReviewContext } from './types';

// FSRS-5 published default weights.
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

const NOW = 1_000_000_000_000;
const ctx: ReviewContext = { now: NOW, today: 100 };
const sched = new FsrsScheduler();

function opts(over: Partial<DeckOptions['fsrs']> = {}, scheduler = 'fsrs'): DeckOptions {
  return {
    id: 'o',
    name: 'Default',
    new: {
      perDay: 20,
      steps: [1, 10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 2500,
      insertionOrder: 'sequential',
    },
    review: {
      perDay: 200,
      maxInterval: 36500,
      easyBonus: 1.3,
      intervalModifier: 1.0,
      hardInterval: 1.2,
    },
    lapse: {
      steps: [10],
      newIntervalPct: 0.0,
      minInterval: 1,
      leechThreshold: 8,
      leechAction: 'suspend',
    },
    display: {
      newGatherOrder: 'deck',
      newSortOrder: 'orderGathered',
      reviewOrder: 'dueRandom',
      buryNewSiblings: true,
      buryReviewSiblings: true,
      buryInterdaySiblings: true,
    },
    scheduler: scheduler as DeckOptions['scheduler'],
    fsrs: {
      desiredRetention: 0.9,
      weights: W,
      maxInterval: 36500,
      learningSteps: [1, 10],
      relearningSteps: [10],
      ...over,
    },
  };
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ord: 0,
    type: 'new',
    queue: 'new',
    due: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    lastReviewed: null,
    created: 0,
    modified: 0,
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
    ...over,
  };
}

describe('fsrs-math', () => {
  it('retrievability is 1 at t=0 and exactly 0.9 at t=S', () => {
    expect(forgettingCurve(0, 5)).toBeCloseTo(1, 10);
    expect(forgettingCurve(5, 5)).toBeCloseTo(0.9, 10);
    expect(forgettingCurve(10, 5)).toBeLessThan(0.9);
  });

  it('interval equals stability when requesting 0.9 retention', () => {
    expect(nextInterval(12, 0.9)).toBeCloseTo(12, 6);
  });

  it('higher requested retention yields a shorter interval', () => {
    expect(nextInterval(12, 0.95)).toBeLessThan(nextInterval(12, 0.9));
  });

  it('initial stability is the per-grade weight', () => {
    expect(initStability(W, 1)).toBeCloseTo(W[0], 10);
    expect(initStability(W, 3)).toBeCloseTo(W[2], 10);
  });

  it('an easier first answer is less difficult', () => {
    expect(initDifficulty(W, 4)).toBeLessThan(initDifficulty(W, 1));
    expect(initDifficulty(W, 1)).toBeLessThanOrEqual(10);
    expect(initDifficulty(W, 4)).toBeGreaterThanOrEqual(1);
  });

  it('a successful recall increases stability, more so for easy than hard', () => {
    const S = 5;
    const D = 5;
    const R = forgettingCurve(S, S); // 0.9
    const hard = nextRecallStability(W, D, S, R, 2);
    const good = nextRecallStability(W, D, S, R, 3);
    const easy = nextRecallStability(W, D, S, R, 4);
    expect(good).toBeGreaterThan(S);
    expect(hard).toBeLessThan(good);
    expect(easy).toBeGreaterThan(good);
  });

  it('a lapse never increases stability', () => {
    const S = 20;
    const R = forgettingCurve(40, S); // overdue, low retrievability
    expect(nextForgetStability(W, 5, S, R)).toBeLessThanOrEqual(S);
  });
});

describe('FsrsScheduler — new card', () => {
  it('Good steps through learning, Easy graduates to review', () => {
    const r = sched.preview(card(), opts(), ctx);
    expect(r.good.card.type).toBe('learning');
    expect(r.good.card.left).toBe(1);

    expect(r.easy.card.type).toBe('review');
    expect(r.easy.card.queue).toBe('review');
    // Easy seeds the easy initial stability and an interval derived from it.
    expect(r.easy.card.stability).toBeCloseTo(initStability(W, 4), 6);
    expect(r.easy.card.due).toBe(ctx.today + r.easy.card.interval);
    expect(r.easy.card.interval).toBeGreaterThan(0);
  });

  it('graduating with a single learning step sets memory state from the grade', () => {
    const r = sched.preview(card(), opts({ learningSteps: [1] }), ctx).good;
    expect(r.card.type).toBe('review');
    expect(r.card.stability).toBeCloseTo(initStability(W, 3), 6);
    expect(r.card.difficulty).toBeCloseTo(initDifficulty(W, 3), 6);
  });
});

describe('FsrsScheduler — review', () => {
  const reviewCard = card({
    type: 'review',
    queue: 'review',
    reps: 3,
    interval: 10,
    due: 100, // reviewed on time today
    stability: 10,
    difficulty: 5,
  });

  it('orders intervals again < hard < good < easy', () => {
    const r = sched.preview(reviewCard, opts(), ctx);
    expect(r.again.intervalDays).toBeLessThan(r.hard.intervalDays);
    expect(r.hard.intervalDays).toBeLessThanOrEqual(r.good.intervalDays);
    expect(r.good.intervalDays).toBeLessThanOrEqual(r.easy.intervalDays);
  });

  it('Good grows stability and pushes the due day out', () => {
    const r = sched.preview(reviewCard, opts(), ctx).good;
    expect(r.card.stability!).toBeGreaterThan(reviewCard.stability!);
    expect(r.card.interval).toBeGreaterThan(reviewCard.interval);
    expect(r.card.due).toBe(ctx.today + r.card.interval);
  });

  it('Again lapses into relearning, reduces stability, counts a lapse', () => {
    const r = sched.preview(reviewCard, opts(), ctx).again;
    expect(r.card.type).toBe('relearning');
    expect(r.card.queue).toBe('learning');
    expect(r.card.lapses).toBe(reviewCard.lapses + 1);
    expect(r.card.stability!).toBeLessThan(reviewCard.stability!);
    expect(r.card.due).toBe(ctx.now + 10 * 60_000);
  });

  it('suspends a leech on its threshold lapse', () => {
    const leechy = card({
      ...reviewCard,
      lapses: 7, // threshold 8 -> this Again is the 8th
    });
    const r = sched.preview(leechy, opts(), ctx).again;
    expect(r.card.queue).toBe('suspended');
  });

  it('migrates an SM-2 card with no memory state', () => {
    const legacy = card({
      type: 'review',
      queue: 'review',
      interval: 8,
      due: 100,
      stability: null,
      difficulty: null,
    });
    const r = sched.preview(legacy, opts(), ctx).good;
    expect(r.card.stability!).toBeGreaterThan(0);
    expect(r.card.difficulty!).toBeGreaterThanOrEqual(1);
  });
});

describe('FsrsScheduler — answer', () => {
  it('emits a revlog carrying the resulting stability', () => {
    const { card: next, revlog } = sched.answer(
      card({ type: 'review', queue: 'review', interval: 10, due: 100, stability: 10, difficulty: 5 }),
      'good',
      opts(),
      ctx,
      1234,
    );
    expect(revlog.button).toBe(3);
    expect(revlog.type).toBe('review');
    expect(revlog.timeMs).toBe(1234);
    expect(revlog.factorOrStability).toBeCloseTo(next.stability!, 2);
  });
});

describe('FsrsScheduler — steps shortened mid-learning (audit B1)', () => {
  it('never produces a NaN due when left exceeds the shortened learning steps', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const o = opts({ learningSteps: [1] });
    const p = sched.preview(learning, o, ctx);

    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const r = p[rating];
      expect(Number.isFinite(r.card.due)).toBe(true);
      expect(Number.isFinite(r.card.left)).toBe(true);
      expect(Number.isFinite(r.card.interval)).toBe(true);
      expect(Number.isFinite(r.card.stability!)).toBe(true);
      expect(Number.isFinite(r.card.difficulty!)).toBe(true);
      expect(r.label).not.toContain('NaN');
    }
  });

  it('clamps to the only remaining step and graduates on Good', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const o = opts({ learningSteps: [1] });
    const p = sched.preview(learning, o, ctx);

    expect(p.again.card.due).toBe(NOW + 60_000);
    expect(p.again.card.left).toBe(1);

    expect(p.hard.card.due).toBe(NOW + 60_000);
    expect(p.hard.card.left).toBe(1);

    expect(p.good.card.type).toBe('review');
    expect(p.good.card.interval).toBeGreaterThanOrEqual(1);
    expect(p.good.card.due).toBe(ctx.today + p.good.card.interval);
  });

  it('steps to the last remaining step on Good when more than one remains', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const o = opts({ learningSteps: [1, 10] });
    const p = sched.preview(learning, o, ctx);

    expect(p.good.card.due).toBe(NOW + 10 * 60_000);
    expect(p.good.card.left).toBe(1);
  });

  it('never produces a NaN due for a relearning card with a stale left', () => {
    const relearning = card({ type: 'relearning', queue: 'learning', left: 3, interval: 3, stability: 4, difficulty: 5 });
    const o = opts({ relearningSteps: [10] });
    const p = sched.preview(relearning, o, ctx);

    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const r = p[rating];
      expect(Number.isFinite(r.card.due)).toBe(true);
      expect(Number.isFinite(r.card.left)).toBe(true);
      expect(Number.isFinite(r.card.interval)).toBe(true);
      expect(Number.isFinite(r.card.stability!)).toBe(true);
      expect(Number.isFinite(r.card.difficulty!)).toBe(true);
      expect(r.label).not.toContain('NaN');
      expect(r.card.left).toBeLessThanOrEqual(1);
    }
  });
});
