// Integration coverage for spec 024 D5: a replay must NOT re-write the card,
// because re-applying would clobber a newer review from another device.
// Runs the real Express router over a FileStore in a temp dir.

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
  dir = mkdtempSync(join(tmpdir(), 'srs-staleness-'));
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

  // Create cards for the seeded note - multiple cards for independent test scenarios
  const cards: Card[] = [];
  for (let i = 0; i < 10; i++) {
    cards.push({
      id: `c1-${i}`,
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'new',
      queue: 'new',
      due: i,
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
    });
  }
  store.getCards().push(...cards);
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
  await new Promise<void>((r) =>
    server.close(() => {
      r();
    }),
  );
  await store.flushAll();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /review staleness (D5 replay deduplication)', () => {
  it('identical replay appends once and returns byte-identical card', async () => {
    const revlogId = `rev-stale-1-${Date.now()}`;
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

    // First POST
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    const card1 = (await res1.json()) as Card;

    // Second POST with identical body (replay)
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(200);
    const card2 = (await res2.json()) as Card;

    // Assert both responses contain byte-identical cards
    expect(JSON.stringify(card1)).toBe(JSON.stringify(card2));

    // Assert the revlog has exactly one entry for this id
    const revlog = await store.readRevlog();
    const matching = revlog.filter((e) => e.id === revlogId);
    expect(matching).toHaveLength(1);
  });

  it('replay with different card state does NOT overwrite stored card (clobber case)', async () => {
    const revlogId = `rev-stale-2-${Date.now()}`;
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
    const storedCard = (await res1.json()) as Card;
    expect(storedCard.interval).toBe(5);

    // Second POST with same revlogId but different card state (interval: 9)
    // This simulates a stale/late replay where another device already updated the card
    const body2 = {
      card: { ...card, interval: 9 },
      revlog: {
        id: revlogId,
        cardId: 'c1-0',
        reviewedAt: Date.now(),
        button: 3,
        type: 'review',
        interval: 9,
        lastInterval: 0,
        factorOrStability: 2700,
        timeMs: 5000,
      },
    };

    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify(body2),
    });
    expect(res2.status).toBe(200);
    const responseCard = (await res2.json()) as Card;

    // The stored card should still be at interval 5, not updated to 9
    // D5: a replay must NOT re-write the card
    expect(responseCard.interval).toBe(5);

    // Verify the actual stored card wasn't changed
    const finalCard = store.getCards().find((c) => c.id === 'c1-0');
    expect(finalCard?.interval).toBe(5);

    // Assert the revlog still has exactly one entry for this id
    const revlog = await store.readRevlog();
    const matching = revlog.filter((e) => e.id === revlogId);
    expect(matching).toHaveLength(1);
  });
});

describe('POST /review D4/D3 precondition (expectedRev equality check)', () => {
  it('stale expectedRev is rejected 409 with stored card unchanged', async () => {
    const revlogId1 = `rev-prec-1-${Date.now()}`;
    const card = {
      id: 'c1-1',
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

    // First POST to establish rev
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId1,
          cardId: 'c1-1',
          reviewedAt: Date.now(),
          button: 3,
          type: 'review',
          interval: 5,
          lastInterval: 0,
          factorOrStability: 2600,
          timeMs: 5000,
        },
      }),
    });
    expect(res1.status).toBe(200);
    const firstCard = (await res1.json()) as Card & { rev?: string };
    expect(firstCard.rev).toBe(revlogId1);

    // Second POST with stale expectedRev (e.g., null when card now has rev)
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card: { ...card, interval: 10 },
        revlog: {
          id: `rev-prec-2-${Date.now()}`,
          cardId: 'c1-1',
          reviewedAt: Date.now(),
          button: 3,
          type: 'review',
          interval: 10,
          lastInterval: 0,
          factorOrStability: 2700,
          timeMs: 6000,
        },
        expectedRev: null, // Card actually has rev, so this conflicts
      }),
    });
    expect(res2.status).toBe(409);
    const conflictResponse = (await res2.json()) as { error: string; card: Card };
    expect(conflictResponse.error).toBe('stale card');
    // Returned card should be current stored state
    expect(conflictResponse.card.interval).toBe(5);

    // Verify the stored card was NOT changed
    const finalCard = store.getCards().find((c) => c.id === 'c1-1');
    expect(finalCard?.interval).toBe(5);
  });

  it('matching expectedRev succeeds 200 with rev set to revlog.id', async () => {
    const revlogId = `rev-prec-match-${Date.now()}`;
    const card = {
      id: 'c1-2',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'learning',
      queue: 'learning',
      due: Date.now() + 60000,
      reps: 0,
      lapses: 0,
      left: 2,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2500,
      interval: 0,
      stability: null,
      difficulty: null,
    };

    // First successful POST (no expectedRev) establishes the rev
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId,
          cardId: 'c1-2',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
      }),
    });
    expect(res1.status).toBe(200);
    const postedCard = (await res1.json()) as Card & { rev?: string };
    expect(postedCard.rev).toBe(revlogId);

    // Second POST with matching expectedRev should succeed
    const newRevlogId = `rev-prec-match-2-${Date.now()}`;
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card: { ...card, due: Date.now() + 120000 },
        revlog: {
          id: newRevlogId,
          cardId: 'c1-2',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
        expectedRev: revlogId, // Matches stored rev
      }),
    });
    expect(res2.status).toBe(200);
    const updatedCard = (await res2.json()) as Card & { rev?: string };
    expect(updatedCard.rev).toBe(newRevlogId);
  });

  it('expectedRev null against virgin card (no rev) succeeds 200', async () => {
    // This test uses a fresh card that has never been reviewed and has no rev
    const revlogId = `rev-prec-virgin-${Date.now()}`;
    const card = {
      id: 'c1-3',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'learning',
      queue: 'learning',
      due: Date.now() + 60000,
      reps: 0,
      lapses: 0,
      left: 2,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2500,
      interval: 0,
      stability: null,
      difficulty: null,
    };

    // POST to a virgin card with expectedRev: null
    const res = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId,
          cardId: 'c1-3',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
        expectedRev: null,
      }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as Card & { rev?: string };
    expect(result.rev).toBe(revlogId);
  });

  it('expectedRev null against card with rev is rejected 409', async () => {
    const revlogId1 = `rev-prec-virgin-conflict-1-${Date.now()}`;
    const revlogId2 = `rev-prec-virgin-conflict-2-${Date.now()}`;
    const card = {
      id: 'c1-4',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'learning',
      queue: 'learning',
      due: Date.now() + 60000,
      reps: 0,
      lapses: 0,
      left: 2,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2500,
      interval: 0,
      stability: null,
      difficulty: null,
    };

    // First POST to establish rev
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId1,
          cardId: 'c1-4',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
      }),
    });
    expect(res1.status).toBe(200);
    await res1.json();

    // Second POST with expectedRev: null should fail (card now has rev)
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card: { ...card, interval: 1 },
        revlog: {
          id: revlogId2,
          cardId: 'c1-4',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
        expectedRev: null, // Card has rev, so this should fail
      }),
    });
    expect(res2.status).toBe(409);
    const conflictResponse = (await res2.json()) as { error: string; card: Card };
    expect(conflictResponse.error).toBe('stale card');
  });

  it('expectedRev omitted is wildcard and succeeds regardless of stored rev', async () => {
    const revlogId1 = `rev-prec-wildcard-1-${Date.now()}`;
    const revlogId2 = `rev-prec-wildcard-2-${Date.now()}`;
    const card = {
      id: 'c1-5',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'learning',
      queue: 'learning',
      due: Date.now() + 60000,
      reps: 0,
      lapses: 0,
      left: 2,
      lastReviewed: Date.now(),
      created: Date.now() - 86400000,
      modified: Date.now(),
      ease: 2500,
      interval: 0,
      stability: null,
      difficulty: null,
    };

    // First POST
    const res1 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card,
        revlog: {
          id: revlogId1,
          cardId: 'c1-5',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
      }),
    });
    expect(res1.status).toBe(200);
    await res1.json();

    // Second POST WITHOUT expectedRev (omitted, not set to null)
    // Should succeed regardless of stored rev (wildcard)
    const res2 = await api('/review', {
      method: 'POST',
      body: JSON.stringify({
        card: { ...card, interval: 1 },
        revlog: {
          id: revlogId2,
          cardId: 'c1-5',
          reviewedAt: Date.now(),
          button: 2,
          type: 'learning',
          interval: 0,
          lastInterval: 0,
          factorOrStability: 2500,
          timeMs: 3000,
        },
        // expectedRev omitted entirely
      }),
    });
    expect(res2.status).toBe(200);
    const result = (await res2.json()) as Card & { rev?: string };
    expect(result.rev).toBe(revlogId2);
  });
});
