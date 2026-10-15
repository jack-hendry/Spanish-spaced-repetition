// File-backed store for the canonical collection. Owns data/spanish.
//
// Reads load the whole collection into memory on init; writes are atomic
// (temp file + rename). Hot files (cards.json) are debounced so a burst of
// reviews coalesces into one rewrite. revlog.ndjson is append-only.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  Card,
  Collection,
  Deck,
  DeckOptions,
  Note,
  NoteType,
  RevlogEntry,
} from '../models/index.js';
import { buildSeedCollection, buildSeedDeckOptions, buildSeedNoteTypes } from './seed.js';
import { migrateAddListeningTemplate } from './migrations.js';

interface FileNames {
  collection: string;
  notetypes: string;
  decks: string;
  deckoptions: string;
  notes: string;
  cards: string;
  revlog: string;
}

const FILES: FileNames = {
  collection: 'collection.json',
  notetypes: 'notetypes.json',
  decks: 'decks.json',
  deckoptions: 'deckoptions.json',
  notes: 'notes.json',
  cards: 'cards.json',
  revlog: 'revlog.ndjson',
};

interface StoreData {
  collection: Collection;
  notetypes: NoteType[];
  decks: Deck[];
  deckoptions: DeckOptions[];
  notes: Note[];
  cards: Card[];
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export class FileStore {
  private data!: StoreData;
  private readonly pending = new Map<keyof FileNames, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<keyof FileNames, Promise<void>>();
  private readonly debounceMs: number;
  private revlogIds = new Set<string>();

  constructor(
    private readonly dataDir: string,
    opts: { debounceMs?: number } = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 400;
  }

  private path(name: keyof FileNames): string {
    return join(this.dataDir, FILES[name]);
  }

  /** Load existing files; seed the foundational files if the dir is empty. */
  async init(): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(join(this.dataDir, 'media'), { recursive: true });

    const now = Date.now();
    const seededCollection = buildSeedCollection(now);

    this.data = {
      collection: await readJson(this.path('collection'), seededCollection),
      notetypes: await readJson(this.path('notetypes'), buildSeedNoteTypes()),
      decks: await readJson<Deck[]>(this.path('decks'), []),
      deckoptions: await readJson(this.path('deckoptions'), buildSeedDeckOptions()),
      notes: await readJson<Note[]>(this.path('notes'), []),
      cards: await readJson<Card[]>(this.path('cards'), []),
    };

    // Load existing revlog for replay-safety deduplication
    const entries = await this.readRevlog();
    for (const e of entries) this.revlogIds.add(e.id);

    // Persist any freshly-seeded foundational files so subsequent reads are stable.
    if (!existsSync(this.path('collection'))) await this.flush('collection');
    if (!existsSync(this.path('notetypes'))) await this.flush('notetypes');
    if (!existsSync(this.path('deckoptions'))) await this.flush('deckoptions');
    if (!existsSync(this.path('decks'))) await this.flush('decks');
    if (!existsSync(this.path('notes'))) await this.flush('notes');
    if (!existsSync(this.path('cards'))) await this.flush('cards');

    // Startup migration: reach live stores whose notetypes.json predates a
    // newly-added built-in template (e.g. the Listening card). Pure/idempotent
    // over this.data; persist notetypes before cards so a crash mid-migration
    // never leaves cards referencing an ord the note type doesn't have yet.
    const migration = migrateAddListeningTemplate(this.data, now);
    if (migration.changedNoteTypes) await this.flush('notetypes');
    if (migration.changedDecks) await this.flush('decks');
    if (migration.changedCards) await this.flush('cards');
  }

  // ---- accessors (return live references; callers must persist via save*) --

  getCollection(): Collection {
    return this.data.collection;
  }
  getNoteTypes(): NoteType[] {
    return this.data.notetypes;
  }
  getDecks(): Deck[] {
    return this.data.decks;
  }
  getDeckOptions(): DeckOptions[] {
    return this.data.deckoptions;
  }
  getNotes(): Note[] {
    return this.data.notes;
  }
  getCards(): Card[] {
    return this.data.cards;
  }

  // ---- persistence ---------------------------------------------------------

  /** Write a file immediately (atomic). */
  private async flush(name: keyof FileNames): Promise<void> {
    const value = (this.data as unknown as Record<string, unknown>)[name];
    await writeJsonAtomic(this.path(name), value);
  }

  /** Schedule a debounced write for a hot file. */
  private scheduleFlush(name: keyof FileNames): void {
    const existing = this.pending.get(name);
    if (existing) clearTimeout(existing);
    this.pending.set(
      name,
      setTimeout(() => {
        this.pending.delete(name);
        const p = this.flush(name);
        this.inFlight.set(name, p);
        p.finally(() => {
          // Guard: only clear if this promise is still the one tracked for this name
          if (this.inFlight.get(name) === p) {
            this.inFlight.delete(name);
          }
        }).catch(() => {
          // Explicitly handle the promise to prevent unhandled rejection warnings
        });
      }, this.debounceMs),
    );
  }

  /** Force all pending debounced writes to disk (used on shutdown / tests). */
  async flushAll(): Promise<void> {
    // Drain all pending timers
    const names = [...this.pending.keys()];
    for (const name of names) {
      const t = this.pending.get(name);
      if (t) clearTimeout(t);
      this.pending.delete(name);
      await this.flush(name);
    }

    // Await any in-flight writes that may have been started by the timers
    // or by direct calls to flush(). Keep looping until empty, in case
    // the flush itself triggers new writes (unlikely but safe).
    let inFlightNames = [...this.inFlight.keys()];
    while (inFlightNames.length > 0) {
      const promises: Promise<void>[] = [];
      for (const name of inFlightNames) {
        const p = this.inFlight.get(name);
        if (p) promises.push(p);
      }
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      inFlightNames = [...this.inFlight.keys()];
    }
  }

  async saveCollection(): Promise<void> {
    this.data.collection.modified = Date.now();
    await this.flush('collection');
  }
  async saveNoteTypes(): Promise<void> {
    await this.flush('notetypes');
  }
  async saveDecks(): Promise<void> {
    await this.flush('decks');
  }
  async saveDeckOptions(): Promise<void> {
    await this.flush('deckoptions');
  }
  async saveNotes(): Promise<void> {
    await this.flush('notes');
  }
  /** Hot path: debounced so review bursts coalesce. */
  saveCardsSoon(): void {
    this.scheduleFlush('cards');
  }
  /**
   * Persist cards immediately (awaited) — used by ordered writes such as the
   * resume endpoint, where the card write must be guaranteed committed to disk
   * before a subsequent collection write. Cancels any pending debounced write
   * and awaits any in-flight write.
   */
  async saveCards(): Promise<void> {
    const existing = this.pending.get('cards');
    if (existing) {
      clearTimeout(existing);
      this.pending.delete('cards');
    }
    // Await any in-flight write from a previous debounced flush
    const inFlightWrite = this.inFlight.get('cards');
    if (inFlightWrite) {
      await inFlightWrite;
    }
    await this.flush('cards');
  }

  /** Replace the entire collection content (used by the importer). */
  async replaceAll(next: Partial<StoreData>): Promise<void> {
    this.data = { ...this.data, ...next };
    await this.flush('collection');
    await this.flush('notetypes');
    await this.flush('decks');
    await this.flush('deckoptions');
    await this.flush('notes');
    await this.flush('cards');
  }

  async appendRevlog(entry: RevlogEntry): Promise<void> {
    if (this.revlogIds.has(entry.id)) return;
    await appendFile(this.path('revlog'), JSON.stringify(entry) + '\n', 'utf8');
    this.revlogIds.add(entry.id);
  }

  /** Read the full review log (append-only ndjson); empty if none yet. */
  async readRevlog(): Promise<RevlogEntry[]> {
    const path = this.path('revlog');
    if (!existsSync(path)) return [];
    const raw = await readFile(path, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RevlogEntry);
  }
}
