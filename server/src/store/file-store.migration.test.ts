// Integration coverage for FileStore.init's startup migration wiring: a
// pre-existing (legacy) store with a one-template `nt-spanish-2sided` note
// type gains the Listening template + ord-1 cards on init, existing ord-0
// scheduling is untouched, and a second init is a no-op.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Deck, Note, NoteType } from '../models/index.js';
import { FileStore } from './file-store.js';
import { LISTENING_DECK_ID } from './seed.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'srs-filestore-migration-'));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A one-template `nt-spanish-2sided` note type as it exists in a legacy store. */
function oneTemplateNoteType(): NoteType {
  return {
    id: 'nt-spanish-2sided',
    name: 'Spanish 2-sided',
    kind: 'standard',
    fields: [
      { name: 'SideA', ord: 0 },
      { name: 'SideAAudio', ord: 1 },
      { name: 'SideAImage', ord: 2 },
      { name: 'SideB', ord: 3 },
      { name: 'SideBAudio', ord: 4 },
      { name: 'SideBImage', ord: 5 },
    ],
    templates: [
      {
        name: 'A → B',
        ord: 0,
        qfmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}',
        afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
      },
    ],
    css: '',
  };
}

function note(id: string): Note {
  return {
    id,
    noteTypeId: 'nt-spanish-2sided',
    fields: {
      SideA: 'hola',
      SideAAudio: '[sound:a.mp3]',
      SideB: 'hello',
      SideBAudio: '[sound:b.mp3]',
    },
    tags: [],
    created: 0,
    modified: 0,
    guid: id,
  };
}

/** An ord-0 card in the `review` queue with distinctive scheduling state. */
function reviewCard(noteId: string, deckId: string): Card {
  return {
    id: `c${noteId}-0`,
    noteId,
    deckId,
    ord: 0,
    type: 'review',
    queue: 'review',
    due: 42,
    reps: 7,
    lapses: 2,
    left: 0,
    lastReviewed: 1_699_913_600_000,
    created: 1000,
    modified: 2000,
    ease: 2650,
    interval: 21,
    stability: 12.5,
    difficulty: 5.4,
  };
}

function seedLegacyStore(dataDir: string): { note: Note; card: Card } {
  const noteType = oneTemplateNoteType();
  const n = note('n1');
  const deck: Deck = {
    id: 'deck-a',
    name: 'Test',
    parentId: null,
    optionsId: 'opts-default',
    collapsed: false,
  };
  const card = reviewCard('n1', 'deck-a');

  writeFileSync(join(dataDir, 'notetypes.json'), JSON.stringify([noteType], null, 2), 'utf8');
  writeFileSync(join(dataDir, 'notes.json'), JSON.stringify([n], null, 2), 'utf8');
  writeFileSync(join(dataDir, 'cards.json'), JSON.stringify([card], null, 2), 'utf8');
  writeFileSync(join(dataDir, 'decks.json'), JSON.stringify([deck], null, 2), 'utf8');

  return { note: n, card };
}

describe('FileStore.init startup migration', () => {
  it('adds the Listening template and an ord-1 new card, preserving ord-0 scheduling', async () => {
    const { card: before } = seedLegacyStore(dir);

    const store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    const noteType = store.getNoteTypes().find((nt) => nt.id === 'nt-spanish-2sided')!;
    expect(noteType.templates).toHaveLength(2);
    expect(noteType.templates.map((t) => t.ord).sort()).toEqual([0, 1]);
    expect(noteType.templates.find((t) => t.ord === 1)?.name).toBe('Listening');

    // The dedicated Listening deck now exists.
    const listeningDeck = store.getDecks().find((d) => d.id === LISTENING_DECK_ID);
    expect(listeningDeck?.name).toBe('Listening');

    const cards = store.getCards();
    const ord1 = cards.find((c) => c.noteId === 'n1' && c.ord === 1);
    expect(ord1).toBeDefined();
    expect(ord1!.type).toBe('new');
    expect(ord1!.queue).toBe('new');
    // Listening cards live in the dedicated deck, not the note's own deck.
    expect(ord1!.deckId).toBe(LISTENING_DECK_ID);
    // The ord-0 card stays in the note's own deck.
    const ord0Deck = cards.find((c) => c.noteId === 'n1' && c.ord === 0)!;
    expect(ord0Deck.deckId).toBe('deck-a');

    const ord0 = cards.find((c) => c.noteId === 'n1' && c.ord === 0)!;
    expect(ord0.ease).toBe(before.ease);
    expect(ord0.interval).toBe(before.interval);
    expect(ord0.due).toBe(before.due);
    expect(ord0.queue).toBe(before.queue);
    expect(ord0.type).toBe(before.type);

    // Persisted to disk too, not just in memory.
    const reopened = new FileStore(dir, { debounceMs: 0 });
    await reopened.init();
    const reopenedNoteType = reopened
      .getNoteTypes()
      .find((nt) => nt.id === 'nt-spanish-2sided')!;
    expect(reopenedNoteType.templates).toHaveLength(2);
  });

  it('is idempotent — a second init adds no cards', async () => {
    seedLegacyStore(dir);

    const first = new FileStore(dir, { debounceMs: 0 });
    await first.init();
    const cardCountAfterFirst = first.getCards().length;

    const second = new FileStore(dir, { debounceMs: 0 });
    await second.init();

    expect(second.getCards()).toHaveLength(cardCountAfterFirst);
    expect(second.getCards().filter((c) => c.ord === 1)).toHaveLength(1);
    const noteType = second.getNoteTypes().find((nt) => nt.id === 'nt-spanish-2sided')!;
    expect(noteType.templates).toHaveLength(2);
  });
});
