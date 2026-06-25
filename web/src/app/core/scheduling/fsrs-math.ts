// FSRS-5 memory model (pure functions, no card/queue concerns).
//
// A card's memory state is (stability S, difficulty D). Stability is the number
// of days at which retrievability decays to 90%; difficulty is a 1..10 handle on
// how fast stability grows. The 19 weights `w` are tuned per-collection (Phase 6
// optimises them); the seeded defaults are FSRS-5's published priors.
//
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki

/** Power-law forgetting curve exponent and its derived time factor. */
export const DECAY = -0.5;
/** FACTOR is chosen so retrievability hits exactly 0.9 when t === S. */
export const FACTOR = 0.9 ** (1 / DECAY) - 1; // = 19/81

/** Stability floor — a card is never less memorable than ~15 minutes. */
export const S_MIN = 0.01;

const clampDifficulty = (d: number): number => Math.min(Math.max(d, 1), 10);

/** Retrievability: probability of recall t days after a review at stability S. */
export function forgettingCurve(t: number, stability: number): number {
  return (1 + (FACTOR * t) / stability) ** DECAY;
}

/** Days until retrievability falls to `requestRetention` for a given stability. */
export function nextInterval(stability: number, requestRetention: number): number {
  return (stability / FACTOR) * (requestRetention ** (1 / DECAY) - 1);
}

/** Initial stability after the first rating (grade 1..4). */
export function initStability(w: number[], grade: number): number {
  return Math.max(w[grade - 1], S_MIN);
}

/** Initial difficulty after the first rating (grade 1..4), clamped to 1..10. */
export function initDifficulty(w: number[], grade: number): number {
  return clampDifficulty(w[4] - Math.exp(w[5] * (grade - 1)) + 1);
}

/** Difficulty after a subsequent review, with linear damping + mean reversion. */
export function nextDifficulty(w: number[], difficulty: number, grade: number): number {
  const deltaD = -w[6] * (grade - 3);
  const damped = difficulty + (deltaD * (10 - difficulty)) / 9;
  // Revert toward the difficulty an "easy" first answer would have produced.
  const reverted = w[7] * initDifficulty(w, 4) + (1 - w[7]) * damped;
  return clampDifficulty(reverted);
}

/** Stability after a successful recall (grade 2=hard, 3=good, 4=easy). */
export function nextRecallStability(
  w: number[],
  difficulty: number,
  stability: number,
  retrievability: number,
  grade: number,
): number {
  const hardPenalty = grade === 2 ? w[15] : 1;
  const easyBonus = grade === 4 ? w[16] : 1;
  const growth =
    Math.exp(w[8]) *
    (11 - difficulty) *
    stability ** -w[9] *
    (Math.exp(w[10] * (1 - retrievability)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(S_MIN, stability * (1 + growth));
}

/** Stability after a lapse (grade 1=again). Never exceeds the prior stability. */
export function nextForgetStability(
  w: number[],
  difficulty: number,
  stability: number,
  retrievability: number,
): number {
  const sForget =
    w[11] *
    difficulty ** -w[12] *
    ((stability + 1) ** w[13] - 1) *
    Math.exp(w[14] * (1 - retrievability));
  return Math.max(S_MIN, Math.min(sForget, stability));
}
