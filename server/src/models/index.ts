// Canonical data model for the flashcard collection.
// All ids are strings (timestamp-based, like Anki). These types are the contract
// between the file store, the importer, and the API. The Angular app mirrors them.

export type Id = string;

// ---- Collection ----------------------------------------------------------

export interface Collection {
  schemaVersion: number;
  created: number;
  modified: number;
  /** Hour (local) at which a new study day begins. Anki default is 4am. */
  dayCutoffHour: number;
  defaultDeckOptionsId: Id;
  /** Flat index of hierarchical tags (e.g. "grammar::verbs"). */
  tags: string[];
  /** Day number through which buried cards have already been unburied. */
  lastUnburyDay?: number;
}

// ---- Note types ----------------------------------------------------------

export type NoteTypeKind = 'standard' | 'cloze';

export interface NoteField {
  name: string;
  ord: number;
}

export interface CardTemplate {
  name: string;
  ord: number;
  /** Question-side Mustache-ish template. */
  qfmt: string;
  /** Answer-side template. */
  afmt: string;
}

export interface NoteType {
  id: Id;
  name: string;
  kind: NoteTypeKind;
  fields: NoteField[];
  /** Cloze note types have exactly one template. */
  templates: CardTemplate[];
  css: string;
}

// ---- Notes ---------------------------------------------------------------

export interface Note {
  id: Id;
  noteTypeId: Id;
  /** field name -> HTML string */
  fields: Record<string, string>;
  tags: string[];
  created: number;
  modified: number;
  /** Stable identity across re-imports. */
  guid: string;
}

// ---- Cards ---------------------------------------------------------------

export type CardType = 'new' | 'learning' | 'review' | 'relearning';
export type CardQueue =
  | 'new'
  | 'learning'
  | 'review'
  | 'suspended'
  | 'userBuried'
  | 'schedBuried';

export interface Card {
  id: Id;
  noteId: Id;
  deckId: Id;
  /** Template ord (standard) OR cloze index (cloze). */
  ord: number;

  type: CardType;
  queue: CardQueue;
  /** new: position; learning: epoch seconds; review: day number. */
  due: number;

  // shared scheduling state
  reps: number;
  lapses: number;
  /** remaining learning/relearning steps. */
  left: number;
  lastReviewed: number | null;
  created: number;
  modified: number;

  // SM-2 state
  /** ease factor in permille, e.g. 2500 = 250%. */
  ease: number;
  /** current interval in days. */
  interval: number;

  // FSRS state (null until scheduled by FSRS)
  stability: number | null;
  difficulty: number | null;
}

// ---- Decks ---------------------------------------------------------------

/** Per-deck "studied today" tally, reset when `day` falls behind the current day. */
export interface DeckDaily {
  day: number;
  newStudied: number;
  reviewStudied: number;
}

export interface Deck {
  id: Id;
  /** Full hierarchical name, e.g. "Spanish::Verbs". */
  name: string;
  parentId: Id | null;
  optionsId: Id;
  collapsed: boolean;
  /** Daily study counts for enforcing per-day new/review limits across reloads. */
  daily?: DeckDaily;
}

// ---- Deck options --------------------------------------------------------

export type InsertionOrder = 'sequential' | 'random';
export type LeechAction = 'suspend' | 'tagOnly';
export type SchedulerKind = 'sm2' | 'fsrs';

export interface DeckOptions {
  id: Id;
  name: string;
  new: {
    perDay: number;
    steps: number[]; // minutes
    graduatingInterval: number; // days
    easyInterval: number; // days
    startingEase: number; // permille
    insertionOrder: InsertionOrder;
  };
  review: {
    perDay: number;
    maxInterval: number; // days
    easyBonus: number;
    intervalModifier: number;
    hardInterval: number;
  };
  lapse: {
    steps: number[]; // minutes
    newIntervalPct: number; // 0..1
    minInterval: number; // days
    leechThreshold: number;
    leechAction: LeechAction;
  };
  display: {
    newGatherOrder: string;
    newSortOrder: string;
    reviewOrder: string;
    buryNewSiblings: boolean;
    buryReviewSiblings: boolean;
    buryInterdaySiblings: boolean;
  };
  scheduler: SchedulerKind;
  fsrs: {
    desiredRetention: number;
    weights: number[];
    maxInterval: number;
    learningSteps: number[];
    relearningSteps: number[];
  };
}

// ---- Revlog --------------------------------------------------------------

export type RevlogType = 'learn' | 'review' | 'relearn';

export interface RevlogEntry {
  id: Id;
  cardId: Id;
  reviewedAt: number;
  button: 1 | 2 | 3 | 4;
  type: RevlogType;
  interval: number;
  lastInterval: number;
  factorOrStability: number;
  timeMs: number;
}

// ---- API bundle ----------------------------------------------------------

/** Returned by GET /api/collection. */
export interface CollectionBundle {
  collection: Collection;
  notetypes: NoteType[];
  decks: Deck[];
  deckoptions: DeckOptions[];
}
