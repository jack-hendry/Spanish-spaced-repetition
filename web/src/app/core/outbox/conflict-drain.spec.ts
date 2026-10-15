import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiService } from '../api.service';
import { CollectionStore } from '../collection.store';
import type { Card, Collection, Deck, DeckOptions, RevlogEntry } from '../models';
import { ConflictResolver } from './conflict-resolver';
import { OUTBOX_KEY } from './outbox-ops';
import { OutboxService } from './outbox.service';
import type { OutboxOp } from './outbox-types';

// --- fixtures copied from conflict-resolver.spec.ts ---

function makeCollection(): Collection {
  return {
    schemaVersion: 21,
    created: Date.now() - 86_400_000 * 100, // 100 days ago
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'opts1',
    tags: [],
    pausedAt: null,
  };
}

function makeDeck(overrides?: Partial<Deck>): Deck {
  return {
    id: 'd1',
    name: 'Default',
    parentId: null,
    optionsId: 'opts1',
    collapsed: false,
    ...overrides,
  };
}

function makeDeckOptions(overrides?: Partial<DeckOptions>): DeckOptions {
  return {
    id: 'opts1',
    name: 'Default',
    scheduler: 'sm2',
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
      newIntervalPct: 0.5,
      minInterval: 1,
      leechThreshold: 8,
      leechAction: 'suspend',
    },
    display: {
      newGatherOrder: 'latest_added_first',
      newSortOrder: 'template_then_rank',
      reviewOrder: 'due_first',
      buryNewSiblings: true,
      buryReviewSiblings: true,
      buryInterdaySiblings: false,
    },
    fsrs: {
      desiredRetention: 0.9,
      weights: [1.0, 1.0, 6.0, -0.6, -0.6, 0.02, 0.14],
      maxInterval: 36500,
      learningSteps: [0.33, 3],
      relearningSteps: [10],
    },
    ...overrides,
  };
}

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card1',
    noteId: 'note1',
    deckId: 'd1',
    ord: 0,
    created: Date.now() - 86_400_000 * 10,
    modified: Date.now() - 60000,
    queue: 'review',
    type: 'review',
    due: 10,
    reps: 50,
    lapses: 0,
    left: 0,
    lastReviewed: Date.now() - 86_400_000 * 5,
    ease: 2500,
    interval: 10,
    stability: 20,
    difficulty: 5,
    rev: 'rev-123',
    ...overrides,
  };
}

function makeRevlog(overrides?: Partial<RevlogEntry>): RevlogEntry {
  return {
    id: 'rev-new-456',
    cardId: 'card1',
    button: 3, // good
    type: 'review',
    interval: 15,
    lastInterval: 10,
    factorOrStability: 2500,
    reviewedAt: Date.now() - 300000, // 5 minutes ago
    timeMs: 12345,
    ...overrides,
  };
}

// --- harness ---

type Send = (method: string, path: string, body: unknown) => Observable<unknown>;
interface ReviewBody {
  card: Card;
  revlog: RevlogEntry;
  expectedRev: string | null;
}

function conflict(card: Card): Observable<never> {
  return throwError(
    () => new HttpErrorResponse({ status: 409, error: { error: 'stale card', card } }),
  );
}

function reviewOp(id: string, cardId: string, expectedRev: string): OutboxOp {
  const revlog = makeRevlog({ id, cardId });
  return {
    id,
    method: 'POST',
    path: '/review',
    body: { card: makeCard({ id: cardId }), revlog, expectedRev },
    createdAt: Date.now(),
    attempts: 0,
    failedReason: null,
  };
}

function seed(ops: OutboxOp[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, ops, failed: [], conflicts: [] }));
}

function setup(send: Send, cards: Card[]) {
  const sendMock = vi.fn<Send>(send);
  const api = {
    send: sendMock,
    getCollection: vi.fn(() =>
      of({
        // MAX_SAFE_INTEGER: stops unburyForNewDay() enqueueing a PATCH /collection mid-drain.
        collection: { ...makeCollection(), lastUnburyDay: Number.MAX_SAFE_INTEGER },
        notetypes: [],
        decks: [makeDeck()],
        deckoptions: [makeDeckOptions()],
      }),
    ),
    getCards: vi.fn(() => of(cards)),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  // All synchronous, before the boot drain's first send settles (C-14).
  const store = TestBed.inject(CollectionStore);
  const load = vi.spyOn(store, 'load');
  const outbox = TestBed.inject(OutboxService);
  TestBed.inject(ConflictResolver);
  return { store, load, outbox, send: sendMock };
}

describe('conflict drain (spec 025)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('a stale queue of 5 conflicting ops on 5 cards drains fully in one pass, reloading once', async () => {
    const serverCardFor = (id: string): Card => makeCard({ id, rev: `server-${id}` });
    const cards = [1, 2, 3, 4, 5].map((n) => serverCardFor(`c${n}`));
    const conflicted = new Set<string>();
    seed([1, 2, 3, 4, 5].map((n) => reviewOp(`op-${n}`, `c${n}`, 'stale')));
    let conflicts409 = 0;
    const { load, outbox, send } = setup((method, path, body) => {
      if (path !== '/review') return of({});
      const b = body as ReviewBody;
      const id = b.card.id;
      if (!conflicted.has(id)) {
        conflicted.add(id);
        conflicts409++;
        return conflict(serverCardFor(id));
      }
      return of(b.card);
    }, cards);
    await outbox.drain();

    expect(outbox.pending()).toHaveLength(0);
    expect(outbox.conflicts()).toHaveLength(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(conflicts409).toBe(5);
    expect(send).toHaveBeenCalledTimes(10);
    for (const call of send.mock.calls) {
      expect(call[1]).toBe('/review');
    }
  });

  it('a lineage that keeps 409ing is parked after 2 re-applies; the queue behind drains', async () => {
    const serverCardFor = (id: string): Card => makeCard({ id, rev: `server-${id}` });
    const conflicted = new Set<string>();
    let c3Sends = 0;
    seed([
      reviewOp('op-1', 'c1', 'stale'),
      reviewOp('op-2', 'c2', 'stale'),
      reviewOp('op-A', 'c3', 'stale'),
      reviewOp('op-B', 'c4', 'stale'),
    ]);
    const { outbox, send } = setup(
      (method, path, body) => {
        if (path !== '/review') return of({});
        const b = body as ReviewBody;
        const id = b.card.id;
        if (id === 'c3') {
          c3Sends++;
          return conflict(serverCardFor(id));
        }
        if (id === 'c1' || id === 'c2') {
          if (!conflicted.has(id)) {
            conflicted.add(id);
            return conflict(serverCardFor(id));
          }
        }
        return of(b.card);
      },
      [1, 2, 3, 4].map((n) => serverCardFor(`c${n}`)),
    );
    await outbox.drain();

    expect(c3Sends).toBe(3);
    expect(outbox.conflicts()).toHaveLength(1);
    expect(outbox.conflicts()[0].conflictReason).toBe('reapply limit reached');
    expect(outbox.conflicts()[0].reapplies).toBe(2);
    expect(send.mock.calls.some((call) => (call[2] as ReviewBody).card.id === 'c4')).toBe(true);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('an offline chain of 3 reviews of one card cascades and every review re-applies', async () => {
    let stored = makeCard({ id: 'c1', rev: 'server-0' });
    let conflicts409 = 0;
    const accepted: { expectedRev: string | null; revlogId: string }[] = [];
    seed([
      reviewOp('op-1', 'c1', 'local-0'),
      reviewOp('op-2', 'c1', 'op-1'),
      reviewOp('op-3', 'c1', 'op-2'),
    ]);
    const { load, outbox, send } = setup(
      (method, path, body) => {
        if (path !== '/review') return of({});
        const b = body as ReviewBody;
        if (b.expectedRev !== (stored.rev ?? null)) {
          conflicts409++;
          return conflict(stored);
        }
        stored = { ...b.card, rev: b.revlog.id };
        accepted.push({ expectedRev: b.expectedRev, revlogId: b.revlog.id });
        return of(stored);
      },
      [stored],
    );
    await outbox.drain();

    expect(send).toHaveBeenCalledTimes(6);
    expect(conflicts409).toBe(3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(outbox.conflicts()).toHaveLength(0);
    expect(accepted).toHaveLength(3);
    expect(accepted[0].expectedRev).toBe('server-0');
    for (let i = 1; i < 3; i++) {
      expect(accepted[i].expectedRev).toBe(accepted[i - 1].revlogId);
    }
  });

  it('a new drain pass reloads again on its first conflict', async () => {
    const conflicted = new Set<string>();
    seed([reviewOp('op-1', 'c1', 'stale')]);
    const { load, outbox } = setup(
      (method, path, body) => {
        if (path !== '/review') return of({});
        const b = body as ReviewBody;
        const id = b.card.id;
        if (!conflicted.has(id)) {
          conflicted.add(id);
          return conflict(makeCard({ id, rev: `server-${id}` }));
        }
        return of(b.card);
      },
      [makeCard({ id: 'c1', rev: 'server-c1' }), makeCard({ id: 'c2', rev: 'server-c2' })],
    );
    await outbox.drain();
    expect(load).toHaveBeenCalledTimes(1);

    outbox.enqueue({
      id: 'op-2',
      method: 'POST',
      path: '/review',
      body: reviewOp('op-2', 'c2', 'stale').body,
    });
    await outbox.drain();

    // Regression guard, not a bug proof: also passes on pre-025 code (Analyst A5).
    expect(load).toHaveBeenCalledTimes(2);
    expect(outbox.conflicts()).toHaveLength(0);
  });

  it('reapplies is persisted on the replacement op before it is sent', async () => {
    const conflicted = new Set<string>();
    let persistedReapplies: number | undefined;
    let sendCount = 0;
    seed([reviewOp('op-1', 'c1', 'stale')]);
    const { outbox } = setup(
      (method, path, body) => {
        if (path !== '/review') return of({});
        sendCount++;
        const b = body as ReviewBody;
        const id = b.card.id;
        if (sendCount === 2) {
          const stored = JSON.parse(localStorage.getItem(OUTBOX_KEY)!) as { ops: OutboxOp[] };
          persistedReapplies = stored.ops[0].reapplies;
        }
        if (!conflicted.has(id)) {
          conflicted.add(id);
          return conflict(makeCard({ id, rev: `server-${id}` }));
        }
        return of(b.card);
      },
      [makeCard({ id: 'c1', rev: 'server-c1' })],
    );
    await outbox.drain();

    expect(persistedReapplies).toBe(1);
    expect(outbox.conflicts()).toHaveLength(0);
  });
});
