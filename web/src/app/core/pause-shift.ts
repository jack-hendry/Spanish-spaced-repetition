import { todayNumber } from './collection.store';
import type { Card, Collection } from './models';

/**
 * Given the collection (with a non-null `pausedAt`) and the current set of
 * cards, computes the absolute `due` values every eligible card should be
 * written to on resume, so studying continues as if no time passed while
 * paused.
 *
 * Pure function — no I/O, no mutation of `cards`. Rule is selected by
 * `card.type` (never `card.queue`), per the scheduling-domain invariant:
 * suspended cards must shift identically to their non-suspended counterparts.
 */
export function computeResumeCardUpdates(
  coll: Collection,
  cards: Card[],
  resumedAt: number,
): { id: string; due: number }[] {
  const pausedAt = coll.pausedAt!;
  const dayDelta = todayNumber(coll, resumedAt) - todayNumber(coll, pausedAt);
  const msDelta = resumedAt - pausedAt;

  const updates: { id: string; due: number }[] = [];
  for (const card of cards) {
    if (card.type === 'review' && dayDelta > 0) {
      updates.push({ id: card.id, due: card.due + dayDelta });
    } else if ((card.type === 'learning' || card.type === 'relearning') && msDelta > 0) {
      updates.push({ id: card.id, due: card.due + msDelta });
    }
    // type === 'new' is never shifted.
  }
  return updates;
}
