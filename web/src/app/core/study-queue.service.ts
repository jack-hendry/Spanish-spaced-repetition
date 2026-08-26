import { Injectable, inject } from '@angular/core';

import { CollectionStore, todayNumber } from './collection.store';
import { remainingLimits } from './daily-limits';
import type { Card, DeckOptions } from './models';
import type { ReviewContext } from './scheduling/types';

interface Session {
  deckId: string;
  subtree: Set<string>;
  opts: DeckOptions;
  newRemaining: number;
  reviewRemaining: number;
}

export interface QueueCounts {
  new: number;
  learning: number;
  review: number;
}

/**
 * Gathers the next card to study for a deck + its subdecks, honouring per-day
 * new/review limits. Ordering: due learning → due review → new, with future
 * learning cards surfaced last so a session can be finished without waiting.
 *
 * Daily limits are tracked in-session only (Phase 1); persistent per-day
 * accounting across reloads comes in Phase 3.
 */
@Injectable({ providedIn: 'root' })
export class StudyQueueService {
  private readonly store = inject(CollectionStore);
  private session: Session | null = null;

  start(deckId: string): boolean {
    const deck = this.store.deckById(deckId);
    if (!deck) {
      this.session = null;
      return false;
    }
    const prefix = deck.name + '::';
    const subtree = new Set(
      this.store
        .decks()
        .filter((d) => d.id === deck.id || d.name.startsWith(prefix))
        .map((d) => d.id),
    );
    const opts = this.store.optionsFor(deck) ?? this.store.defaultDeckOptions();
    if (!opts) {
      this.session = null;
      return false;
    }
    // Seed the day's allowance from what the subtree has already studied today,
    // so limits persist across reloads rather than resetting each session.
    const coll = this.store.collection();
    const today = coll ? todayNumber(coll) : 0;
    const { newRemaining, reviewRemaining } = remainingLimits(
      this.store.decks(),
      subtree,
      today,
      opts,
    );
    this.session = { deckId, subtree, opts, newRemaining, reviewRemaining };
    return true;
  }

  /** Starts a session spanning every deck, using the default options group. */
  startAll(): boolean {
    const decks = this.store.decks();
    const opts = this.store.defaultDeckOptions();
    if (decks.length === 0 || !opts) {
      this.session = null;
      return false;
    }
    const subtree = new Set(decks.map((d) => d.id));
    const coll = this.store.collection();
    const today = coll ? todayNumber(coll) : 0;
    const { newRemaining, reviewRemaining } = remainingLimits(
      decks,
      subtree,
      today,
      opts,
    );
    this.session = { deckId: 'all', subtree, opts, newRemaining, reviewRemaining };
    return true;
  }

  get options(): DeckOptions | null {
    return this.session?.opts ?? null;
  }

  private inScope(c: Card): boolean {
    return !!this.session && this.session.subtree.has(c.deckId);
  }

  /** The next card to present, or null when the session is finished. */
  next(ctx: ReviewContext): Card | null {
    if (this.store.collection()?.pausedAt != null) return null;
    const s = this.session;
    if (!s) return null;
    const cards = this.store.cards().filter((c) => this.inScope(c));

    // 1. Learning/relearning cards already due.
    const dueLearning = cards
      .filter((c) => c.queue === 'learning' && c.due <= ctx.now)
      .sort((a, b) => a.due - b.due);
    if (dueLearning.length) return dueLearning[0];

    // 2. Review cards due today (within the daily limit).
    if (s.reviewRemaining > 0) {
      const dueReview = cards
        .filter((c) => c.queue === 'review' && c.type === 'review' && c.due <= ctx.today)
        .sort((a, b) => a.due - b.due);
      if (dueReview.length) return dueReview[0];
    }

    // 3. New cards (within the daily limit).
    if (s.newRemaining > 0) {
      const news = cards
        .filter((c) => c.queue === 'new')
        .sort((a, b) => a.due - b.due);
      if (news.length) return news[0];
    }

    // 4. Learning cards due later today — surface the soonest so the session
    //    can be completed rather than stalling on a timer.
    const laterLearning = cards
      .filter((c) => c.queue === 'learning')
      .sort((a, b) => a.due - b.due);
    return laterLearning[0] ?? null;
  }

  /** Update session limits based on the card that was just answered. */
  onAnswered(preCard: Card): void {
    const s = this.session;
    if (!s) return;
    if (preCard.queue === 'new') {
      s.newRemaining = Math.max(0, s.newRemaining - 1);
    } else if (preCard.queue === 'review' && preCard.type === 'review') {
      s.reviewRemaining = Math.max(0, s.reviewRemaining - 1);
    }
  }

  /** Counts shown in the review header (respecting remaining daily limits). */
  counts(ctx: ReviewContext): QueueCounts {
    if (this.store.collection()?.pausedAt != null) return { new: 0, learning: 0, review: 0 };
    const s = this.session;
    if (!s) return { new: 0, learning: 0, review: 0 };
    const cards = this.store.cards().filter((c) => this.inScope(c));
    const learning = cards.filter((c) => c.queue === 'learning').length;
    const review = cards.filter(
      (c) => c.queue === 'review' && c.type === 'review' && c.due <= ctx.today,
    ).length;
    const news = cards.filter((c) => c.queue === 'new').length;
    return {
      new: Math.min(news, s.newRemaining),
      learning,
      review: Math.min(review, s.reviewRemaining),
    };
  }
}
