// Canonical data model — mirrors server/src/models. Kept in sync by hand;
// the API is the contract between them.

export type Id = string;

export interface Collection {
  schemaVersion: number;
  created: number;
  modified: number;
  dayCutoffHour: number;
  defaultDeckOptionsId: Id;
  tags: string[];
  /** Day number through which buried cards have already been unburied. */
  lastUnburyDay?: number;
  /** Epoch-ms the current global pause began; null when scheduling is running. */
  pausedAt: number | null;
}

export type NoteTypeKind = 'standard' | 'cloze';

export interface NoteField {
  name: string;
  ord: number;
}

export interface CardTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  /**
   * When set, cards generated from this template always live in this fixed
   * deck, regardless of the note's own deck.
   */
  deckId?: string;
}

export interface NoteType {
  id: Id;
  name: string;
  kind: NoteTypeKind;
  fields: NoteField[];
  templates: CardTemplate[];
  css: string;
}

export interface Note {
  id: Id;
  noteTypeId: Id;
  fields: Record<string, string>;
  tags: string[];
  created: number;
  modified: number;
  guid: string;
}

export type CardType = 'new' | 'learning' | 'review' | 'relearning';
export type CardQueue = 'new' | 'learning' | 'review' | 'suspended' | 'userBuried' | 'schedBuried';

export interface Card {
  id: Id;
  noteId: Id;
  deckId: Id;
  ord: number;
  type: CardType;
  queue: CardQueue;
  due: number;
  reps: number;
  lapses: number;
  left: number;
  lastReviewed: number | null;
  created: number;
  modified: number;
  ease: number;
  interval: number;
  stability: number | null;
  difficulty: number | null;
}

/** Per-deck "studied today" tally, reset when `day` falls behind the current day. */
export interface DeckDaily {
  day: number;
  newStudied: number;
  reviewStudied: number;
}

export interface Deck {
  id: Id;
  name: string;
  parentId: Id | null;
  optionsId: Id;
  collapsed: boolean;
  /** Daily study counts for enforcing per-day new/review limits across reloads. */
  daily?: DeckDaily;
}

export type InsertionOrder = 'sequential' | 'random';
export type LeechAction = 'suspend' | 'tagOnly';
export type SchedulerKind = 'sm2' | 'fsrs';

export interface DeckOptions {
  id: Id;
  name: string;
  new: {
    perDay: number;
    steps: number[];
    graduatingInterval: number;
    easyInterval: number;
    startingEase: number;
    insertionOrder: InsertionOrder;
  };
  review: {
    perDay: number;
    maxInterval: number;
    easyBonus: number;
    intervalModifier: number;
    hardInterval: number;
  };
  lapse: {
    steps: number[];
    newIntervalPct: number;
    minInterval: number;
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

export interface CollectionBundle {
  collection: Collection;
  notetypes: NoteType[];
  decks: Deck[];
  deckoptions: DeckOptions[];
}
