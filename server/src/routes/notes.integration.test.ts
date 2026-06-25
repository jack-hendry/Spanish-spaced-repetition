// Integration coverage for the note routes: creating a note generates its
// cards, and editing a note reconciles them (preserving scheduling, removing
// orphans). Runs the real Express router over a FileStore in a temp dir.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import cors from 'cors';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Card, Deck, Note } from '../models/index.js';
import { FileStore } from '../store/file-store.js';
import { NOTE_TYPE_IDS } from '../store/seed.js';
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'srs-routes-'));
  store = new FileStore(dir, { debounceMs: 0 });
  await store.init();

  const deck: Deck = {
    id: 'd1',
    name: 'Test',
    parentId: null,
    optionsId: 'opts-default',
    collapsed: false,
  };
  store.getDecks().push(deck);
  await store.saveDecks();

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
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

function note(id: string, noteTypeId: string, fields: Record<string, string>): Note {
  const now = Date.now();
  return { id, noteTypeId, fields, tags: [], created: now, modified: now, guid: id };
}

describe('POST /notes', () => {
  it('generates two cards for a Basic (and reversed) note', async () => {
    const res = await api('/notes', {
      method: 'POST',
      body: JSON.stringify({
        ...note('n-rev', NOTE_TYPE_IDS.basicReversed, { Front: 'dog', Back: 'perro' }),
        deckId: 'd1',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { cards: Card[] };
    expect(body.cards.map((c) => c.ord)).toEqual([0, 1]);
    expect(body.cards.every((c) => c.deckId === 'd1' && c.queue === 'new')).toBe(true);
  });

  it('generates one card per distinct cloze deletion', async () => {
    const res = await api('/notes', {
      method: 'POST',
      body: JSON.stringify({
        ...note('n-cz', NOTE_TYPE_IDS.cloze, { Text: 'El {{c1::gato}} y el {{c2::perro}}' }),
        deckId: 'd1',
      }),
    });
    const body = (await res.json()) as { cards: Card[] };
    expect(body.cards.map((c) => c.ord)).toEqual([0, 1]);
  });
});

describe('PATCH /notes/:id', () => {
  it('adds a card when a deletion is added and preserves the survivor', async () => {
    // Mark the cloze note's first card as reviewed.
    const cards = store.getCards();
    const c0 = cards.find((c) => c.noteId === 'n-cz' && c.ord === 0)!;
    c0.type = 'review';
    c0.queue = 'review';
    c0.reps = 3;
    c0.interval = 12;

    const res = await api('/notes/n-cz', {
      method: 'PATCH',
      body: JSON.stringify({
        fields: { Text: 'El {{c1::gato}}, el {{c2::perro}} y el {{c3::pez}}' },
      }),
    });
    const body = (await res.json()) as { cards: Card[]; removedIds: string[] };
    expect(body.cards.map((c) => c.ord)).toEqual([0, 1, 2]);
    const kept = body.cards.find((c) => c.ord === 0)!;
    expect(kept.reps).toBe(3);
    expect(kept.interval).toBe(12);
    expect(kept.type).toBe('review');
    expect(body.removedIds).toEqual([]);
  });

  it('removes a card when a deletion disappears', async () => {
    const res = await api('/notes/n-cz', {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Text: 'El {{c1::gato}}' } }),
    });
    const body = (await res.json()) as { cards: Card[]; removedIds: string[] };
    expect(body.cards.map((c) => c.ord)).toEqual([0]);
    expect(body.removedIds.length).toBe(2);
    // The store no longer holds the dropped cards.
    const remaining = store.getCards().filter((c) => c.noteId === 'n-cz');
    expect(remaining.map((c) => c.ord)).toEqual([0]);
  });
});

describe('PATCH /collection', () => {
  it('persists the unbury checkpoint without clobbering schemaVersion', async () => {
    const before = store.getCollection().schemaVersion;
    const res = await api('/collection', {
      method: 'PATCH',
      body: JSON.stringify({ lastUnburyDay: 42, schemaVersion: 999 }),
    });
    const body = (await res.json()) as { lastUnburyDay: number; schemaVersion: number };
    expect(body.lastUnburyDay).toBe(42);
    expect(body.schemaVersion).toBe(before);
    expect(store.getCollection().lastUnburyDay).toBe(42);
  });
});
