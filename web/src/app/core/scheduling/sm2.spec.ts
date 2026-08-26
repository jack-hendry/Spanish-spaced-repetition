import { describe, expect, it } from 'vitest';

import type { Card, DeckOptions } from '../models';
import { Sm2Scheduler } from './sm2';
import type { ReviewContext } from './types';

const sched = new Sm2Scheduler();

const NOW = 1_000_000_000_000;
const ctx: ReviewContext = { now: NOW, today: 100 };

function opts(over: Partial<DeckOptions> = {}): DeckOptions {
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
    scheduler: 'sm2',
    fsrs: {
      desiredRetention: 0.9,
      weights: [],
      maxInterval: 36500,
      learningSteps: [1, 10],
      relearningSteps: [10],
    },
    ...over,
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

describe('Sm2Scheduler — new / learning', () => {
  it('Good on a new card advances to the second learning step (10m)', () => {
    const r = sched.preview(card(), opts(), ctx).good;
    expect(r.label).toBe('10m');
    expect(r.card.type).toBe('learning');
    expect(r.card.queue).toBe('learning');
    expect(r.card.left).toBe(1);
    expect(r.card.due).toBe(NOW + 10 * 60_000);
  });

  it('Again on a new card resets to the first step (1m)', () => {
    const r = sched.preview(card(), opts(), ctx).again;
    expect(r.label).toBe('1m');
    expect(r.card.left).toBe(2);
    expect(r.card.due).toBe(NOW + 1 * 60_000);
  });

  it('Easy on a new card graduates with the easy interval (4d)', () => {
    const r = sched.preview(card(), opts(), ctx).easy;
    expect(r.label).toBe('4d');
    expect(r.card.type).toBe('review');
    expect(r.card.interval).toBe(4);
    expect(r.card.due).toBe(ctx.today + 4);
  });

  it('Good on the last learning step graduates (1d)', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 1 });
    const r = sched.preview(learning, opts(), ctx).good;
    expect(r.label).toBe('1d');
    expect(r.card.type).toBe('review');
    expect(r.card.interval).toBe(1);
  });
});

describe('Sm2Scheduler — review', () => {
  const rev = card({ type: 'review', queue: 'review', interval: 10, ease: 2500, reps: 3 });

  it('Good multiplies interval by ease (10 * 2.5 = 25d)', () => {
    const r = sched.preview(rev, opts(), ctx).good;
    expect(r.label).toBe('25d');
    expect(r.card.ease).toBe(2500);
    expect(r.card.interval).toBe(25);
    expect(r.card.due).toBe(ctx.today + 25);
  });

  it('Hard uses the hard multiplier and drops ease by 150 (12d)', () => {
    const r = sched.preview(rev, opts(), ctx).hard;
    expect(r.label).toBe('12d');
    expect(r.card.ease).toBe(2350);
  });

  it('Easy applies the easy bonus and raises ease (33d -> "1mo")', () => {
    const r = sched.preview(rev, opts(), ctx).easy;
    expect(r.intervalDays).toBe(33);
    expect(r.label).toBe('1mo');
    expect(r.card.ease).toBe(2650);
  });

  it('orders hard < good < easy', () => {
    const p = sched.preview(rev, opts(), ctx);
    expect(p.hard.intervalDays).toBeLessThan(p.good.intervalDays);
    expect(p.good.intervalDays).toBeLessThan(p.easy.intervalDays);
  });
});

describe('Sm2Scheduler — lapse / relearning', () => {
  const rev = card({ type: 'review', queue: 'review', interval: 10, ease: 2500, lapses: 0 });

  it('Again lapses into relearning, drops ease, reduces interval', () => {
    const r = sched.preview(rev, opts(), ctx).again;
    expect(r.label).toBe('10m');
    expect(r.card.type).toBe('relearning');
    expect(r.card.queue).toBe('learning');
    expect(r.card.lapses).toBe(1);
    expect(r.card.ease).toBe(2300);
    expect(r.card.interval).toBe(1); // newIntervalPct 0 -> min interval
  });

  it('suspends a leech when the lapse threshold is reached', () => {
    const nearLeech = card({ type: 'review', queue: 'review', interval: 10, lapses: 7 });
    const r = sched.preview(nearLeech, opts(), ctx).again;
    expect(r.card.lapses).toBe(8);
    expect(r.card.queue).toBe('suspended');
  });

  it('Good on the final relearning step graduates back to review', () => {
    const relearn = card({ type: 'relearning', queue: 'learning', left: 1, interval: 3 });
    const r = sched.preview(relearn, opts(), ctx).good;
    expect(r.card.type).toBe('review');
    expect(r.card.interval).toBe(3);
    expect(r.label).toBe('3d');
  });
});

describe('Sm2Scheduler — answer()', () => {
  it('returns a revlog entry capturing the rating and prior interval', () => {
    const rev = card({ type: 'review', queue: 'review', interval: 10, ease: 2500, reps: 2 });
    const { card: next, revlog } = sched.answer(rev, 'good', opts(), ctx, 1500);
    expect(revlog.button).toBe(3);
    expect(revlog.type).toBe('review');
    expect(revlog.lastInterval).toBe(10);
    expect(revlog.interval).toBe(25);
    expect(revlog.timeMs).toBe(1500);
    expect(next.reps).toBe(3);
    expect(next.lastReviewed).toBe(NOW);
  });
});

describe('Sm2Scheduler — steps shortened mid-learning (audit B1)', () => {
  function shortSteps(steps: number[]): DeckOptions {
    return opts({
      new: {
        perDay: 20,
        steps,
        graduatingInterval: 1,
        easyInterval: 4,
        startingEase: 2500,
        insertionOrder: 'sequential',
      },
    });
  }

  it('never produces a NaN due when left exceeds the shortened steps array', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const opts1 = shortSteps([1]);
    const p = sched.preview(learning, opts1, ctx);

    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const r = p[rating];
      expect(Number.isFinite(r.card.due)).toBe(true);
      expect(Number.isFinite(r.card.left)).toBe(true);
      expect(Number.isFinite(r.card.interval)).toBe(true);
      expect(r.label).not.toContain('NaN');
    }
  });

  it('clamps to the only remaining step and graduates on Good', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const opts1 = shortSteps([1]);
    const p = sched.preview(learning, opts1, ctx);

    expect(p.again.card.due).toBe(NOW + 60_000);
    expect(p.again.card.left).toBe(1);

    expect(p.hard.card.due).toBe(NOW + 60_000);
    expect(p.hard.card.left).toBe(1);

    expect(p.good.card.type).toBe('review');
    expect(p.good.card.interval).toBe(1);
    expect(p.good.card.due).toBe(ctx.today + 1);

    expect(p.easy.card.interval).toBe(4);
  });

  it('steps to the last remaining step on Good when more than one remains', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const opts2 = shortSteps([1, 10]);
    const p = sched.preview(learning, opts2, ctx);

    expect(p.good.card.due).toBe(NOW + 10 * 60_000);
    expect(p.good.card.left).toBe(1);
    expect(p.good.label).toBe('10m');
  });

  it('never produces a NaN due for a relearning card with a stale left', () => {
    const relearning = card({ type: 'relearning', queue: 'learning', left: 3, interval: 3 });
    const p = sched.preview(relearning, opts(), ctx);

    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const r = p[rating];
      expect(Number.isFinite(r.card.due)).toBe(true);
      expect(Number.isFinite(r.card.left)).toBe(true);
      expect(Number.isFinite(r.card.interval)).toBe(true);
      expect(r.label).not.toContain('NaN');
    }

    expect(p.good.card.type).toBe('review');
    expect(p.good.card.interval).toBe(3);
  });

  it('never returns a card whose left exceeds the current step count (R4)', () => {
    const learning = card({ type: 'learning', queue: 'learning', left: 3 });
    const relearning = card({ type: 'relearning', queue: 'learning', left: 3, interval: 3 });
    const dflt = opts();

    const cases: Array<{ subject: Card; options: DeckOptions; stepCount: number }> = [
      { subject: learning, options: shortSteps([1]), stepCount: 1 },
      { subject: learning, options: shortSteps([1, 10]), stepCount: 2 },
      // relearning indexes lapse.steps, not new.steps
      { subject: relearning, options: dflt, stepCount: dflt.lapse.steps.length },
    ];

    for (const { subject, options, stepCount } of cases) {
      const p = sched.preview(subject, options, ctx);
      for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
        expect(p[rating].card.left).toBeLessThanOrEqual(stepCount);
      }
    }
  });
});
