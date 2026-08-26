import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { CollectionStore } from './collection.store';
import { StudyQueueService } from './study-queue.service';
import { Sm2Scheduler } from './scheduling/sm2';
import type { Card, Collection, Deck, DeckOptions } from './models';
import type { ReviewContext } from './scheduling/types';

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

const deckOptions: DeckOptions = {
  id: 'o1',
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
};

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

const ctx: ReviewContext = { now: 1000, today: 5 };

describe('StudyQueueService pause gate', () => {
  function setup(): { store: CollectionStore; queue: StudyQueueService } {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(CollectionStore);
    store.decks.set([deck()]);
    store.deckOptions.set([deckOptions]);
    const queue = TestBed.inject(StudyQueueService);
    return { store, queue };
  }

  it('next() returns null and counts() are all-zero while paused', () => {
    const { store, queue } = setup();
    // A due review card so unpaused behaviour would clearly return something.
    store.collection.set(collection({ pausedAt: null }));
    store.cards.set([
      card({ id: 'r1', queue: 'review', type: 'review', due: 0 }),
    ]);
    queue.start('d1');

    // Sanity check: unpaused, the queue serves the due card.
    expect(queue.next(ctx)?.id).toBe('r1');
    expect(queue.counts(ctx)).toEqual({ new: 0, learning: 0, review: 1 });

    store.collection.set(collection({ pausedAt: Date.now() }));

    expect(queue.next(ctx)).toBeNull();
    expect(queue.counts(ctx)).toEqual({ new: 0, learning: 0, review: 0 });
  });

  it('leaves existing behaviour unchanged when pausedAt is null', () => {
    const { store, queue } = setup();
    store.collection.set(collection({ pausedAt: null }));
    store.cards.set([
      card({ id: 'n1', queue: 'new', type: 'new', due: 0 }),
    ]);
    queue.start('d1');

    expect(queue.next(ctx)?.id).toBe('n1');
    expect(queue.counts(ctx)).toEqual({ new: 1, learning: 0, review: 0 });
  });
});

describe('StudyQueueService — card with a stale left (audit B1)', () => {
  function setup(): { store: CollectionStore; queue: StudyQueueService } {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(CollectionStore);
    store.decks.set([deck()]);
    store.deckOptions.set([deckOptions]);
    const queue = TestBed.inject(StudyQueueService);
    return { store, queue };
  }

  it('still serves a learning card scheduled from a stale left', () => {
    // Build a learning card with stale left value
    const stale = card({
      id: 'l1',
      type: 'learning',
      queue: 'learning',
      left: 3,
      due: 0,
    });

    // Schedule it using Sm2Scheduler, which should clamp the stale left and compute due
    const { card: next } = new Sm2Scheduler().answer(stale, 'good', deckOptions, ctx);

    // Verify the due is finite (not NaN from undefined step index)
    expect(Number.isFinite(next.due)).toBe(true);
    // With left=3 clamped to 2, answering "good" advances to the next step (index 1, which is 10 minutes)
    expect(next.due).toBe(1000 + 10 * 60_000);

    // Set up the queue and add the scheduled card
    const { store, queue } = setup();
    store.collection.set(collection({ pausedAt: null }));
    store.cards.set([next]);
    queue.start('d1');

    // Verify the card is reachable from the queue when its due time has arrived
    const result = queue.next({ now: next.due, today: 5 });
    expect(result?.id).toBe('l1');
  });
});

describe('StudyQueueService — default deck options (audit B6)', () => {
  function setup(): { store: CollectionStore; queue: StudyQueueService } {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(CollectionStore);
    const queue = TestBed.inject(StudyQueueService);
    return { store, queue };
  }

  it('startAll() resolves collection.defaultDeckOptionsId, not array position 0', () => {
    const { store, queue } = setup();
    const other = { ...deckOptions, id: 'o-other', name: 'Other' };
    // "other" sits first in the array; the collection's declared default is "o1".
    store.deckOptions.set([other, deckOptions]);
    store.collection.set(collection({ defaultDeckOptionsId: 'o1' }));
    store.decks.set([deck({ id: 'd1', optionsId: 'o-other' })]);
    store.cards.set([]);

    queue.startAll();

    expect(queue.options?.id).toBe('o1');
  });

  it('start() falls back to the default options group, not array position 0, for a deck with no matching group', () => {
    const { store, queue } = setup();
    const other = { ...deckOptions, id: 'o-other', name: 'Other' };
    store.deckOptions.set([other, deckOptions]);
    store.collection.set(collection({ defaultDeckOptionsId: 'o1' }));
    // Deck points at an options id that doesn't exist.
    store.decks.set([deck({ id: 'd1', optionsId: 'o-missing' })]);
    store.cards.set([]);

    queue.start('d1');

    expect(queue.options?.id).toBe('o1');
  });
});
