import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { map } from 'rxjs';

import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { Card, Note, NoteType } from '../../core/models';
import { SchedulerFactory } from '../../core/scheduling/scheduler-factory';
import {
  RATINGS,
  type Rating,
  type ReviewContext,
  type SchedulingResult,
} from '../../core/scheduling/types';
import { StudyQueueService, type QueueCounts } from '../../core/study-queue.service';
import { renderCard } from '../../core/templating/template-renderer';
import { lastValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';

interface RenderState {
  card: Card;
  question: SafeHtml;
  answer: SafeHtml;
  preview: Record<Rating, SchedulingResult>;
  /** True when the active template asks the user to type the answer. */
  isTypeIn: boolean;
  // Inputs retained so a {{type:}} answer can be re-rendered against the
  // user's input at reveal time.
  qfmt: string;
  afmt: string;
  fields: Record<string, string>;
  css: string;
  /** The note's tags, used for the breadcrumb sub-topic. */
  tags: string[];
  /** Full ::-split path of the card's own deck */
  deckPath: string[];
  /** Note type kind: 'standard' or 'cloze' */
  noteTypeKind: 'standard' | 'cloze';
}

const TYPE_FILTER = /\{\{\s*type:/;

@Component({
  selector: 'app-review',
  imports: [RouterLink],
  templateUrl: './review.html',
  styleUrl: './review.scss',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Review {
  private readonly store = inject(CollectionStore);
  private readonly queue = inject(StudyQueueService);
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly ratings = RATINGS;

  private readonly deckId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('deckId'))),
    { initialValue: null },
  );

  readonly loading = signal(true);
  readonly finished = signal(false);
  readonly busy = signal(false);
  readonly revealed = signal(false);
  readonly state = signal<RenderState | null>(null);
  readonly counts = signal<QueueCounts>({ new: 0, learning: 0, review: 0 });
  /** The answer the user typed for a {{type:}} card (current card only). */
  readonly typed = signal('');
  /** Number of cards graded so far this session. */
  readonly answeredCount = signal(0);
  /** Due count at session start; the denominator for "n of total". */
  readonly sessionTotal = signal(0);

  readonly deckName = computed(() => {
    const id = this.deckId();
    if (id === 'all') return 'All decks';
    const deck = id ? this.store.deckById(id) : undefined;
    return deck ? deck.name.split('::').pop()! : 'Study';
  });

  /** 1-indexed position of the current card within the session. */
  readonly sessionN = computed(() =>
    Math.min(this.answeredCount() + 1, Math.max(this.sessionTotal(), 1)),
  );

  /** Percentage of the session progress bar to fill. */
  readonly progressPct = computed(() => {
    const total = this.sessionTotal();
    if (total <= 0) return 0;
    return Math.min(100, Math.round((this.answeredCount() / total) * 100));
  });

  private answerStart = 0;

  constructor() {
    void this.init();
  }

  private ctx(): ReviewContext {
    const coll = this.store.collection()!;
    return { now: Date.now(), today: todayNumber(coll) };
  }

  private async init(): Promise<void> {
    if (this.store.decks().length === 0) await this.store.load();
    const id = this.deckId();
    const started = id === 'all' ? this.queue.startAll() : id ? this.queue.start(id) : false;
    if (!started) {
      this.loading.set(false);
      this.finished.set(true);
      return;
    }
    const startCounts = this.queue.counts(this.ctx());
    this.sessionTotal.set(startCounts.new + startCounts.learning + startCounts.review);
    await this.loadNext();
    this.loading.set(false);
  }

  private async loadNext(): Promise<void> {
    const ctx = this.ctx();
    this.counts.set(this.queue.counts(ctx));
    const card = this.queue.next(ctx);
    if (!card) {
      this.state.set(null);
      this.finished.set(true);
      return;
    }
    const note: Note = await this.store.getNote(card.noteId);
    const noteType: NoteType | undefined = this.store.noteTypeById(note.noteTypeId);
    if (!noteType) {
      this.finished.set(true);
      return;
    }
    // Cloze cards share one template; the ordinal selects the active deletion.
    const template =
      noteType.kind === 'cloze'
        ? noteType.templates[0]
        : noteType.templates[card.ord] ?? noteType.templates[0];
    const isTypeIn = TYPE_FILTER.test(template.qfmt);
    const { front, back } = renderCard(template.qfmt, template.afmt, note.fields, {
      ord: card.ord,
    });

    const opts = this.queue.options!;
    const preview = SchedulerFactory.for(opts).preview(card, opts, ctx);

    this.revealed.set(false);
    this.typed.set('');
    this.answerStart = Date.now();
    this.state.set({
      card,
      question: this.wrap(noteType.css, front),
      answer: this.wrap(noteType.css, back),
      preview,
      isTypeIn,
      qfmt: template.qfmt,
      afmt: template.afmt,
      fields: note.fields,
      css: noteType.css,
      tags: note.tags,
      deckPath: this.store.deckById(card.deckId)?.name.split('::') ?? [this.deckName()],
      noteTypeKind: noteType.kind,
    });
  }

  private wrap(css: string, body: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      `<style>${css}</style><div class="card">${body}</div>`,
    );
  }

  reveal(): void {
    const s = this.state();
    if (!s) return;
    // Type-in cards re-render the answer so it can diff against what was typed.
    if (s.isTypeIn) {
      const { back } = renderCard(s.qfmt, s.afmt, s.fields, {
        ord: s.card.ord,
        typedAnswer: this.typed(),
      });
      this.state.set({ ...s, answer: this.wrap(s.css, back) });
    }
    this.revealed.set(true);
  }

  buttonLabel(rating: Rating): string {
    return this.state()?.preview[rating].label ?? '';
  }

  async rate(rating: Rating): Promise<void> {
    const current = this.state();
    if (!current || this.busy()) return;
    this.busy.set(true);
    try {
      const opts = this.queue.options!;
      const timeMs = Date.now() - this.answerStart;
      const { card: next, revlog } = SchedulerFactory.for(opts).answer(
        current.card,
        rating,
        opts,
        this.ctx(),
        timeMs,
      );
      // Optimistically update local state, then persist.
      this.store.applyCard(next);
      this.queue.onAnswered(current.card);
      this.answeredCount.update((n) => n + 1);
      await lastValueFrom(this.api.submitReview(next, revlog));
      // Persist the daily tally so limits survive a reload, and hide the other
      // cards of this note for the rest of the day.
      await this.store.recordStudied(current.card);
      await this.store.burySiblings(current.card, opts);
      await this.loadNext();
    } finally {
      this.busy.set(false);
    }
  }

  /** Suspend the current card and advance to the next. */
  async suspend(): Promise<void> {
    const current = this.state();
    if (!current || this.busy()) return;
    this.busy.set(true);
    try {
      // The suspended card leaves the queue on its own; don't spend a daily slot.
      await this.store.suspendCard(current.card);
      await this.loadNext();
    } finally {
      this.busy.set(false);
    }
  }

  onKey(e: KeyboardEvent): void {
    if (this.finished() || this.loading()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      void this.router.navigateByUrl('/');
      return;
    }
    if (e.key === '-') {
      e.preventDefault();
      void this.suspend();
      return;
    }
    if (!this.revealed()) {
      // On a type-in card, let Space (and everything else) reach the input; only
      // Enter submits. Other cards reveal on Space or Enter.
      const typeIn = this.state()?.isTypeIn ?? false;
      if (e.key === 'Enter' || (!typeIn && e.key === ' ')) {
        e.preventDefault();
        this.reveal();
      }
      return;
    }
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0) {
      e.preventDefault();
      void this.rate(RATINGS[idx]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void this.rate('good');
    }
  }
}
