// FSRS weight optimisation (Phase 6).
//
// Given the review log, reconstruct each card's review sequence, then fit the 19
// FSRS weights so that the model's predicted recall probability matches what
// actually happened — minimising binary cross-entropy (log loss). This is a
// lightweight, dependency-free gradient descent that only ever keeps a weight
// vector if it lowers the loss, so it can never make the scheduler worse.

import type { RevlogEntry } from '../models';
import {
  forgettingCurve,
  initDifficulty,
  initStability,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
} from './fsrs-math';

export interface ReviewItem {
  grade: 1 | 2 | 3 | 4;
  /** Whole days since the previous review of this card (0 for the first). */
  elapsedDays: number;
}

/** One card's reviews, in chronological order. */
export type CardHistory = ReviewItem[];

/**
 * Group revlog entries by card and turn each into a chronological history.
 * `dayOf` maps an epoch-ms timestamp to a study-day number.
 */
export function buildHistories(
  revlog: RevlogEntry[],
  dayOf: (reviewedAt: number) => number,
): CardHistory[] {
  const byCard = new Map<string, RevlogEntry[]>();
  for (const e of revlog) {
    const list = byCard.get(e.cardId);
    if (list) list.push(e);
    else byCard.set(e.cardId, [e]);
  }

  const histories: CardHistory[] = [];
  for (const entries of byCard.values()) {
    entries.sort((a, b) => a.reviewedAt - b.reviewedAt);
    let prevDay = dayOf(entries[0].reviewedAt);
    const history: CardHistory = entries.map((e, i) => {
      const day = dayOf(e.reviewedAt);
      const elapsedDays = i === 0 ? 0 : Math.max(0, day - prevDay);
      prevDay = day;
      return { grade: e.button, elapsedDays };
    });
    histories.push(history);
  }
  return histories;
}

const EPS = 1e-6;
const clampProb = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

/**
 * Mean binary cross-entropy of the model over all reviews after the first of
 * each card (the first review only seeds the initial memory state). Returns 0
 * when there is nothing to score.
 */
export function logLoss(weights: number[], histories: CardHistory[]): number {
  let loss = 0;
  let n = 0;
  for (const history of histories) {
    if (history.length < 2) continue;
    let s = initStability(weights, history[0].grade);
    let d = initDifficulty(weights, history[0].grade);
    for (let i = 1; i < history.length; i++) {
      const { grade, elapsedDays } = history[i];
      const r = clampProb(forgettingCurve(elapsedDays, s));
      const recalled = grade > 1 ? 1 : 0;
      loss += -(recalled * Math.log(r) + (1 - recalled) * Math.log(1 - r));
      n++;
      // Advance the memory state for the next prediction (S before D).
      if (grade === 1) {
        s = nextForgetStability(weights, d, s, r);
        d = nextDifficulty(weights, d, 1);
      } else {
        s = nextRecallStability(weights, d, s, r, grade);
        d = nextDifficulty(weights, d, grade);
      }
    }
  }
  return n ? loss / n : 0;
}

const W_LO = 1e-4;
const W_HI = 1e3;
const clampWeight = (w: number) => (Number.isFinite(w) ? Math.min(W_HI, Math.max(W_LO, w)) : W_LO);

function gradient(weights: number[], histories: CardHistory[], baseLoss: number): number[] {
  const h = 1e-4;
  const grad = new Array<number>(weights.length).fill(0);
  for (let i = 0; i < weights.length; i++) {
    const bumped = weights.slice();
    bumped[i] = weights[i] + h;
    const l = logLoss(bumped, histories);
    grad[i] = Number.isFinite(l) ? (l - baseLoss) / h : 0;
  }
  return grad;
}

export interface OptimizeOptions {
  iterations?: number;
  learningRate?: number;
}

export interface OptimizeResult {
  weights: number[];
  loss: number;
  initialLoss: number;
  /** Reviews that contributed to the loss (scored, i.e. non-first). */
  scored: number;
}

/** Count of scored (loss-contributing) reviews across all histories. */
export function scoredReviews(histories: CardHistory[]): number {
  let n = 0;
  for (const h of histories) if (h.length >= 2) n += h.length - 1;
  return n;
}

/**
 * Fit weights by gradient descent with backtracking. The returned weights always
 * have loss ≤ the initial loss (the best-seen vector is kept).
 */
export function optimizeWeights(
  initial: number[],
  histories: CardHistory[],
  options: OptimizeOptions = {},
): OptimizeResult {
  const iterations = options.iterations ?? 50;
  let lr = options.learningRate ?? 1;

  const initialLoss = logLoss(initial, histories);
  const scored = scoredReviews(histories);
  let best = initial.slice();
  let bestLoss = initialLoss;
  let current = initial.slice();

  for (let iter = 0; iter < iterations && scored > 0; iter++) {
    const baseLoss = logLoss(current, histories);
    const grad = gradient(current, histories, baseLoss);
    const candidate = current.map((w, i) => clampWeight(w - lr * grad[i]));
    const loss = logLoss(candidate, histories);

    if (Number.isFinite(loss) && loss < bestLoss) {
      best = candidate;
      bestLoss = loss;
      current = candidate;
    } else {
      // Overshot — shrink the step and retry from the best vector so far.
      lr *= 0.5;
      current = best.slice();
      if (lr < 1e-6) break;
    }
  }

  return { weights: best, loss: bestLoss, initialLoss, scored };
}
