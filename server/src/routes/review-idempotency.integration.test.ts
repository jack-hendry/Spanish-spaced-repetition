// Integration coverage for review idempotency: an identical POST /api/review
// body sent twice appends exactly one revlog line. Step 1's unit test proves
// the store method; this proves the property a client actually depends on,
// end to end. Runs the real Express router over a FileStore in a temp dir.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import cors from 'cors';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Card, Note } from '../models/index.js';
import { FileStore } from '../store/file-store.js';
import { NOTE_TYPE_IDS } from '../store/seed.js';
import { buildRouter } from './index.js';

let dir: string;
let store: FileStore;
let server: ReturnType<express.Express['listen']>;
let base: string;

async function api(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'srs-review-'));
  store = new FileStore(dir, { debounceMs: 0 });
  await store.init();

  // Seed a deck
  const deck = {
    id: 'd1',
    name: 'Test',
    parentId: null,
    optionsId: 'opts-default',
    collapsed: false,
  };
  store.getDecks().push(deck);
  await store.saveDecks();

  // Seed a note and card for testing /review
  const note: Note = {
    id: 'n1',
    noteTypeId: NOTE_TYPE_IDS.cloze,
    fields: { Text: 'The {{c1::answer}}' },
    tags: [],
    created: Date.now(),
    modified: Date.now(),
    guid: 'n1',
  };
  store.getNotes().push(note);
  await store.saveNotes();

  // Create a card for the seeded note
  const card: Card = {
    id: 'c1-0',
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
    created: Date.now(),
    modified: Date.now(),
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
  };
  store.getCards().push(card);
  await store.saveCards();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', buildRouter(store));
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await store.flushAll();
  await new Promise<void>((r) =>
    server.close(() => {
      r();
    }),
  );
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /review idempotency', () => {
  it('replay appends once', async () => {
    const revlogId = `rev-1-${Date.now()}`;
    const body = {
      card: {
        id: 'c1-0',
        noteId: 'n1',
        deckId: 'd1',
        ord: 0,
        type: 'review',
        queue: 'review',
        due: 5,
        reps: 1,
        lapses: 0,
        left: 0,
        lastReviewed: Date.now(),
        created: Date.now() - 86400000,
        modified: Date.now(),
        ease: 2600,
        interval: 5,
        stability: null,
        difficulty: null,
      },
      revlog: {
        id: revlogId,
        cardId: 'c1-0',
        reviewedAt: Date.now(),
        button: 3,
        type: 'review',
        interval: 5,
        lastInterval: 0,
        factorOrStability: 2600,
        timeMs: 5000,
      },
    };

    // POST twice with the same revlog.id
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);

    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(200);

    // Assert the revlog has exactly one entry for this id
    const revlog = await store.readRevlog();
    const matching = revlog.filter((e) => e.id === revlogId);
    expect(matching).toHaveLength(1);
  });

  it('card write still applies on the replay', async () => {
    const revlogId = `rev-2-${Date.now()}`;
    const card = {
      id: 'c1-0',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'review',
      queue: 'review',
      due: 5,
      reps: 1,
      lapses: 0,
      left: 0,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2600,
      interval: 5,
      stability: null,
      difficulty: null,
    };

    // First POST with interval: 5
    const body1 = {
      card,
      revlog: {
        id: revlogId,
        cardId: 'c1-0',
        reviewedAt: Date.now(),
        button: 3,
        type: 'review',
        interval: 5,
        lastInterval: 0,
        factorOrStability: 2600,
        timeMs: 5000,
      },
    };

    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body1),
    });
    expect(res1.status).toBe(200);

    // Second POST with same id but interval: 9 (demonstrates last-write-wins for card)
    const body2 = {
      card: { ...card, interval: 9 },
      revlog: {
        id: revlogId,
        cardId: 'c1-0',
        usn: 0,
        timestamp: Date.now(),
        type: 1,
        rating: 3,
        ease: 2600,
        interval: 9,
        lastInterval: 0,
        factor: 2600,
        timeTaken: 5000,
        suspended: false,
      },
    };

    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body2),
    });
    expect(res2.status).toBe(200);
    const updatedCard = (await res2.json()) as Card;
    expect(updatedCard.interval).toBe(9);

    // Assert the revlog still has exactly one entry for this id
    const revlog = await store.readRevlog();
    const matching = revlog.filter((e) => e.id === revlogId);
    expect(matching).toHaveLength(1);
  });

  it('distinct ids both land', async () => {
    const revlogId1 = `rev-3a-${Date.now()}`;
    const revlogId2 = `rev-3b-${Date.now()}`;

    const card = {
      id: 'c1-0',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'review',
      queue: 'review',
      due: 5,
      reps: 1,
      lapses: 0,
      left: 0,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2600,
      interval: 5,
      stability: null,
      difficulty: null,
    };

    // First POST with revlogId1
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId1,
          cardId: 'c1-0',
          usn: 0,
          timestamp: Date.now(),
          type: 1,
          rating: 3,
          ease: 2600,
          interval: 5,
          lastInterval: 0,
          factor: 2600,
          timeTaken: 5000,
          suspended: false,
        },
      }),
    });
    expect(res1.status).toBe(200);

    // Second POST with revlogId2
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId2,
          cardId: 'c1-0',
          usn: 0,
          timestamp: Date.now(),
          type: 1,
          rating: 3,
          ease: 2600,
          interval: 5,
          lastInterval: 0,
          factor: 2600,
          timeTaken: 5000,
          suspended: false,
        },
      }),
    });
    expect(res2.status).toBe(200);

    // Assert the revlog has one entry for each id
    const revlog = await store.readRevlog();
    const matching1 = revlog.filter((e) => e.id === revlogId1);
    const matching2 = revlog.filter((e) => e.id === revlogId2);
    expect(matching1).toHaveLength(1);
    expect(matching2).toHaveLength(1);
  });
});
