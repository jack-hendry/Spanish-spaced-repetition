// Startup migrations: pure, idempotent transforms over the in-memory store.
//
// notetypes.json is only seeded when absent (FileStore.init), so existing
// installs keep their original note-type definitions forever. When we ship a
// new built-in template we must reach those live stores with a migration that
// (a) appends the missing template and (b) reconciles every affected note's
// cards so each gains a fresh "new" card for the new ord — without disturbing
// the scheduling state of surviving cards.

import type { Card, Deck, Note, NoteType } from '../models/index.js';
import { reconcileNoteCards } from '../cards/generate.js';
import { LISTENING_DECK_ID, LISTENING_TEMPLATE, buildListeningDeck } from './seed.js';

const SPANISH_2SIDED_ID = 'nt-spanish-2sided';

interface MigratableData {
  notetypes: NoteType[];
  notes: Note[];
  cards: Card[];
  decks: Deck[];
}

export interface MigrationResult {
  changedNoteTypes: boolean;
  changedCards: boolean;
  changedDecks: boolean;
}

/**
 * Next free position in the "new" queue. Mirrors `nextNewPosition` in
 * routes/index.ts (kept local — the migration must not depend on the route
 * module). New-card `due` is a queue position, so the next free slot is one
 * past the current maximum.
 */
function nextNewPosition(cards: Card[]): number {
  let max = -1;
  for (const c of cards) if (c.queue === 'new' && c.due > max) max = c.due;
  return max + 1;
}

/**
 * Add the Listening template to `nt-spanish-2sided` and give every note of that
 * type its ord-1 Listening card, if missing. Mutates the given arrays in place.
 *
 * Idempotent: notes that already have an ord-1 card are skipped and the note
 * type is only extended when ord 1 is absent, so a second call is a no-op and
 * returns `{ changedNoteTypes: false, changedCards: false }`. Surviving ord-0
 * cards keep all scheduling fields (reconcile only re-stamps `modified`).
 */
export function migrateAddListeningTemplate(
  data: MigratableData,
  now: number,
): MigrationResult {
  const result: MigrationResult = {
    changedNoteTypes: false,
    changedCards: false,
    changedDecks: false,
  };

  const noteType = data.notetypes.find((nt) => nt.id === SPANISH_2SIDED_ID);
  if (!noteType) return result;

  if (!noteType.templates.some((t) => t.ord === 1)) {
    noteType.templates.push(structuredClone(LISTENING_TEMPLATE));
    result.changedNoteTypes = true;
  }

  if (!data.decks.some((d) => d.id === LISTENING_DECK_ID)) {
    data.decks.push(buildListeningDeck());
    result.changedDecks = true;
  }

  // Corrective step: relocate any ord-1 Listening cards that were already
  // created in the note's own deck (before the dedicated-deck decision) into
  // the Listening deck. Only deckId/modified change; all scheduling fields
  // are preserved untouched.
  const spanishNoteIds = new Set(
    data.notes.filter((n) => n.noteTypeId === SPANISH_2SIDED_ID).map((n) => n.id),
  );
  for (const card of data.cards) {
    if (card.ord === 1 && spanishNoteIds.has(card.noteId) && card.deckId !== LISTENING_DECK_ID) {
      card.deckId = LISTENING_DECK_ID;
      card.modified = now;
      result.changedCards = true;
    }
  }

  let basePosition = nextNewPosition(data.cards);

  for (const note of data.notes) {
    if (note.noteTypeId !== SPANISH_2SIDED_ID) continue;

    const existingForNote = data.cards.filter((c) => c.noteId === note.id);
    if (existingForNote.some((c) => c.ord === 1)) continue;

    const deckId = existingForNote[0]?.deckId;
    if (!deckId) continue;

    const { cards: reconciled } = reconcileNoteCards(
      note,
      noteType,
      existingForNote,
      deckId,
      basePosition,
      now,
    );

    // Advance past any newly created "new" cards so subsequent notes don't
    // collide on queue position.
    const createdNew = reconciled.filter(
      (c) => !existingForNote.some((e) => e.id === c.id),
    );
    basePosition += createdNew.length;

    // Replace this note's cards in place: drop the old set, append the
    // reconciled set (kept + created).
    const keepIds = new Set(existingForNote.map((c) => c.id));
    for (let i = data.cards.length - 1; i >= 0; i--) {
      if (keepIds.has(data.cards[i].id)) data.cards.splice(i, 1);
    }
    data.cards.push(...reconciled);
    result.changedCards = true;
  }

  return result;
}
