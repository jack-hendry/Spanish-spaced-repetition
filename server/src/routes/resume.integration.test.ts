// Integration coverage for POST /collection/resume: the crash-safe, ordered
// bulk `due` write that clears the global pause. Verifies absolute-write
// idempotency (no double-shift on retry / crash recovery, T7), the
// expectedPausedAt guard (T7b), and the mandatory cards-before-collection
// write order. Runs the real Express router over a FileStore in a temp dir.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import cors from 'cors';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Collection } from '../models/index.js';
import { FileStore } from '../store/file-store.js';
import { buildRouter } from './index.js';

let dir: string;
let store: FileStore;
let server: ReturnType<express.Express['listen']>;
let base: string;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function card(over: Partial<Card> & Pick<Card, 'id'>): Card {
  const now = Date.now();
  return {
    noteId: over.noteId ?? `note-${over.id}`,
    deckId: over.deckId ?? 'd1',
    ord: 0,
    type: 'review',
    queue: 'review',
    due: 100,
    reps: 3,
    lapses: 0,
    left: 0,
    lastReviewed: null,
    created: now,
    modified: now,
    ease: 2500,
    interval: 5,
    stability: null,
    difficulty: null,
    ...over,
  };
}

function readCardsFromDisk(): Card[] {
  return JSON.parse(readFileSync(join(dir, 'cards.json'), 'utf8')) as Card[];
}

function readCollectionFromDisk(): Collection {
  return JSON.parse(readFileSync(join(dir, 'collection.json'), 'utf8')) as Collection;
}

const PAUSED_AT = 1_700_000_000_000;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'srs-resume-'));
  store = new FileStore(dir, { debounceMs: 0 });
  await store.init();

  // Seed two review cards at due 100 / 130 and a global pause.
  store.getCards().push(card({ id: 'c1', due: 100 }), card({ id: 'c2', due: 130 }));
  await store.saveCards();
  store.getCollection().pausedAt = PAUSED_AT;
  await store.saveCollection();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', buildRouter(store));
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

afterEach(async () => {
  await store.flushAll();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /collection/resume', () => {
  it('T7: applies absolute due once, and re-applying converges (no double-shift)', async () => {
    const payload = {
      expectedPausedAt: PAUSED_AT,
      cardUpdates: [
        { id: 'c1', due: 130 },
        { id: 'c2', due: 160 },
      ],
    };

    const first = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { applied: boolean }).applied).toBe(true);

    // Cards shifted, other fields untouched, pause cleared — on disk.
    let disk = readCardsFromDisk();
    expect(disk.find((c) => c.id === 'c1')!.due).toBe(130);
    expect(disk.find((c) => c.id === 'c2')!.due).toBe(160);
    expect(disk.find((c) => c.id === 'c1')!.interval).toBe(5);
    expect(disk.find((c) => c.id === 'c1')!.type).toBe('review');
    expect(readCollectionFromDisk().pausedAt).toBeNull();

    // Re-sending the SAME payload is now a no-op (pause already cleared).
    const second = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(((await second.json()) as { applied: boolean }).applied).toBe(false);
    disk = readCardsFromDisk();
    expect(disk.find((c) => c.id === 'c1')!.due).toBe(130);
    expect(disk.find((c) => c.id === 'c2')!.due).toBe(160);
  });

  it('T7: crash recovery — pausedAt still set with cards already shifted; re-send converges and clears pause', async () => {
    // Simulate a crash between step (a) and (b): cards were written with their
    // shifted due, but pausedAt was never cleared.
    const cards = store.getCards();
    cards.find((c) => c.id === 'c1')!.due = 130;
    cards.find((c) => c.id === 'c2')!.due = 160;
    await store.saveCards();
    // pausedAt is still PAUSED_AT (never cleared by the "crashed" request).
    expect(store.getCollection().pausedAt).toBe(PAUSED_AT);

    // Recovery re-sends the identical absolute payload.
    const res = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: PAUSED_AT,
        cardUpdates: [
          { id: 'c1', due: 130 },
          { id: 'c2', due: 160 },
        ],
      }),
    });
    expect(((await res.json()) as { applied: boolean }).applied).toBe(true);

    // No double-shift: due unchanged; pause now correctly cleared.
    const disk = readCardsFromDisk();
    expect(disk.find((c) => c.id === 'c1')!.due).toBe(130);
    expect(disk.find((c) => c.id === 'c2')!.due).toBe(160);
    expect(readCollectionFromDisk().pausedAt).toBeNull();
  });

  it('T7b: mismatched expectedPausedAt is a no-op — no card altered, pausedAt unchanged', async () => {
    const res = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: PAUSED_AT + 999, // stale / wrong episode
        cardUpdates: [
          { id: 'c1', due: 999 },
          { id: 'c2', due: 999 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: boolean }).applied).toBe(false);

    const disk = readCardsFromDisk();
    expect(disk.find((c) => c.id === 'c1')!.due).toBe(100);
    expect(disk.find((c) => c.id === 'c2')!.due).toBe(130);
    expect(readCollectionFromDisk().pausedAt).toBe(PAUSED_AT);
  });

  it('T7b: already-resumed (pausedAt null) is a no-op even if payload matches null', async () => {
    store.getCollection().pausedAt = null;
    await store.saveCollection();

    const res = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: null,
        cardUpdates: [{ id: 'c1', due: 999 }],
      }),
    });
    expect(((await res.json()) as { applied: boolean }).applied).toBe(false);
    expect(readCardsFromDisk().find((c) => c.id === 'c1')!.due).toBe(100);
  });

  it('skips unknown card ids and leaves them absent, still clearing the pause', async () => {
    const res = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: PAUSED_AT,
        cardUpdates: [
          { id: 'c1', due: 200 },
          { id: 'does-not-exist', due: 5 },
        ],
      }),
    });
    expect(((await res.json()) as { applied: boolean }).applied).toBe(true);
    const disk = readCardsFromDisk();
    expect(disk.find((c) => c.id === 'c1')!.due).toBe(200);
    expect(disk.some((c) => c.id === 'does-not-exist')).toBe(false);
    expect(readCollectionFromDisk().pausedAt).toBeNull();
  });

  it('enforces write order: cards.json is committed before pausedAt is cleared', async () => {
    // Wrap the two persistence methods to observe on-disk state at the instant
    // each is invoked. When saveCollection runs, cards.json must already hold
    // the shifted due, and collection.json must still show the pause.
    const events: string[] = [];
    const realSaveCards = store.saveCards.bind(store);
    const realSaveCollection = store.saveCollection.bind(store);
    let cardsOnDiskWhenCollectionSaved: Card[] | null = null;
    let collectionOnDiskWhenCollectionSaved: Collection | null = null;

    store.saveCards = async () => {
      await realSaveCards();
      events.push('cards');
    };
    store.saveCollection = async () => {
      // Observe disk BEFORE the collection write commits.
      cardsOnDiskWhenCollectionSaved = readCardsFromDisk();
      collectionOnDiskWhenCollectionSaved = readCollectionFromDisk();
      events.push('collection');
      await realSaveCollection();
    };

    const res = await api('/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: PAUSED_AT,
        cardUpdates: [{ id: 'c1', due: 130 }],
      }),
    });
    expect(((await res.json()) as { applied: boolean }).applied).toBe(true);

    // Cards persisted strictly before the collection write began.
    expect(events).toEqual(['cards', 'collection']);
    expect(cardsOnDiskWhenCollectionSaved!.find((c) => c.id === 'c1')!.due).toBe(130);
    // Pause was still set on disk at that instant (cleared only by this write).
    expect(collectionOnDiskWhenCollectionSaved!.pausedAt).toBe(PAUSED_AT);
  });
});
