import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiService } from './api.service';
import { CollectionStore } from './collection.store';
import { PauseService } from './pause.service';
import type { Card, Collection } from './models';

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

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ord: 0,
    type: 'review',
    queue: 'review',
    due: 100,
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

function setup(): { store: CollectionStore; service: PauseService; api: ApiService } {
  const api = {
    patchCollection: vi.fn((patch: Partial<Collection>) => of({ ...collection(), ...patch })),
    resume: vi.fn(() => of({ applied: true })),
  } as unknown as ApiService;

  TestBed.configureTestingModule({
    providers: [{ provide: ApiService, useValue: api }],
  });
  const store = TestBed.inject(CollectionStore);
  const service = TestBed.inject(PauseService);
  return { store, service, api };
}

describe('PauseService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // T9
  it('pause() while already paused issues no patchCollection call', async () => {
    const { store, service, api } = setup();
    store.collection.set(collection({ pausedAt: 12_345 }));

    await service.pause();

    expect(api.patchCollection).not.toHaveBeenCalled();
    expect(store.collection()?.pausedAt).toBe(12_345);
  });

  it('pause() while running patches pausedAt and updates the store', async () => {
    const { store, service, api } = setup();
    store.collection.set(collection({ pausedAt: null }));

    await service.pause();

    expect(api.patchCollection).toHaveBeenCalledTimes(1);
    const patch = (api.patchCollection as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof patch.pausedAt).toBe('number');
    expect(store.collection()?.pausedAt).toBe(patch.pausedAt);
  });

  // T7a — recovery re-sends the saved payload verbatim, then clears the key.
  it('recoverOnLoad() re-sends the saved payload and clears the key', async () => {
    const { store, service, api } = setup();
    const pausedAt = 99_000;
    store.collection.set(collection({ pausedAt }));
    store.cards.set([card({ id: 'c1', due: 130 })]);

    const saved = {
      expectedPausedAt: pausedAt,
      cardUpdates: [{ id: 'c1', due: 130 }],
    };
    const key = 'resume-pending:' + pausedAt;
    localStorage.setItem(key, JSON.stringify(saved));

    await service.recoverOnLoad();

    expect(api.resume).toHaveBeenCalledTimes(1);
    expect((api.resume as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(saved);
    expect(store.collection()?.pausedAt).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  // T7a — no saved payload → stay paused, no resume issued.
  it('recoverOnLoad() with no saved payload issues no resume', async () => {
    const { store, service, api } = setup();
    store.collection.set(collection({ pausedAt: 99_000 }));

    await service.recoverOnLoad();

    expect(api.resume).not.toHaveBeenCalled();
    expect(store.collection()?.pausedAt).toBe(99_000);
  });

  it('recoverOnLoad() ignores a stale key from a different pause episode', async () => {
    const { store, service, api } = setup();
    store.collection.set(collection({ pausedAt: 99_000 }));
    // Snapshot belongs to an earlier episode.
    localStorage.setItem(
      'resume-pending:11111',
      JSON.stringify({ expectedPausedAt: 11_111, cardUpdates: [] }),
    );

    await service.recoverOnLoad();

    expect(api.resume).not.toHaveBeenCalled();
    expect(store.collection()?.pausedAt).toBe(99_000);
    expect(localStorage.getItem('resume-pending:11111')).not.toBeNull();
  });

  it('resume() snapshots, POSTs, clears pause + key, and shifts cached cards', async () => {
    const { store, service, api } = setup();
    const pausedAt = 50_000;
    store.collection.set(collection({ created: 0, dayCutoffHour: 4, pausedAt }));
    // A review card; dayDelta from pause->now must be > 0 for it to be shifted.
    store.cards.set([card({ id: 'c1', type: 'review', queue: 'review', due: 100 })]);

    await service.resume();

    expect(api.resume).toHaveBeenCalledTimes(1);
    expect(store.collection()?.pausedAt).toBeNull();
    expect(localStorage.getItem('resume-pending:' + pausedAt)).toBeNull();

    const sent = (api.resume as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.expectedPausedAt).toBe(pausedAt);
    // Cached card reflects the shifted `due` the payload carried.
    const shifted = sent.cardUpdates.find((u: { id: string }) => u.id === 'c1');
    expect(store.cards().find((c) => c.id === 'c1')?.due).toBe(shifted.due);
  });
});
