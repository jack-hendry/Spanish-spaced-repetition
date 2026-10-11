import { Injectable, computed, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { bumpDaily } from './daily-limits';
import { isBuried, restoreQueue, siblingsToBury } from './lifecycle';
import { OutboxService } from './outbox/outbox.service';
import type { Card, Collection, Deck, DeckOptions, Note, NoteType } from './models';

export interface DeckCounts {
  new: number;
  learning: number;
  review: number;
}

export interface DeckNode {
  deck: Deck;
  depth: number;
  /** Counts for this deck alone. */
  own: DeckCounts;
  /** Counts including all descendant decks (what the deck list shows). */
  total: DeckCounts;
  hasChildren: boolean;
}

const ZERO: DeckCounts = { new: 0, learning: 0, review: 0 };

/**
 * The whole-day index of the local calendar day `ms` belongs to, once the
 * day is shifted to begin at `cutoffHour`:00 local. The shift uses local
 * wall-clock hours, so the boundary is exactly `cutoffHour`:00 on every
 * date, DST transitions included.
 */
function studyDayIndex(ms: number, cutoffHour: number): number {
  const d = new Date(ms);
  d.setHours(d.getHours() - cutoffHour);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * Study-day number: local calendar days from the study day containing
 * `collection.created` (day 0) to the study day containing `now`. Rolls
 * over at `collection.dayCutoffHour`:00 local, independent of what
 * time-of-day the collection happened to be created.
 *
 * NOTE: this and `heatDateKey` (`core/heatmap.ts`) bucket the timeline
 * identically on ordinary days, but `heatDateKey` shifts by absolute hours,
 * so on the two DST-transition days a year the two boundaries sit up to an
 * hour apart. Deliberate — see specs/archive/2026-09-02-010-day-rollover-anchoring.
 */
export function todayNumber(collection: Collection, now = Date.now()): number {
  return (
    studyDayIndex(now, collection.dayCutoffHour) -
    studyDayIndex(collection.created, collection.dayCutoffHour)
  );
}

/**
 * Signal store holding the loaded collection (note types, decks, options) plus
 * all cards. Exposes computed per-deck due counts rolled up over subdecks.
 */
@Injectable({ providedIn: 'root' })
export class CollectionStore {
  private readonly api = inject(ApiService);
  private readonly outbox = inject(OutboxService);

  readonly collection = signal<Collection | null>(null);
  readonly noteTypes = signal<NoteType[]>([]);
  readonly decks = signal<Deck[]>([]);
  readonly deckOptions = signal<DeckOptions[]>([]);
  readonly cards = signal<Card[]>([]);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly loaded = computed(() => this.collection() !== null && this.cards().length >= 0);

  /** Per-deck own counts keyed by deckId. */
  private readonly ownCounts = computed<Map<string, DeckCounts>>(() => {
    const coll = this.collection();
    const map = new Map<string, DeckCounts>();
    if (!coll) return map;
    if (coll.pausedAt != null) {
      for (const deck of this.decks()) {
        map.set(deck.id, { new: 0, learning: 0, review: 0 });
      }
      return map;
    }
    const today = todayNumber(coll);
    for (const c of this.cards()) {
      let m = map.get(c.deckId);
      if (!m) {
        m = { new: 0, learning: 0, review: 0 };
        map.set(c.deckId, m);
      }
      if (c.queue === 'new') m.new++;
      else if (c.queue === 'learning') m.learning++;
      else if (c.queue === 'review' && c.type === 'review' && c.due <= today) m.review++;
    }
    return map;
  });

  /** Decks as a flat, display-ordered list with rolled-up counts. */
  readonly deckTree = computed<DeckNode[]>(() => {
    const decks = [...this.decks()].sort((a, b) => a.name.localeCompare(b.name));
    const own = this.ownCounts();

    const nodes: DeckNode[] = decks.map((deck) => {
      const depth = deck.name.split('::').length - 1;
      return {
        deck,
        depth,
        own: own.get(deck.id) ?? ZERO,
        total: { ...(own.get(deck.id) ?? ZERO) },
        hasChildren: false,
      };
    });

    // Roll descendant counts into ancestors using the "::" name prefix.
    const byName = new Map(nodes.map((n) => [n.deck.name, n]));
    for (const node of nodes) {
      const parts = node.deck.name.split('::');
      for (let i = 1; i < parts.length; i++) {
        const ancestorName = parts.slice(0, i).join('::');
        const ancestor = byName.get(ancestorName);
        if (ancestor) {
          ancestor.total.new += node.own.new;
          ancestor.total.learning += node.own.learning;
          ancestor.total.review += node.own.review;
          ancestor.hasChildren = true;
        }
      }
    }
    return nodes;
  });

  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await lastValueFrom(this.api.getCollection());
      this.collection.set(bundle.collection);
      this.noteTypes.set(bundle.notetypes);
      this.decks.set(bundle.decks);
      this.deckOptions.set(bundle.deckoptions);
      const cards = await lastValueFrom(this.api.getCards());
      this.cards.set(cards);
      this.unburyForNewDay();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collection');
    } finally {
      this.loading.set(false);
    }
  }

  /** Replace a single card in the local cache after it's been reviewed. */
  applyCard(updated: Card): void {
    this.cards.update((cards) => {
      const i = cards.findIndex((c) => c.id === updated.id);
      if (i === -1) return cards;
      const next = cards.slice();
      next[i] = updated;
      return next;
    });
  }

  /** Note cache, populated on demand during review (notes.json isn't bulk-loaded). */
  private readonly noteCache = new Map<string, Note>();

  /** All notes, bulk-loaded for the browser. Empty until loadNotes() runs. */
  readonly notes = signal<Note[]>([]);
  private notesLoaded = false;

  async getNote(id: string): Promise<Note> {
    const cached = this.noteCache.get(id);
    if (cached) return cached;
    const note = await lastValueFrom(this.api.getNote(id));
    this.noteCache.set(id, note);
    return note;
  }

  /** Bulk-load every note once (for the browser); subsequent calls are no-ops. */
  async loadNotes(): Promise<void> {
    if (this.notesLoaded) return;
    const notes = await lastValueFrom(this.api.getNotes());
    for (const n of notes) this.noteCache.set(n.id, n);
    this.notes.set(notes);
    this.notesLoaded = true;
  }

  /** Persist edited note fields and (optionally) tags; the server reconciles the note's cards. */
  saveNoteFields(id: string, fields: Record<string, string>, tags?: string[]) {
    return lastValueFrom(this.api.patchNote(id, { fields, tags }));
  }

  /** Apply a saved note edit: refresh the note cache and reconciled cards. */
  applyNoteSave(result: { note: Note; cards: Card[] }): void {
    const { note, cards } = result;
    this.noteCache.set(note.id, note);
    this.notes.update((all) => all.map((n) => (n.id === note.id ? note : n)));
    this.cards.update((all) => [...all.filter((c) => c.noteId !== note.id), ...cards]);
  }

  /** Restore a suspended/buried card to its active queue. */
  async unsuspendCard(card: Card): Promise<void> {
    const queue = restoreQueue(card.type);
    this.setQueues(new Map([[card.id, queue]]));
    await lastValueFrom(this.api.patchCard(card.id, { queue }));
  }

  noteTypeById(id: string): NoteType | undefined {
    return this.noteTypes().find((t) => t.id === id);
  }

  deckById(id: string): Deck | undefined {
    return this.decks().find((d) => d.id === id);
  }

  optionsFor(deck: Deck): DeckOptions | undefined {
    return this.deckOptions().find((o) => o.id === deck.optionsId);
  }

  deckOptionsById(id: string): DeckOptions | undefined {
    return this.deckOptions().find((o) => o.id === id);
  }

  /**
   * The collection-wide fallback options group, resolved through
   * `collection.defaultDeckOptionsId` (falling back to array position 0 if
   * that id doesn't resolve — e.g. an empty/mid-migration collection).
   */
  defaultDeckOptions(): DeckOptions | undefined {
    const id = this.collection()?.defaultDeckOptionsId;
    return (id != null ? this.deckOptionsById(id) : undefined) ?? this.deckOptions()[0];
  }

  /** Replace a deck-options group in the local cache after it's been saved. */
  applyDeckOptions(updated: DeckOptions): void {
    this.deckOptions.update((all) => {
      const i = all.findIndex((o) => o.id === updated.id);
      if (i === -1) return [...all, updated];
      const next = all.slice();
      next[i] = updated;
      return next;
    });
  }

  // ---- card lifecycle ------------------------------------------------------

  /** Patch a set of cards' queue in the local cache by id. */
  private setQueues(updates: Map<string, Card['queue']>): void {
    this.cards.update((cards) =>
      cards.map((c) => {
        const queue = updates.get(c.id);
        return queue === undefined ? c : { ...c, queue };
      }),
    );
  }

  /**
   * Bury the siblings of a just-answered card for the rest of the day, honouring
   * the deck's bury options. Updates the cache immediately, then persists.
   */
  burySiblings(answered: Card, opts: DeckOptions): void {
    const targets = siblingsToBury(this.cards(), answered, opts);
    if (!targets.length) return;
    this.setQueues(new Map(targets.map((c) => [c.id, 'schedBuried' as const])));
    targets.forEach((c) => {
      this.outbox.enqueue({
        id: `bury-${c.id}-${Date.now()}`,
        method: 'PATCH',
        path: `/cards/${c.id}`,
        body: { queue: 'schedBuried' },
      });
    });
  }

  /**
   * Record that a card was studied today, bumping its deck's daily tally so the
   * per-day new/review limits survive a reload. No-op for learning-step reviews.
   */
  recordStudied(card: Card): void {
    const coll = this.collection();
    const deck = this.deckById(card.deckId);
    if (!coll || !deck) return;
    const daily = bumpDaily(deck, card, todayNumber(coll));
    if (!daily) return;
    this.decks.update((decks) => decks.map((d) => (d.id === deck.id ? { ...d, daily } : d)));
    this.outbox.enqueue({
      id: `daily-${deck.id}-${daily.day}`,
      method: 'PATCH',
      path: `/decks/${deck.id}`,
      body: { daily },
    });
  }

  /** Suspend a single card (hidden until manually un-suspended). */
  suspendCard(card: Card): void {
    this.setQueues(new Map([[card.id, 'suspended']]));
    this.outbox.enqueue({
      id: `susp-${card.id}-${Date.now()}`,
      method: 'PATCH',
      path: `/cards/${card.id}`,
      body: { queue: 'suspended' },
    });
  }

  /**
   * At the first study of a new day, restore every buried card to its active
   * queue and advance the collection's unbury checkpoint. No-op within a day.
   */
  unburyForNewDay(): void {
    const coll = this.collection();
    if (!coll) return;
    const today = todayNumber(coll);
    if (today <= (coll.lastUnburyDay ?? -1)) return;

    const buried = this.cards().filter(isBuried);
    if (buried.length) {
      this.setQueues(new Map(buried.map((c) => [c.id, restoreQueue(c.type)])));
      buried.forEach((c) => {
        this.outbox.enqueue({
          id: `unbury-${c.id}-${today}`,
          method: 'PATCH',
          path: `/cards/${c.id}`,
          body: { queue: restoreQueue(c.type) },
        });
      });
    }

    this.collection.set({ ...coll, lastUnburyDay: today });
    this.outbox.enqueue({
      id: `unburyday-${today}`,
      method: 'PATCH',
      path: `/collection`,
      body: { lastUnburyDay: today },
    });
  }
}
