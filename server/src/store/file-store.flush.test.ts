// Deterministic flush test: verify that flushAll() both persists pending writes
// and clears the debounce timer so no second write occurs.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, Note } from '../models/index.js';
import { FileStore } from './file-store.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'srs-filestore-flush-'));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Seed the store with a minimal non-empty cards.json and notes.json. */
function seedPopulatedStore(dataDir: string): { card: Card; note: Note } {
  const note: Note = {
    id: 'n1',
    noteTypeId: 'nt-test',
    fields: { Front: 'front', Back: 'back' },
    tags: [],
    created: 1000,
    modified: 2000,
    guid: 'n1',
  };

  const card: Card = {
    id: 'c1-0',
    noteId: 'n1',
    deckId: 'deck-a',
    ord: 0,
    type: 'new',
    queue: 'new',
    due: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    lastReviewed: 0,
    created: 1000,
    modified: 2000,
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
  };

  writeFileSync(join(dataDir, 'notes.json'), JSON.stringify([note], null, 2), 'utf8');
  writeFileSync(join(dataDir, 'cards.json'), JSON.stringify([card], null, 2), 'utf8');

  return { card, note };
}

describe('FileStore debounce and flush', () => {
  it('Test A: after init + mutation + saveCardsSoon(), on-disk cards.json is unchanged', async () => {
    const { card: original } = seedPopulatedStore(dir);

    const store = new FileStore(dir, { debounceMs: 60_000 });
    await store.init();

    // Read the initial file content
    const beforePath = join(dir, 'cards.json');
    const contentBefore = readFileSync(beforePath, 'utf8');

    // Mutate the in-memory card
    const cards = store.getCards();
    cards[0].reps = 42;

    // Schedule a debounced write (does not flush immediately)
    store.saveCardsSoon();

    // The file should still have the original content
    const contentAfter = readFileSync(beforePath, 'utf8');
    expect(contentAfter).toBe(contentBefore);
    expect(JSON.parse(contentAfter)[0].reps).toBe(original.reps);
  });

  it('Test B: after await flushAll(), on-disk cards.json contains the mutation', async () => {
    seedPopulatedStore(dir);

    const store = new FileStore(dir, { debounceMs: 60_000 });
    await store.init();

    // Mutate the in-memory card
    const cards = store.getCards();
    cards[0].reps = 42;

    // Schedule a debounced write
    store.saveCardsSoon();

    // Force flush all pending writes
    await store.flushAll();

    // The file should now contain the mutation
    const cardsPath = join(dir, 'cards.json');
    const content = readFileSync(cardsPath, 'utf8');
    expect(JSON.parse(content)[0].reps).toBe(42);
  });

  it('Test C: after flushAll(), advancing fake timers does not trigger a second write (timer was cleared)', async () => {
    seedPopulatedStore(dir);

    vi.useFakeTimers();
    try {
      const store = new FileStore(dir, { debounceMs: 60_000 });
      await store.init();

      // Mutate and schedule a debounced write (schedules a setTimeout)
      const cards = store.getCards();
      cards[0].reps = 99;
      store.saveCardsSoon();

      // Record the number of scheduled timers before flushAll()
      const timerCountBeforeFlush = vi.getTimerCount();
      expect(timerCountBeforeFlush).toBeGreaterThan(0); // Verify a timer is scheduled

      // Flush all (should clear the timer and write)
      await store.flushAll();

      // After flushAll(), there should be no more timers for cards (timer was cleared)
      const timerCountAfterFlush = vi.getTimerCount();
      expect(timerCountAfterFlush).toBe(0);

      // Advance fake timers well past the debounce window (120s >> 60s debounce).
      // If the timer were NOT cleared, the pending callback would fire here.
      await vi.advanceTimersByTimeAsync(120_000);

      // Verify no new timers were scheduled (i.e., no second write attempt)
      expect(vi.getTimerCount()).toBe(0);

      // Verify the mutation persisted
      const cardsPath = join(dir, 'cards.json');
      const content = readFileSync(cardsPath, 'utf8');
      expect(JSON.parse(content)[0].reps).toBe(99);
    } finally {
      vi.useRealTimers();
    }
  });
});
