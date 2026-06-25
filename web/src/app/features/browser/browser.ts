import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { Card, Note, NoteType } from '../../core/models';
import { parseQuery, type SearchRow } from '../../core/search';

/** Max rows rendered at once; matches Anki's "showing N of M" behaviour. */
const ROW_CAP = 500;

interface BrowserRow extends SearchRow {
  /** Original-case first non-empty field, for the table's Question column. */
  question: string;
  state: string;
  deckLeaf: string;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stateLabel(card: Card): string {
  switch (card.queue) {
    case 'new':
      return 'New';
    case 'learning':
      return card.type === 'relearning' ? 'Relearning' : 'Learning';
    case 'review':
      return 'Review';
    case 'suspended':
      return 'Suspended';
    case 'schedBuried':
    case 'userBuried':
      return 'Buried';
    default:
      return card.queue;
  }
}

@Component({
  selector: 'app-browser',
  imports: [FormsModule, RouterLink],
  templateUrl: './browser.html',
  styleUrl: './browser.scss',
})
export class Browser {
  private readonly store = inject(CollectionStore);

  readonly loading = signal(true);
  readonly query = signal('');
  readonly busy = signal(false);

  /** The note currently open in the editor, or null. */
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<Record<string, string>>({});

  readonly ROW_CAP = ROW_CAP;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.decks().length === 0) await this.store.load();
    await this.store.loadNotes();
    this.loading.set(false);
  }

  /** All cards flattened into searchable rows (recomputed when data changes). */
  private readonly allRows = computed<BrowserRow[]>(() => {
    const noteById = new Map(this.store.notes().map((n) => [n.id, n]));
    const deckById = new Map(this.store.decks().map((d) => [d.id, d]));
    const rows: BrowserRow[] = [];
    for (const card of this.store.cards()) {
      const note = noteById.get(card.noteId);
      if (!note) continue;
      const deck = deckById.get(card.deckId);
      const deckName = (deck?.name ?? '').toLowerCase();
      const values = Object.values(note.fields);
      const question = values.map((v) => stripHtml(v)).find((v) => v.length > 0) ?? '';
      rows.push({
        card,
        note,
        deckName,
        text: values.join('  ').replace(/<[^>]*>/g, ' ').toLowerCase(),
        tags: note.tags.map((t) => t.toLowerCase()),
        question,
        state: stateLabel(card),
        deckLeaf: (deck?.name ?? '').split('::').pop() ?? '',
      });
    }
    return rows;
  });

  private readonly today = computed(() => {
    const coll = this.store.collection();
    return coll ? todayNumber(coll) : 0;
  });

  readonly matches = computed<BrowserRow[]>(() => {
    const predicate = parseQuery(this.query());
    const today = this.today();
    const out: BrowserRow[] = [];
    for (const row of this.allRows()) {
      if (predicate(row, today)) {
        out.push(row);
        if (out.length >= ROW_CAP) break;
      }
    }
    return out;
  });

  readonly totalCount = computed(() => this.allRows().length);

  /** Fields of the note being edited, in note-type order. */
  readonly editFields = computed(() => {
    const id = this.editingId();
    if (!id) return [] as { name: string }[];
    const note = this.store.notes().find((n) => n.id === id);
    const nt: NoteType | undefined = note && this.store.noteTypeById(note.noteTypeId);
    return nt ? nt.fields.map((f) => ({ name: f.name })) : [];
  });

  edit(row: BrowserRow): void {
    this.editingId.set(row.note.id);
    this.draft.set({ ...row.note.fields });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  setField(name: string, value: string): void {
    this.draft.update((d) => ({ ...d, [name]: value }));
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.store.saveNoteFields(id, this.draft());
      this.store.applyNoteSave(result);
      this.editingId.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  async toggleSuspend(row: BrowserRow): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (row.card.queue === 'suspended') await this.store.unsuspendCard(row.card);
      else await this.store.suspendCard(row.card);
    } finally {
      this.busy.set(false);
    }
  }

  isSuspended(row: BrowserRow): boolean {
    return row.card.queue === 'suspended';
  }
}
