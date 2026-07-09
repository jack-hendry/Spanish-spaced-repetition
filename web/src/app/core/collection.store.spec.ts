import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { CollectionStore } from './collection.store';
import type { Card, Collection, Deck } from './models';

function collection(over: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 1,
    created: 0,
    modified: 0,
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'o1',
    tags: [],
    pausedAt: null,
    ...over,
  };
}

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Spanish',
    parentId: null,
    optionsId: 'o1',
    collapsed: false,
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

describe('CollectionStore ownCounts pause gate', () => {
  function setup(): CollectionStore {
    TestBed.configureTestingModule({});
    return TestBed.inject(CollectionStore);
  }

  it('reads zero counts for every deck while paused, including a deck with no cards', () => {
    const store = setup();
    store.decks.set([
      deck({ id: 'd1', name: 'Spanish' }),
      deck({ id: 'd2', name: 'Spanish::Verbs' }),
    ]);
    store.cards.set([
      card({ id: 'c1', deckId: 'd1', queue: 'new', type: 'new', due: 0 }),
      card({ id: 'c2', deckId: 'd1', queue: 'review', type: 'review', due: 0 }),
    ]);

    // Sanity check unpaused: d1 has counts, d2 (no cards) rolls up to zero own counts.
    store.collection.set(collection({ pausedAt: null }));
    const unpausedNodes = store.deckTree();
    const d1Unpaused = unpausedNodes.find((n) => n.deck.id === 'd1')!;
    expect(d1Unpaused.own).toEqual({ new: 1, learning: 0, review: 1 });

    store.collection.set(collection({ pausedAt: Date.now() }));
    const pausedNodes = store.deckTree();
    const d1Paused = pausedNodes.find((n) => n.deck.id === 'd1')!;
    const d2Paused = pausedNodes.find((n) => n.deck.id === 'd2')!;

    expect(d1Paused.own).toEqual({ new: 0, learning: 0, review: 0 });
    expect(d1Paused.total).toEqual({ new: 0, learning: 0, review: 0 });
    expect(d2Paused.own).toEqual({ new: 0, learning: 0, review: 0 });
    expect(d2Paused.total).toEqual({ new: 0, learning: 0, review: 0 });
  });
});
