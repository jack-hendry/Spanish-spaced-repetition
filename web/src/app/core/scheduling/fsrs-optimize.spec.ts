import { describe, expect, it } from 'vitest';

import type { RevlogEntry } from '../models';
import {
  buildHistories,
  logLoss,
  optimizeWeights,
  scoredReviews,
  type CardHistory,
} from './fsrs-optimize';
import { forgettingCurve, initStability } from './fsrs-math';

const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

function rev(cardId: string, reviewedAt: number, button: 1 | 2 | 3 | 4): RevlogEntry {
  return {
    id: `r${reviewedAt}`,
    cardId,
    reviewedAt,
    button,
    type: 'review',
    interval: 1,
    lastInterval: 0,
    factorOrStability: 0,
    timeMs: 0,
  };
}

const DAY = 86_400_000;
const dayOf = (ms: number) => Math.floor(ms / DAY);

describe('buildHistories', () => {
  it('groups by card, orders by time, and computes elapsed days', () => {
    const log = [
      rev('b', 5 * DAY, 3),
      rev('a', 0, 3),
      rev('a', 2 * DAY, 3),
      rev('a', 5 * DAY, 1),
    ];
    const hs = buildHistories(log, dayOf);
    const a = hs.find((h) => h.length === 3)!;
    expect(a.map((r) => r.elapsedDays)).toEqual([0, 2, 3]);
    expect(a.map((r) => r.grade)).toEqual([3, 3, 1]);
    expect(scoredReviews(hs)).toBe(2); // card a: 2 scored, card b: 0
  });
});

describe('logLoss', () => {
  it('is low when the model predicts recall it actually saw', () => {
    // Reviewed again the same day (elapsed 0) -> R≈1 -> a recall is unsurprising.
    const h: CardHistory = [
      { grade: 3, elapsedDays: 0 },
      { grade: 3, elapsedDays: 0 },
    ];
    expect(logLoss(W, [h])).toBeLessThan(0.01);
  });

  it('is higher when an unlikely outcome occurs', () => {
    // A lapse right after learning, long gap -> model expected some recall.
    const recalled: CardHistory = [
      { grade: 3, elapsedDays: 0 },
      { grade: 3, elapsedDays: 0 },
    ];
    const lapsedLate: CardHistory = [
      { grade: 3, elapsedDays: 0 },
      { grade: 1, elapsedDays: 0 },
    ];
    expect(logLoss(W, [lapsedLate])).toBeGreaterThan(logLoss(W, [recalled]));
  });

  it('returns 0 when there is nothing to score', () => {
    expect(logLoss(W, [[{ grade: 3, elapsedDays: 0 }]])).toBe(0);
    expect(logLoss(W, [])).toBe(0);
  });
});

describe('optimizeWeights', () => {
  // Build a synthetic dataset from a "true" stability so there is signal to fit.
  function synthetic(): CardHistory[] {
    const histories: CardHistory[] = [];
    const trueStability = initStability(W, 3);
    for (let c = 0; c < 60; c++) {
      const elapsed = 1 + (c % 12); // varying gaps 1..12 days
      const r = forgettingCurve(elapsed, trueStability);
      // Deterministic outcome: recalled when retrievability is high.
      const grade: 1 | 3 = r > 0.7 ? 3 : 1;
      histories.push([
        { grade: 3, elapsedDays: 0 },
        { grade, elapsedDays: elapsed },
      ]);
    }
    return histories;
  }

  it('never returns a worse loss than it started with', () => {
    const histories = synthetic();
    const start = W.map((w) => w * 1.5); // perturbed starting point
    const res = optimizeWeights(start, histories, { iterations: 40 });
    expect(res.loss).toBeLessThanOrEqual(res.initialLoss);
    expect(Number.isFinite(res.loss)).toBe(true);
    expect(res.weights).toHaveLength(W.length);
  });

  it('actually reduces the loss when there is signal', () => {
    const histories = synthetic();
    const start = W.map((w) => w * 1.5);
    const res = optimizeWeights(start, histories, { iterations: 60 });
    expect(res.loss).toBeLessThan(res.initialLoss);
    expect(res.scored).toBe(60);
  });

  it('is a no-op with no scorable history', () => {
    const res = optimizeWeights(W, [], { iterations: 20 });
    expect(res.scored).toBe(0);
    expect(res.weights).toEqual(W);
  });
});
