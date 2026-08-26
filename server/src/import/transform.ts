// Transform scraped McGraw Hill "menu tree" book JSON into the canonical model.
//
// Scraped shape (per book file):
//   { Menu_ID, MenuTitle, language, children: [ ...nodes ] }
// where a node is { Menu_ID, MenuTitle, DeckType, children?, cards? } and a
// card is { Card_ID, SideA, SideB, SideAAudio, SideBAudio, SideAImage, ... }.
//
// Mapping:
//   - Each book's MenuTitle is the root deck. Nested non-card nodes become
//     subdecks joined by "::". A node that directly carries `cards` is collapsed
//     into its parent (its title — usually "Flashcards: Study Mode" — is dropped).
//   - Each scraped card -> one "Spanish 2-sided" note -> one generated card.
//   - Identity is derived deterministically from (bookSlug, Card_ID) so re-import
//     reconciles in place and preserves scheduling state on surviving cards.

import { createHash } from 'node:crypto';

import type { Card, Deck, Note, NoteType } from '../models/index.js';
import { LISTENING_DECK_ID, NOTE_TYPE_IDS, buildSeedNoteTypes } from '../store/seed.js';

/** Note types keyed by id, so a book can select one and we can read its templates. */
const NOTE_TYPES_BY_ID = new Map(buildSeedNoteTypes().map((nt) => [nt.id, nt]));

/** Map a book's optional `noteType` hint to a seeded note type id. */
function resolveNoteType(hint: string | undefined): NoteType {
  const id =
    hint === 'spanish2both' ? NOTE_TYPE_IDS.spanish2both : NOTE_TYPE_IDS.spanish2;
  return NOTE_TYPES_BY_ID.get(id)!;
}

export interface ScrapedCard {
  Card_ID: number;
  SideA: string | null;
  SideB: string | null;
  SideAAudio: string | null;
  SideBAudio: string | null;
  SideAImage: string | null;
  SideBImage: string | null;
  [k: string]: unknown;
}

export interface ScrapedNode {
  Menu_ID: number;
  MenuTitle: string;
  DeckType?: string;
  children?: ScrapedNode[];
  cards?: ScrapedCard[];
}

export interface ScrapedBook extends ScrapedNode {
  language?: string;
  /** Optional note-type hint; "spanish2both" generates both study directions. */
  noteType?: string;
}

export interface SourceBook {
  slug: string; // file basename without extension
  root: ScrapedBook;
}

export interface ExistingState {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
}

export interface ImportResult {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
}

function hash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

const DECK_SEP = '::';

const IMAGE_RE = /\.(jpe?g|png|gif|webp|svg)$/i;

/** A value is usable media only if it's a clean http(s) URL (no junk text). */
function isUrl(v: string | null | undefined): v is string {
  return !!v && /^https?:\/\/\S+$/.test(v) && !/\s/.test(v);
}

/** A site-relative media path served by the app (e.g. "/media/foo.mp3"). */
function isLocalMedia(v: string | null | undefined): v is string {
  return !!v && /^\/media\/\S+$/.test(v) && !/\s/.test(v);
}

function mediaImage(url: string | null): string {
  const ok = (isUrl(url) && IMAGE_RE.test(url)) || (isLocalMedia(url) && IMAGE_RE.test(url));
  if (!ok || !url) return '';
  const safe = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<img src="${safe}">`;
}

function mediaAudio(url: string | null): string {
  return isUrl(url) || isLocalMedia(url) ? `[sound:${url}]` : '';
}

interface DeckRegistry {
  byName: Map<string, Deck>;
  order: string[];
}

/** Ensure a deck (and all its ancestors) exists; return its id. */
function ensureDeck(
  reg: DeckRegistry,
  fullName: string,
  existingByName: Map<string, Deck>,
): string {
  if (reg.byName.has(fullName)) return reg.byName.get(fullName)!.id;

  const parts = fullName.split(DECK_SEP);
  let parentId: string | null = null;
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc = i === 0 ? parts[0] : acc + DECK_SEP + parts[i];
    if (!reg.byName.has(acc)) {
      // Reuse existing id (and collapsed state) so re-import is stable.
      const prior = existingByName.get(acc);
      const deck: Deck = {
        id: prior?.id ?? 'd' + hash(acc),
        name: acc,
        parentId,
        optionsId: prior?.optionsId ?? 'opts-default',
        collapsed: prior?.collapsed ?? false,
      };
      reg.byName.set(acc, deck);
      reg.order.push(acc);
    }
    parentId = reg.byName.get(acc)!.id;
  }
  return reg.byName.get(fullName)!.id;
}

export function transformBooks(
  books: SourceBook[],
  existing: ExistingState,
  now: number = Date.now(),
): ImportResult {
  const existingDecksByName = new Map(existing.decks.map((d) => [d.name, d]));
  const existingNotesByGuid = new Map(existing.notes.map((n) => [n.guid, n]));
  const existingCardsById = new Map(existing.cards.map((c) => [c.id, c]));

  const reg: DeckRegistry = { byName: new Map(), order: [] };
  const notes: Note[] = [];
  const cards: Card[] = [];
  let newCardPosition = 0;

  for (const book of books) {
    const rootTitle = book.root.MenuTitle;
    const noteType = resolveNoteType(book.root.noteType);
    const ords = noteType.templates.map((t) => t.ord);
    // A template can pin its cards to a fixed deck (e.g. Listening),
    // overriding the book's ancestor-path deck; re-applied on every import so
    // a card stays put even if it was ever created before this rule existed.
    const templateByOrd = new Map(noteType.templates.map((t) => [t.ord, t]));

    const walk = (node: ScrapedNode, ancestorPath: string[]): void => {
      const carriesCards = Array.isArray(node.cards) && node.cards.length > 0;

      if (carriesCards) {
        // Collapse this node into its parent: the deck is the ancestor path.
        const deckName =
          ancestorPath.length > 0 ? ancestorPath.join(DECK_SEP) : rootTitle;
        const deckId = ensureDeck(reg, deckName, existingDecksByName);

        for (const sc of node.cards!) {
          const guid = hash(`${book.slug}:${sc.Card_ID}`);
          const prior = existingNotesByGuid.get(guid);
          const noteId = prior?.id ?? 'n' + guid;

          const note: Note = {
            id: noteId,
            noteTypeId: noteType.id,
            fields: {
              SideA: sc.SideA ?? '',
              SideAAudio: mediaAudio(sc.SideAAudio),
              SideAImage: mediaImage(sc.SideAImage),
              SideB: sc.SideB ?? '',
              SideBAudio: mediaAudio(sc.SideBAudio),
              SideBImage: mediaImage(sc.SideBImage),
            },
            tags: [],
            created: prior?.created ?? now,
            modified: now,
            guid,
          };
          notes.push(note);

          for (const ord of ords) {
            const cardId = 'c' + guid + '-' + ord;
            const priorCard = existingCardsById.get(cardId);
            const cardDeckId = templateByOrd.get(ord)?.deckId ?? deckId;
            if (priorCard) {
              // Preserve scheduling state; only refresh placement.
              cards.push({
                ...priorCard,
                noteId,
                deckId: cardDeckId,
                ord,
                modified: now,
              });
            } else {
              cards.push({
                id: cardId,
                noteId,
                deckId: cardDeckId,
                ord,
                type: 'new',
                queue: 'new',
                due: newCardPosition++,
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
              });
            }
          }
        }
      }

      for (const child of node.children ?? []) {
        walk(child, [...ancestorPath, node.MenuTitle]);
      }
    };

    // Seed the root deck so empty books still appear, then walk.
    ensureDeck(reg, rootTitle, existingDecksByName);
    walk(book.root, []);
  }

  const decks = reg.order.map((name) => reg.byName.get(name)!);
  // The Listening deck is never an ancestor-path deck (it's not derived from
  // any book's menu tree), so it would otherwise be silently dropped here —
  // decks.json is fully replaced by this function's output. Carry it through
  // unchanged if it already exists (created by the startup migration).
  const listeningDeck = existing.decks.find((d) => d.id === LISTENING_DECK_ID);
  if (listeningDeck) decks.push(listeningDeck);
  return { decks, notes, cards };
}
