import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { map } from 'rxjs';

import { CollectionStore, todayNumber } from '../../core/collection.store';
import type { Card, Note, NoteType } from '../../core/models';
import { schedulerFor } from '../../core/scheduling/scheduler-factory';
import {
  RATINGS,
  type Rating,
  type ReviewContext,
  type SchedulingResult,
} from '../../core/scheduling/types';
import { StudyQueueService, type QueueCounts } from '../../core/study-queue.service';
import { renderCard } from '../../core/templating/template-renderer';
import { OutboxService } from '../../core/outbox/outbox.service';

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
  /** Full ::-split path of the card's own deck */
  deckPath: string[];
  /** Note type kind: 'standard' or 'cloze' */
  noteTypeKind: 'standard' | 'cloze';
  /** True when this is the audio-only front of an `nt-spanish-2sided` Listening card. */
  isListeningFront: boolean;
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
  protected readonly outbox = inject(OutboxService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly ratings = RATINGS;

  private readonly deckId = toSignal(this.route.paramMap.pipe(map((p) => p.get('deckId'))), {
    initialValue: null,
  });

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
  /** Sync state at session start: 'no' (no sync needed), 'draining' (syncing), 'stuck' (sync failed). */
  readonly syncing = signal<'no' | 'draining' | 'stuck'>('no');

  readonly deckName = computed(() => {
    const id = this.deckId();
    if (id === 'all') return 'All decks';
    const deck = id != null && id !== '' ? this.store.deckById(id) : undefined;
    return deck?.name.split('::').pop() ?? 'Study';
  });

  /** True when scheduling is paused. */
  readonly paused = computed(() => this.store.collection()?.pausedAt != null);

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

  /** Host element wrapping the question `[innerHTML]` (non-revealed branch only). */
  readonly questionHost = viewChild<ElementRef<HTMLElement>>('questionHost');

  private answerStart = 0;

  constructor() {
    void this.init();

    // Sequential autoplay for a Listening card's audio-only front. Scoped to
    // this component only (req 13): other card types never set
    // `isListeningFront`, so `<audio controls>` stays the sole, manual
    // playback path for them, and `transformMedia` is untouched.
    afterRenderEffect((onCleanup) => {
      const s = this.state();
      const isRevealed = this.revealed();
      const host = this.questionHost()?.nativeElement;

      if (s?.isListeningFront !== true || isRevealed || !host) {
        return;
      }

      const audios = Array.from(host.querySelectorAll('audio'));
      if (audios.length === 0) return;

      const detachers: (() => void)[] = [];
      const playAt = (i: number): void => {
        const el = audios.at(i);
        if (!el) return;
        // Autoplay may be blocked by the browser; the visible `controls` stay
        // as the fallback, so a rejection here is expected and silent.
        el.play().catch(() => undefined);
      };
      audios.forEach((el, i) => {
        if (i === audios.length - 1) return; // nothing to chain after the last clip
        const onEnded = () => {
          playAt(i + 1);
        };
        el.addEventListener('ended', onEnded);
        detachers.push(() => {
          el.removeEventListener('ended', onEnded);
        });
      });
      playAt(0);

      // Torn down before the next re-render of this effect (card change,
      // reveal) and on component destroy, so listeners never leak across
      // cards and a still-playing clip doesn't keep running past its card.
      onCleanup(() => {
        for (const detach of detachers) detach();
        for (const el of audios) {
          try {
            el.pause();
          } catch {
            /* jsdom / already-detached media element — nothing to do */
          }
        }
      });
    });
  }

  private ctx(): ReviewContext {
    const coll = this.store.collection();
    if (!coll) throw new Error('ctx() called before collection loaded');
    return { now: Date.now(), today: todayNumber(coll) };
  }

  private async init(): Promise<void> {
    // Gate: drain outbox and reload collection before starting session (C-2)
    if (this.outbox.pendingCount() > 0) {
      this.syncing.set('draining');
      await this.outbox.drain();
      // Re-check: if drain failed, mark as stuck and bail
      if (this.outbox.pendingCount() > 0) {
        this.syncing.set('stuck');
        this.loading.set(false);
        return;
      }
      // Drain succeeded: unconditionally reload collection (not guarded by decks().length)
      await this.store.load();
      this.syncing.set('no');
    }
    if (this.store.decks().length === 0) await this.store.load();
    // Warm the note cache so getNote() is always a cache hit (spec 023 D3).
    // This is critical for offline study to work: without it, the review loop
    // stalls on cache misses. Preload is non-fatal (caught below); if it fails
    // offline with a cold cache, individual notes load on demand.
    try {
      await this.store.loadNotes();
    } catch (err) {
      // Non-fatal: if preload fails (e.g., offline with cold cache), the session
      // still starts and notes load individually on demand. Log for debugging.
      console.error('Failed to preload notes for study session:', err);
    }
    const id = this.deckId();
    const started =
      id === 'all' ? this.queue.startAll() : id != null && id !== '' ? this.queue.start(id) : false;
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
        : (noteType.templates.find((t) => t.ord === card.ord) ?? noteType.templates[0]);
    const isTypeIn = TYPE_FILTER.test(template.qfmt);
    const isListeningFront = noteType.id === 'nt-spanish-2sided' && template.name === 'Listening';
    const { front, back } = renderCard(template.qfmt, template.afmt, note.fields, {
      ord: card.ord,
    });

    const opts = this.queue.options;
    if (!opts) throw new Error('loadNext() called before queue started');
    const preview = schedulerFor(opts).preview(card, opts, ctx);

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
      deckPath: this.store.deckById(card.deckId)?.name.split('::') ?? [this.deckName()],
      noteTypeKind: noteType.kind,
      isListeningFront,
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
      const opts = this.queue.options;
      if (!opts) return;
      // D9: capture the base token before scheduling, since the scheduler's
      // `{ ...card }` spread carries the old `rev` forward.
      const expectedRev = current.card.rev ?? null;
      const timeMs = Date.now() - this.answerStart;
      const { card: next, revlog } = schedulerFor(opts).answer(
        current.card,
        rating,
        opts,
        this.ctx(),
        timeMs,
      );
      // D9: the client owns its local `rev` — set it to the revlog id so an
      // offline chain of reviews is self-consistent with no server round-trip.
      const nextWithRev: Card = { ...next, rev: revlog.id };
      // Optimistically update local state, then persist.
      this.store.applyCard(nextWithRev);
      this.queue.onAnswered(current.card);
      this.answeredCount.update((n) => n + 1);
      // Durable, ordered hand-off — see
      // specs/archive/2026-10-11-023-review-outbox Analyst D3/D4.
      // `revlog.id` is the op id on purpose: it is also the server's dedupe key
      // (`FileStore.appendRevlog`), so a retry of this op cannot double-append.
      this.outbox.enqueue({
        id: revlog.id,
        method: 'POST',
        path: '/review',
        body: { card: nextWithRev, revlog, expectedRev },
      });
      // Persist the daily tally so limits survive a reload, and hide the other
      // cards of this note for the rest of the day.
      this.store.recordStudied(current.card);
      this.store.burySiblings(current.card, opts);
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
      this.store.suspendCard(current.card);
      await this.loadNext();
    } finally {
      this.busy.set(false);
    }
  }

  /** Handle keys while typing an answer: Enter reveals, Escape blurs, others pass through. */
  private handleTypeInKey(e: KeyboardEvent): boolean {
    const typingAnswer = (this.state()?.isTypeIn ?? false) && !this.revealed();
    if (!typingAnswer) return false;

    if (e.key === 'Enter') {
      e.preventDefault();
      this.reveal();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLElement | null)?.blur();
    }
    return true;
  }

  /** Handle navigation (Escape → home) and suspend ('-') keys. */
  private handleNavigationAndSuspendKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      e.preventDefault();
      void this.router.navigateByUrl('/');
      return true;
    }
    if (e.key === '-') {
      e.preventDefault();
      void this.suspend();
      return true;
    }
    return false;
  }

  /** Handle pre-reveal keys: Space/Enter reveal, others stop processing. */
  private handlePreRevealKey(e: KeyboardEvent): boolean {
    if (this.revealed()) return false;

    // Non-type-in cards reveal on Space or Enter.
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.reveal();
    }
    return true; // Stop processing other handlers when not revealed.
  }

  /** Handle rating keys: 1-4 or Space/Enter to rate. */
  private handleRatingKey(e: KeyboardEvent): void {
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0) {
      e.preventDefault();
      void this.rate(RATINGS[idx]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void this.rate('good');
    }
  }

  onKey(e: KeyboardEvent): void {
    if (this.finished() || this.loading()) return;
    if (this.handleTypeInKey(e)) return;
    if (this.handleNavigationAndSuspendKey(e)) return;
    if (this.handlePreRevealKey(e)) return;
    this.handleRatingKey(e);
  }
}
