import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { Card, Note, NoteType } from '../../core/models';
import { formatRelativeDue, MATURE_THRESHOLD } from '../../core/stats';
import { clozeOrds, renderCloze } from '../../core/templating/cloze';
import { parseQuery, type SearchRow } from '../../core/search';

/** Max rows rendered at once; matches Anki's "showing N of M" behaviour. */
const ROW_CAP = 500;

interface BrowserRow extends SearchRow {
  /** Question-column text; cloze deletions for the card's own ord read "[...]" . */
  front: string;
  deckLeaf: string;
  stateLabel: string;
  /** Pill tint class suffix: new | learning | young | review | muted. */
  stateClass: string;
  /** Relative due string, e.g. "today" / "8 min" / "2 days" / "—". */
  due: string;
  noteTypeName: string;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The card's question text; cloze fields render their own deletion as "[...]" . */
function frontText(note: Note, noteType: NoteType | undefined, cardOrd: number): string {
  const values = Object.values(note.fields);
  if (noteType?.kind === 'cloze') {
    const clozeField = values.find((v) => clozeOrds(v).length > 0);
    if (clozeField) return stripHtml(renderCloze(clozeField, cardOrd + 1, false));
  }
  return values.map(stripHtml).find((v) => v.length > 0) ?? '';
}

function stateInfo(card: Card): { label: string; cls: string } {
  switch (card.queue) {
    case 'new':
      return { label: 'New', cls: 'new' };
    case 'learning':
      return { label: card.type === 'relearning' ? 'Relearning' : 'Learning', cls: 'learning' };
    case 'review':
      return card.interval < MATURE_THRESHOLD
        ? { label: 'Young', cls: 'young' }
        : { label: 'Review', cls: 'review' };
    case 'suspended':
      return { label: 'Suspended', cls: 'muted' };
    case 'schedBuried':
    case 'userBuried':
      return { label: 'Buried', cls: 'muted' };
    default:
      return { label: card.queue, cls: 'muted' };
  }
}

@Component({
  selector: 'app-browser',
  imports: [FormsModule],
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
  readonly draftTags = signal<string[]>([]);
  readonly newTag = signal('');

  readonly ROW_CAP = ROW_CAP;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (this.store.decks().length === 0) await this.store.load();
    await this.store.loadNotes();
    this.loading.set(false);
  }

  private readonly today = computed(() => {
    const coll = this.store.collection();
    return coll ? todayNumber(coll) : 0;
  });

  /** All cards flattened into searchable rows (recomputed when data changes). */
  private readonly allRows = computed<BrowserRow[]>(() => {
    const noteById = new Map(this.store.notes().map((n) => [n.id, n]));
    const deckById = new Map(this.store.decks().map((d) => [d.id, d]));
    const today = this.today();
    const now = Date.now();
    const rows: BrowserRow[] = [];
    for (const card of this.store.cards()) {
      const note = noteById.get(card.noteId);
      if (!note) continue;
      const deck = deckById.get(card.deckId);
      const noteType = this.store.noteTypeById(note.noteTypeId);
      const values = Object.values(note.fields);
      const state = stateInfo(card);
      rows.push({
        card,
        note,
        deckName: (deck?.name ?? '').toLowerCase(),
        text: values
          .join('  ')
          .replace(/<[^>]*>/g, ' ')
          .toLowerCase(),
        tags: note.tags.map((t) => t.toLowerCase()),
        front: frontText(note, noteType, card.ord),
        deckLeaf: (deck?.name ?? '').split('::').pop() ?? '',
        stateLabel: state.label,
        stateClass: state.cls,
        due: formatRelativeDue(card, today, now),
        noteTypeName: noteType?.name ?? '',
      });
    }
    return rows;
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

  /** The row currently open in the editor, or undefined. */
  readonly editingRow = computed<BrowserRow | undefined>(() => {
    const id = this.editingId();
    if (!id) return undefined;
    return this.allRows().find((r) => r.note.id === id);
  });

  /** Fields of the note being edited, in note-type order. */
  readonly editFields = computed(() => {
    const row = this.editingRow();
    if (!row) return [] as { name: string }[];
    const nt = this.store.noteTypeById(row.note.noteTypeId);
    return nt ? nt.fields.map((f) => ({ name: f.name })) : [];
  });

  edit(row: BrowserRow): void {
    this.editingId.set(row.note.id);
    this.draft.set({ ...row.note.fields });
    this.draftTags.set([...row.note.tags]);
    this.newTag.set('');
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  setField(name: string, value: string): void {
    this.draft.update((d) => ({ ...d, [name]: value }));
  }

  addTag(): void {
    const tag = this.newTag().trim();
    if (!tag) return;
    this.draftTags.update((tags) => (tags.includes(tag) ? tags : [...tags, tag]));
    this.newTag.set('');
  }

  removeTag(tag: string): void {
    this.draftTags.update((tags) => tags.filter((t) => t !== tag));
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.store.saveNoteFields(id, this.draft(), this.draftTags());
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
