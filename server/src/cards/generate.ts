// Card generation: given a note and its note type, determine which cards should
// exist and reconcile that against the cards already on disk.
//
//   - standard note types: one card per template (ords 0..n-1)
//   - cloze note types:     one card per distinct cloze number N, at ord N-1
//
// Scheduling math lives in the frontend; this module only owns card *structure*
// (which cards exist), which the server must own because it persists cards.json.
// Reconciliation preserves the scheduling state of surviving cards, creates
// cards for newly added ords, and reports cards whose ord disappeared.

import type { Card, Note, NoteType } from '../models/index.js';

const CLOZE_RE = /\{\{c(\d+)::.*?\}\}/gs;

/** Distinct cloze numbers across all of a note's fields, ascending. */
function clozeNumbers(note: Note): number[] {
  const seen = new Set<number>();
  for (const value of Object.values(note.fields)) {
    for (const m of value.matchAll(CLOZE_RE)) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b);
}

/** The card ordinals a note should have, given its note type. */
export function desiredOrds(note: Note, noteType: NoteType): number[] {
  if (noteType.kind === 'cloze') {
    const nums = clozeNumbers(note);
    // Cloze number N maps to card ord N-1. Guarantee at least one card so a
    // note with no (yet) valid deletion still has something to study/fix.
    return nums.length ? nums.map((n) => n - 1) : [0];
  }
  return noteType.templates.map((t) => t.ord);
}

/** A fresh, unseen card in the "new" queue. */
export function buildNewCard(
  note: Note,
  ord: number,
  deckId: string,
  due: number,
  now: number,
): Card {
  return {
    id: `c${note.guid || note.id}-${ord}`,
    noteId: note.id,
    deckId,
    ord,
    type: 'new',
    queue: 'new',
    due,
    reps: 0,
    lapses: 0,
    left: 0,
    lastReviewed: null,
    created: now,
    modified: now,
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
  };
}

export interface ReconcileResult {
  /** The full set of cards the note should have (kept + created), by ord. */
  cards: Card[];
  /** Ids of cards that should be deleted (ord no longer present). */
  removedIds: string[];
}

/**
 * Reconcile a note's existing cards against what its note type now requires.
 * `deckId` is the deck for newly created cards; `basePosition` is the next free
 * "new" queue position (created cards get basePosition, +1, …).
 */
export function reconcileNoteCards(
  note: Note,
  noteType: NoteType,
  existing: Card[],
  deckId: string,
  basePosition: number,
  now: number,
): ReconcileResult {
  const want = desiredOrds(note, noteType);
  const wantSet = new Set(want);
  const byOrd = new Map(existing.map((c) => [c.ord, c]));
  const templateByOrd = new Map(noteType.templates.map((t) => [t.ord, t]));

  const removedIds = existing.filter((c) => !wantSet.has(c.ord)).map((c) => c.id);

  let position = basePosition;
  const cards = want
    .map((ord) => {
      // A template can pin its cards to a fixed deck (e.g. Listening),
      // overriding the note's own deck. Re-applied on every reconcile so a
      // card that drifted to the wrong deck self-heals.
      const effectiveDeckId = templateByOrd.get(ord)?.deckId ?? deckId;
      const prior = byOrd.get(ord);
      if (prior) {
        return { ...prior, noteId: note.id, deckId: effectiveDeckId, modified: now };
      }
      return buildNewCard(note, ord, effectiveDeckId, position++, now);
    })
    .sort((a, b) => a.ord - b.ord);

  return { cards, removedIds };
}
