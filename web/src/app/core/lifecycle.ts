// Card lifecycle helpers: sibling burying and day-rollover unburying.
//
// Burying hides the other cards of a note ("siblings") for the rest of the day
// so you don't see the same material twice in one session. Buried cards are
// restored at the next day rollover. Suspending hides a card indefinitely until
// it is manually un-suspended.

import type { Card, CardQueue, CardType, DeckOptions } from './models';

export function isBuried(card: Card): boolean {
  return card.queue === 'schedBuried' || card.queue === 'userBuried';
}

/** The active queue a card returns to (from its type) once unburied. */
export function restoreQueue(type: CardType): CardQueue {
  switch (type) {
    case 'new':
      return 'new';
    case 'review':
      return 'review';
    case 'learning':
    case 'relearning':
      return 'learning';
  }
}

/** Whether a card is currently studyable (counts toward the queue). */
function isActive(card: Card): boolean {
  return card.queue === 'new' || card.queue === 'review' || card.queue === 'learning';
}

/**
 * The siblings of `answered` that should be buried, honouring the deck's
 * new/review bury options. A new-queue sibling is buried when buryNewSiblings is
 * set; review/learning siblings when buryReviewSiblings is set.
 */
export function siblingsToBury(
  cards: Card[],
  answered: Card,
  opts: DeckOptions,
): Card[] {
  return cards.filter((c) => {
    if (c.noteId !== answered.noteId || c.id === answered.id) return false;
    if (!isActive(c)) return false;
    return c.queue === 'new'
      ? opts.display.buryNewSiblings
      : opts.display.buryReviewSiblings;
  });
}
