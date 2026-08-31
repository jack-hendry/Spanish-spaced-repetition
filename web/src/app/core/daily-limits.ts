// Per-day new/review limit accounting that survives reloads.
//
// Each deck carries a `daily` tally of how many new and review cards have been
// studied "today". The tally resets implicitly when its `day` falls behind the
// current study day. A session's remaining allowance is the deck-options limit
// minus what the deck subtree has already studied today.

import type { Card, Deck, DeckDaily, DeckOptions } from './models';

const EMPTY = (day: number): DeckDaily => ({ day, newStudied: 0, reviewStudied: 0 });

/** A deck's tally for `today`, treating a stale tally as zero. */
export function dailyForToday(deck: Deck, today: number): DeckDaily {
  const daily = deck.daily;
  return daily?.day === today ? daily : EMPTY(today);
}

/** Whether answering this card (in its pre-answer queue) spends a daily slot. */
function studiedKind(card: Card): 'new' | 'review' | null {
  if (card.queue === 'new') return 'new';
  if (card.queue === 'review' && card.type === 'review') return 'review';
  return null; // learning/relearning steps don't re-consume a daily slot
}

/** The deck tally after studying `card`, or `null` if it spends no slot. */
export function bumpDaily(deck: Deck, card: Card, today: number): DeckDaily | null {
  const kind = studiedKind(card);
  if (!kind) return null;
  const cur = dailyForToday(deck, today);
  return kind === 'new'
    ? { ...cur, newStudied: cur.newStudied + 1 }
    : { ...cur, reviewStudied: cur.reviewStudied + 1 };
}

export interface RemainingLimits {
  newRemaining: number;
  reviewRemaining: number;
}

/** Remaining new/review allowance for a deck subtree, given today's tallies. */
export function remainingLimits(
  decks: Deck[],
  subtree: Set<string>,
  today: number,
  opts: DeckOptions,
): RemainingLimits {
  let newStudied = 0;
  let reviewStudied = 0;
  for (const d of decks) {
    if (!subtree.has(d.id)) continue;
    const tally = dailyForToday(d, today);
    newStudied += tally.newStudied;
    reviewStudied += tally.reviewStudied;
  }
  return {
    newRemaining: Math.max(0, opts.new.perDay - newStudied),
    reviewRemaining: Math.max(0, opts.review.perDay - reviewStudied),
  };
}
