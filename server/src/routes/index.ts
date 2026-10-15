// REST API over the canonical collection. The Angular SPA reads the bundle +
// cards/notes, computes scheduling client-side, and persists results here.

import { Router } from 'express';

import type {
  Card,
  Collection,
  CollectionBundle,
  Deck,
  DeckOptions,
  Note,
  RevlogEntry,
} from '../models/index.js';
import type { FileStore } from '../store/file-store.js';
import { dataDir, sourceDir } from '../paths.js';
import { reconcileNoteCards } from '../cards/generate.js';

/** Next free position in the "new" queue (new-card due is a position). */
function nextNewPosition(cards: Card[]): number {
  let max = -1;
  for (const c of cards) if (c.queue === 'new' && c.due > max) max = c.due;
  return max + 1;
}

export function buildRouter(store: FileStore, opts: { allowImport?: boolean } = {}): Router {
  const r = Router();

  // ---- collection bundle ---------------------------------------------------
  r.get('/collection', (_req, res) => {
    const bundle: CollectionBundle = {
      collection: store.getCollection(),
      notetypes: store.getNoteTypes(),
      decks: store.getDecks(),
      deckoptions: store.getDeckOptions(),
    };
    res.json(bundle);
  });

  r.patch('/collection', async (req, res) => {
    const patch = req.body as Partial<Collection>;
    const coll = store.getCollection();
    Object.assign(coll, patch, { schemaVersion: coll.schemaVersion });
    await store.saveCollection();
    res.json(coll);
  });

  // Resume scheduling: apply the client-computed absolute `due` targets, then
  // clear the global pause. The server performs NO date arithmetic — it writes
  // exactly the `due` values it is handed. The write order is mandatory and
  // non-negotiable: (a) cards to disk (awaited), THEN (b) clear pausedAt and
  // persist the collection. A crash between (a) and (b) leaves cards shifted
  // with pausedAt still set, so recovery re-sends the identical absolute
  // payload and converges (no double-shift). `expectedPausedAt` guards against
  // a stale payload applying to a later, unrelated pause episode.
  r.post('/collection/resume', async (req, res) => {
    const { expectedPausedAt, cardUpdates } = req.body as {
      expectedPausedAt: number;
      cardUpdates?: { id: string; due: number }[];
    };
    const coll = store.getCollection();

    // No-op guard (R11b): the pause episode we were computed against is no
    // longer the live one (already resumed, or never paused). Return success
    // without touching cards or the collection.
    if (coll.pausedAt == null || coll.pausedAt !== expectedPausedAt) {
      return res.json({ applied: false });
    }

    // (a) Apply absolute `due` by id, leaving every other card field untouched;
    // silently skip unknown ids. Then persist cards to disk, awaited.
    const cards = store.getCards();
    const indexById = new Map(cards.map((c, i) => [c.id, i]));
    for (const update of cardUpdates ?? []) {
      const idx = indexById.get(update.id);
      if (idx === undefined) continue;
      cards[idx].due = update.due;
    }
    await store.saveCards();

    // (b) Only after the card write has fully committed: clear the pause and
    // persist the collection.
    coll.pausedAt = null;
    await store.saveCollection();

    res.json({ applied: true });
  });

  // ---- cards ---------------------------------------------------------------
  r.get('/cards', (req, res) => {
    const deckId = req.query.deckId as string | undefined;
    const cards = store.getCards();
    // `!= null` alone is not equivalent here: `?deckId=` yields `''`, which the
    // truthy test sent down the "all cards" branch. No card has an empty
    // deckId, so dropping the `!== ''` would return [] instead.
    res.json(deckId != null && deckId !== '' ? cards.filter((c) => c.deckId === deckId) : cards);
  });

  r.patch('/cards/:id', (req, res) => {
    const cards = store.getCards();
    const idx = cards.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'card not found' });
    const patch = req.body as Partial<Card>;
    cards[idx] = { ...cards[idx], ...patch, id: cards[idx].id, modified: Date.now() };
    store.saveCardsSoon();
    res.json(cards[idx]);
  });

  r.get('/revlog', async (_req, res) => {
    res.json(await store.readRevlog());
  });

  // Convenience for the review loop: persist the updated card and append its
  // revlog entry in one round-trip.
  r.post('/review', async (req, res) => {
    const { card, revlog, expectedRev } = req.body as {
      card: Card;
      revlog?: RevlogEntry;
      expectedRev?: string | null;
    };
    const cards = store.getCards();
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx === -1) return res.status(404).json({ error: 'card not found' });

    // D5: a replay of an already-applied review must NOT re-write the card.
    // The response that never arrived is what makes the client retry, and
    // re-applying its card state would clobber a newer review from another
    // device. Return the stored card so the contract is unchanged.
    if (revlog && store.hasRevlogId(revlog.id)) {
      return res.json(cards[idx]);
    }

    // D4/D3: equality-only precondition. `undefined` is a wildcard for ops
    // queued by a pre-024 client; an explicit `null` asserts "no rev yet".
    if (expectedRev !== undefined) {
      const storedRev = cards[idx].rev ?? null;
      if (storedRev !== expectedRev) {
        return res.status(409).json({ error: 'stale card', card: cards[idx] });
      }
    }

    cards[idx] = { ...card, modified: Date.now(), rev: revlog?.id ?? cards[idx].rev };
    store.saveCardsSoon();
    if (revlog) await store.appendRevlog(revlog);
    res.json(cards[idx]);
  });

  // ---- notes ---------------------------------------------------------------
  r.get('/notes', (_req, res) => res.json(store.getNotes()));

  r.get('/notes/:id', (req, res) => {
    const note = store.getNotes().find((n) => n.id === req.params.id);
    if (!note) return res.status(404).json({ error: 'note not found' });
    res.json(note);
  });

  // Create a note and generate its cards. The deck for the new cards is taken
  // from a `deckId` field on the body (falling back to the first deck).
  r.post('/notes', async (req, res) => {
    const { deckId, ...note } = req.body as Note & { deckId?: string };
    const noteType = store.getNoteTypes().find((nt) => nt.id === note.noteTypeId);
    if (!noteType) return res.status(400).json({ error: 'unknown note type' });
    const deck = deckId ?? store.getDecks()[0]?.id;
    if (!deck) return res.status(400).json({ error: 'no deck available' });

    store.getNotes().push(note);
    const cards = store.getCards();
    const { cards: built } = reconcileNoteCards(
      note,
      noteType,
      [],
      deck,
      nextNewPosition(cards),
      Date.now(),
    );
    cards.push(...built);

    await store.saveNotes();
    store.saveCardsSoon();
    res.status(201).json({ note, cards: built });
  });

  // Edit a note and reconcile its cards: surviving ords keep their scheduling,
  // newly required ords get fresh cards, and ords that disappear are removed.
  r.patch('/notes/:id', async (req, res) => {
    const notes = store.getNotes();
    const idx = notes.findIndex((n) => n.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'note not found' });

    const { deckId, ...patch } = req.body as Partial<Note> & { deckId?: string };
    const updated: Note = { ...notes[idx], ...patch, id: notes[idx].id, modified: Date.now() };
    notes[idx] = updated;

    const noteType = store.getNoteTypes().find((nt) => nt.id === updated.noteTypeId);
    let built: Card[] = [];
    let removedIds: string[] = [];
    if (noteType) {
      const cards = store.getCards();
      const existing = cards.filter((c) => c.noteId === updated.id);
      // `.at(0)` rather than `[0]`: without `noUncheckedIndexedAccess` an array
      // index types as non-optional, so the `??` fallbacks read as dead code.
      // They are live — `existing` is empty for a note's first card and
      // `getDecks()` is empty on a fresh store.
      const deck = deckId ?? existing.at(0)?.deckId ?? store.getDecks().at(0)?.id ?? '';
      ({ cards: built, removedIds } = reconcileNoteCards(
        updated,
        noteType,
        existing,
        deck,
        nextNewPosition(cards),
        Date.now(),
      ));
      // Replace this note's cards in place with the reconciled set.
      for (let i = cards.length - 1; i >= 0; i--) {
        if (cards[i].noteId === updated.id) cards.splice(i, 1);
      }
      cards.push(...built);
      store.saveCardsSoon();
    }

    await store.saveNotes();
    res.json({ note: updated, cards: built, removedIds });
  });

  // ---- decks ---------------------------------------------------------------
  r.patch('/decks/:id', async (req, res) => {
    const decks = store.getDecks();
    const idx = decks.findIndex((d) => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'deck not found' });
    decks[idx] = { ...decks[idx], ...(req.body as Partial<Deck>), id: decks[idx].id };
    await store.saveDecks();
    res.json(decks[idx]);
  });

  // ---- deck options --------------------------------------------------------
  r.patch('/deckoptions/:id', async (req, res) => {
    const opts = store.getDeckOptions();
    const idx = opts.findIndex((o) => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'options not found' });
    opts[idx] = { ...opts[idx], ...(req.body as Partial<DeckOptions>), id: opts[idx].id };
    await store.saveDeckOptions();
    res.json(opts[idx]);
  });

  // ---- import --------------------------------------------------------------
  // Whole-store rewrite from _source/. Desktop-only, opt-in.
  if (opts.allowImport === true) {
    // Runs the scraped-tree -> canonical transform over data/spanish/_source.
    r.post('/import', async (_req, res) => {
      const { runImport } = await import('../import/run.js');
      const result = await runImport(store, sourceDir());
      res.json({
        source: sourceDir(),
        target: dataDir(),
        decks: result.decks.length,
        notes: result.notes.length,
        cards: result.cards.length,
      });
    });
  }

  return r;
}
