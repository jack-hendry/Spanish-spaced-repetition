import { describe, expect, it } from 'vitest';

import type { Card, DeckOptions } from './models';
import { isBuried, restoreQueue, siblingsToBury } from './lifecycle';

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

function opts(bury: { newS: boolean; reviewS: boolean }): DeckOptions {
  return {
    display: {
      buryNewSiblings: bury.newS,
      buryReviewSiblings: bury.reviewS,
    },
  } as DeckOptions;
}

describe('restoreQueue', () => {
  it('maps a card type back to its active queue', () => {
    expect(restoreQueue('new')).toBe('new');
    expect(restoreQueue('review')).toBe('review');
    expect(restoreQueue('learning')).toBe('learning');
    expect(restoreQueue('relearning')).toBe('learning');
  });
});

describe('isBuried', () => {
  it('recognises both bury kinds', () => {
    expect(isBuried(card({ queue: 'schedBuried' }))).toBe(true);
    expect(isBuried(card({ queue: 'userBuried' }))).toBe(true);
    expect(isBuried(card({ queue: 'new' }))).toBe(false);
  });
});

describe('siblingsToBury', () => {
  const answered = card({ id: 'a', ord: 0 });
  const newSib = card({ id: 'b', ord: 1, queue: 'new', type: 'new' });
  const reviewSib = card({ id: 'c', ord: 2, queue: 'review', type: 'review' });
  const otherNote = card({ id: 'd', noteId: 'n2', queue: 'new' });
  const suspended = card({ id: 'e', ord: 3, queue: 'suspended' });
  const all = [answered, newSib, reviewSib, otherNote, suspended];

  it('buries new and review siblings when both options are on', () => {
    const ids = siblingsToBury(all, answered, opts({ newS: true, reviewS: true })).map((c) => c.id);
    expect(ids.sort()).toEqual(['b', 'c']);
  });

  it('respects the per-kind bury flags', () => {
    expect(
      siblingsToBury(all, answered, opts({ newS: true, reviewS: false })).map((c) => c.id),
    ).toEqual(['b']);
    expect(
      siblingsToBury(all, answered, opts({ newS: false, reviewS: true })).map((c) => c.id),
    ).toEqual(['c']);
  });

  it('never buries the answered card, other notes, or inactive cards', () => {
    const ids = siblingsToBury(all, answered, opts({ newS: true, reviewS: true })).map((c) => c.id);
    expect(ids).not.toContain('a'); // self
    expect(ids).not.toContain('d'); // different note
    expect(ids).not.toContain('e'); // suspended
  });
});
