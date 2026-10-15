import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { CollectionStore } from '../collection.store';
import { schedulerFor } from '../scheduling/scheduler-factory';
import type { Card, Collection, Deck, DeckOptions, RevlogEntry } from '../models';
import { OutboxService } from './outbox.service';
import { ConflictResolver } from './conflict-resolver';
import type { OutboxOp } from './outbox-types';

// Minimal test fixtures
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

function makeOp(overrides?: Partial<OutboxOp>): OutboxOp {
  const revlog = makeRevlog();
  return {
    id: revlog.id,
    method: 'POST',
    path: '/review',
    body: { card: makeCard(), revlog, expectedRev: 'rev-123' },
    createdAt: Date.now(),
    attempts: 0,
    failedReason: null,
    ...overrides,
  };
}

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;
  let store: CollectionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(CollectionStore);
    TestBed.inject(OutboxService);
    resolver = TestBed.inject(ConflictResolver);

    // Set up store with test fixtures
    store.collection.set(makeCollection());
    store.decks.set([makeDeck()]);
    store.deckOptions.set([makeDeckOptions()]);
    store.cards.set([makeCard()]);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Test 1: A 409 for a /review op reloads once and returns 'replaced'
  it('a 409 for a /review op reloads once and returns "replaced" with expectedRev equal to server card rev', async () => {
    const op = makeOp();
    const serverCard = makeCard({ rev: 'rev-server-789' });
    const body = { card: serverCard };

    // Mock load to track calls
    let loadCalls = 0;
    const originalLoad = store.load.bind(store);
    store.load = async () => {
      loadCalls++;
      return originalLoad();
    };

    const outcome = await resolver.resolve(op, body);

    expect(loadCalls).toBe(1);
    expect(outcome.outcome).toBe('replaced');
    if (outcome.outcome === 'replaced') {
      expect((outcome.replacement.body as Record<string, unknown>)['expectedRev']).toBe(
        'rev-server-789',
      );
    }
  });

  // Test 2: D10 spec — scheduling computed at revlog.reviewedAt, not Date.now()
  // This test must fail if ctx.now is changed to Date.now()
  it('D10: replacement scheduling is computed at revlog.reviewedAt, not Date.now()', async () => {
    // Use a revlog from 5 minutes ago to create a divergence from Date.now()
    const oldReviewedAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const revlog = makeRevlog({
      reviewedAt: oldReviewedAt,
      interval: 15,
      lastInterval: 10,
    });

    const op = makeOp({ body: { card: makeCard(), revlog, expectedRev: null } });
    const serverCard = makeCard();
    const body = { card: serverCard };

    // Spy on scheduler to capture the context. Save the original method before
    // spying so the mock can call through to it. The spy will be auto-restored
    // by vitest's afterEach hook if restoreMocks is configured.
    const scheduler = schedulerFor(makeDeckOptions());
    const originalAnswer = scheduler.answer.bind(scheduler);
    let capturedCtx = { now: 0, today: 0 };

    vi.spyOn(scheduler, 'answer').mockImplementation(function (
      this: typeof scheduler,
      card,
      rating,
      opts,
      ctx,
      timeMs,
    ) {
      capturedCtx = ctx;
      return originalAnswer.call(this, card, rating, opts, ctx, timeMs);
    });

    const outcome = await resolver.resolve(op, body);

    // Verify the context was set to the old reviewedAt time
    expect(capturedCtx.now).toBe(oldReviewedAt);
    // Verify it's not Date.now() (should be different by ~5 minutes)
    expect(Math.abs(capturedCtx.now - Date.now())).toBeGreaterThan(4 * 60 * 1000);

    // Also verify the replacement was created
    expect(outcome.outcome).toBe('replaced');
  });

  // Test 3: Third consecutive conflict returns 'unresolved' with budget reason
  it('third consecutive conflict in one pass returns "unresolved" with budget reason', async () => {
    const coll = makeCollection();
    store.collection.set(coll);

    const op1 = makeOp();
    const op2 = makeOp({ id: 'rev2' });
    const op3 = makeOp({ id: 'rev3' });

    const body = { card: makeCard() };

    // First conflict: succeeds and reloads
    const outcome1 = await resolver.resolve(op1, body);
    expect(outcome1.outcome).toBe('replaced');

    // Second conflict: succeeds and reloads
    const outcome2 = await resolver.resolve(op2, body);
    expect(outcome2.outcome).toBe('replaced');

    // Third conflict: should hit budget limit (2 reloads per pass)
    const outcome3 = await resolver.resolve(op3, body);
    expect(outcome3.outcome).toBe('unresolved');
    if (outcome3.outcome === 'unresolved') {
      expect(outcome3.reason).toBe('reload budget exhausted');
    }
  });

  // Test 4: Non-/review path returns 'unresolved'
  it('non-/review path returns "unresolved"', async () => {
    const op = makeOp({ path: '/cards/c1' });
    const body = { card: makeCard() };

    const outcome = await resolver.resolve(op, body);

    expect(outcome.outcome).toBe('unresolved');
    if (outcome.outcome === 'unresolved') {
      expect(outcome.reason).toBe('conflict on non-review path');
    }
  });

  // Test 5: 409 without card returns 'unresolved'
  it('409 without card in body returns "unresolved"', async () => {
    const op = makeOp();
    const body = {}; // No card

    const outcome = await resolver.resolve(op, body);

    expect(outcome.outcome).toBe('unresolved');
    if (outcome.outcome === 'unresolved') {
      expect(outcome.reason).toBe('409 without card');
    }
  });

  // Test 6: Verify loop bound — replacement op that itself 409s should not loop forever
  // This test ensures that if a resolution produces an op that itself 409s,
  // the budget prevents infinite loops.
  it('a replacement op that itself 409s cannot loop forever — budget holds', async () => {
    const coll = makeCollection();
    store.collection.set(coll);

    // Simulate multiple resolution attempts in sequence (as would happen in a drain loop)
    // Each one should increment the reload counter and eventually hit the budget
    const op = makeOp();
    const serverCard = makeCard();
    const body = { card: serverCard };

    // First conflict: resolves
    const outcome1 = await resolver.resolve(op, body);
    expect(outcome1.outcome).toBe('replaced');

    // Second conflict: resolves
    const outcome2 = await resolver.resolve(op, body);
    expect(outcome2.outcome).toBe('replaced');

    // Third conflict: hits budget and returns unresolved
    const outcome3 = await resolver.resolve(op, body);
    expect(outcome3.outcome).toBe('unresolved');
    if (outcome3.outcome === 'unresolved') {
      expect(outcome3.reason).toBe('reload budget exhausted');
    }

    // The drain loop would then move this op to conflicts and continue,
    // not retry it again in the same pass. Budget holds.
  });
});
