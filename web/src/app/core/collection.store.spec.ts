import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { of, delay } from 'rxjs';

import { ApiService } from './api.service';
import { remainingLimits } from './daily-limits';
import { heatDateKey } from './heatmap';
import { CollectionStore, todayNumber } from './collection.store';
import type { Card, Collection, Deck, DeckOptions } from './models';

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

function deckOptions(over: Partial<DeckOptions> = {}): DeckOptions {
  return {
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

describe('CollectionStore.defaultDeckOptions (audit B6)', () => {
  function setup(): CollectionStore {
    TestBed.configureTestingModule({});
    return TestBed.inject(CollectionStore);
  }

  it('resolves through collection.defaultDeckOptionsId, not array position 0', () => {
    const store = setup();
    // "o2" sits first in the array; the collection's declared default is "o1".
    store.deckOptions.set([
      deckOptions({ id: 'o2', name: 'Other' }),
      deckOptions({ id: 'o1', name: 'Default' }),
    ]);
    store.collection.set(collection({ defaultDeckOptionsId: 'o1' }));

    expect(store.defaultDeckOptions()?.id).toBe('o1');
  });

  it('falls back to array position 0 when defaultDeckOptionsId does not resolve', () => {
    const store = setup();
    store.deckOptions.set([deckOptions({ id: 'o2', name: 'Other' })]);
    store.collection.set(collection({ defaultDeckOptionsId: 'missing' }));

    expect(store.defaultDeckOptions()?.id).toBe('o2');
  });
});

describe('todayNumber day rollover', () => {
  const CREATED = new Date(2026, 5, 24, 10, 20, 35).getTime();
  const at = (y: number, m: number, d: number, h: number, min = 0) =>
    new Date(y, m, d, h, min).getTime();

  it("rolls over at dayCutoffHour:00 local, not at created's time-of-day", () => {
    const coll = collection({ created: CREATED, dayCutoffHour: 4 });
    const before = todayNumber(coll, at(2026, 8, 1, 3, 59));
    const after = todayNumber(coll, at(2026, 8, 1, 4, 1));
    expect(after - before).toBe(1);
    // Still the same day well past created's 10:20 time-of-day.
    expect(todayNumber(coll, at(2026, 8, 1, 14, 30))).toBe(after);
    expect(todayNumber(coll, at(2026, 8, 1, 23, 59))).toBe(after);
  });

  it("ignores created's time-of-day", () => {
    const early = collection({ created: at(2026, 5, 24, 5, 0), dayCutoffHour: 4 });
    const late = collection({ created: at(2026, 5, 24, 23, 45), dayCutoffHour: 4 });
    const now = at(2026, 8, 1, 10, 30);
    expect(todayNumber(early, now)).toBe(todayNumber(late, now));
  });

  it('numbers the study day containing created as day 0', () => {
    const coll = collection({ created: CREATED, dayCutoffHour: 4 });
    expect(todayNumber(coll, CREATED)).toBe(0);
    expect(todayNumber(coll, at(2026, 5, 24, 4, 0))).toBe(0);
    expect(todayNumber(coll, at(2026, 5, 24, 23, 59))).toBe(0);
    // 03:00 that date is still the previous study day.
    expect(todayNumber(coll, at(2026, 5, 24, 3, 0))).toBe(-1);
  });

  it('treats a created before the cutoff hour as the previous calendar day', () => {
    const coll = collection({ created: at(2026, 5, 24, 2, 0), dayCutoffHour: 4 });
    // Day 0 runs Jun 23 04:00 -> Jun 24 04:00.
    expect(todayNumber(coll, at(2026, 5, 23, 12, 0))).toBe(0);
    expect(todayNumber(coll, at(2026, 5, 24, 3, 59))).toBe(0);
    expect(todayNumber(coll, at(2026, 5, 24, 4, 1))).toBe(1);
  });

  it('advances by exactly one per local calendar date across a full year', () => {
    const coll = collection({ created: CREATED, dayCutoffHour: 4 });
    let prev: number | null = null;
    for (let i = 0; i < 400; i++) {
      // Local noon on each consecutive date; noon is safely past any cutoff
      // and clear of both DST transition hours.
      const t = todayNumber(coll, new Date(2026, 0, 1 + i, 12).getTime());
      if (prev !== null) expect(t - prev).toBe(1);
      prev = t;
    }
  });

  it("shares heatDateKey's day boundaries on non-DST-transition days", () => {
    const coll = collection({ created: CREATED, dayCutoffHour: 4 });
    // Two consecutive ordinary dates, sampled either side of the cutoff.
    for (const [y, m, d] of [
      [2026, 8, 1],
      [2026, 8, 2],
    ] as const) {
      const beforeCutoff = new Date(y, m, d, 3, 59).getTime();
      const afterCutoff = new Date(y, m, d, 4, 1).getTime();
      expect(todayNumber(coll, afterCutoff) - todayNumber(coll, beforeCutoff)).toBe(1);
      expect(heatDateKey(afterCutoff, coll.dayCutoffHour)).not.toBe(
        heatDateKey(beforeCutoff, coll.dayCutoffHour),
      );
      const later = new Date(y, m, d, 20).getTime();
      expect(todayNumber(coll, later)).toBe(todayNumber(coll, afterCutoff));
      expect(heatDateKey(later, coll.dayCutoffHour)).toBe(
        heatDateKey(afterCutoff, coll.dayCutoffHour),
      );
    }
  });
});

describe('daily allowance across a calendar-day boundary', () => {
  it('restores the full new-card allowance the morning after an evening session', () => {
    const created = new Date(2026, 5, 24, 10, 20, 35).getTime();
    const coll = collection({ created, dayCutoffHour: 4 });

    // Evening session on Aug 31, after created's 10:20 time-of-day.
    const evening = new Date(2026, 7, 31, 17, 55).getTime();
    const studiedDay = todayNumber(coll, evening);
    const d = deck({ id: 'd1', daily: { day: studiedDay, newStudied: 20, reviewStudied: 0 } });
    const opts = deckOptions();

    // Same evening the cap is spent.
    expect(remainingLimits([d], new Set(['d1']), studiedDay, opts).newRemaining).toBe(0);

    // Next morning at 10:30 the tally is stale and the allowance is back.
    const nextMorning = todayNumber(coll, new Date(2026, 8, 1, 10, 30).getTime());
    expect(nextMorning).toBe(studiedDay + 1);
    expect(remainingLimits([d], new Set(['d1']), nextMorning, opts).newRemaining).toBe(
      opts.new.perDay,
    );
  });
});

describe('CollectionStore.load() concurrent requests (L-028)', () => {
  it('two overlapping load() calls produce exactly one getCollection() call and both promises resolve only after cards are populated', async () => {
    const mockApiService = {
      getCollection: vi.fn(() =>
        of({
          collection: collection(),
          notetypes: [],
          decks: [deck()],
          deckoptions: [deckOptions()],
        }).pipe(delay(10)),
      ),
      getCards: vi.fn(() => of([card({ id: 'c1' }), card({ id: 'c2' })]).pipe(delay(10))),
      getNote: vi.fn(),
      getNotes: vi.fn(),
      patchNote: vi.fn(),
      patchCard: vi.fn(),
      patchDeck: vi.fn(),
      patchCollection: vi.fn(),
      postReview: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [CollectionStore, { provide: ApiService, useValue: mockApiService }],
    });

    const store = TestBed.inject(CollectionStore);

    // Start both loads concurrently, capturing both promises.
    const p1 = store.load();
    const p2 = store.load();

    // Both promises should resolve.
    await p1;
    await p2;

    // getCollection() should have been called exactly once.
    expect(mockApiService.getCollection).toHaveBeenCalledTimes(1);

    // Both promises should have resolved only after cards are populated.
    expect(store.cards().length).toBe(2);
    expect(store.collection()).not.toBeNull();

    // Both promises should be the same instance when called concurrently.
    // This pins the current implementation's promise-sharing behaviour; it is
    // not L-028's contract (a distinct-but-equivalent promise is also correct).
    expect(p1).toBe(p2);
  });
});
