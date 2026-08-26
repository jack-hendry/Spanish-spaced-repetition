/**
 * Clamp a card's persisted `left` (steps remaining) against the *current*
 * deck options' step count.
 *
 * `card.left` is persisted on the card, but the steps array comes from the
 * deck options the user can edit at any time. Shortening that array leaves
 * already-learning cards with `left > steps.length`, which sends the
 * step-index arithmetic in the schedulers out of bounds: `steps[i]` is
 * `undefined` and `due: ctx.now + undefined * 60_000` is `NaN`. A `NaN` due
 * fails every comparison in `StudyQueueService.next()`, so the card silently
 * disappears from the queue forever (audit B1).
 *
 * Clamping into `[1, stepCount]` makes every `steps[...]` index in both
 * schedulers valid by construction, so no downstream clamp is needed.
 * `0`/`NaN` keep their existing meaning: start at the top of the list.
 */
export function clampLeft(left: number, stepCount: number): number {
  const raw = left || stepCount;
  return Math.min(Math.max(1, raw), stepCount);
}
