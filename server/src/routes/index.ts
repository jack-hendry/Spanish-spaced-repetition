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

export function buildRouter(store: FileStore): Router {
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

  // ---- cards ---------------------------------------------------------------
  r.get('/cards', (req, res) => {
    const deckId = req.query.deckId as string | undefined;
    const cards = store.getCards();
    res.json(deckId ? cards.filter((c) => c.deckId === deckId) : cards);
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
    const { card, revlog } = req.body as { card: Card; revlog: RevlogEntry };
    const cards = store.getCards();
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx === -1) return res.status(404).json({ error: 'card not found' });
    cards[idx] = { ...card, modified: Date.now() };
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
      const deck = deckId ?? existing[0]?.deckId ?? store.getDecks()[0]?.id ?? '';
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

  return r;
}
