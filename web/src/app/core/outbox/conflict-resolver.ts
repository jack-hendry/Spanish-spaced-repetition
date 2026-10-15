import { Injectable, effect, inject } from '@angular/core';

import { CollectionStore, todayNumber } from '../collection.store';
import { schedulerFor } from '../scheduling/scheduler-factory';
import type { Card } from '../models';
import { RATINGS } from '../scheduling/types';
import type { Rating } from '../scheduling/types';
import { OutboxService } from './outbox.service';
import type { ConflictOutcome, OutboxOp } from './outbox-types';

/**
 * D8 seam: the outbox detects a 409 and delegates to this resolver.
 * Resolves conflicts by reloading the collection once per stale snapshot,
 * then re-applying the rejected rating at the original answer instant (D10).
 *
 * Bounded at 2 reload cycles per drain pass to avoid retry loops that
 * exhaust the tier-1 rate limiter's budget. Once exhausted, the op moves
 * to the visible conflicts list (A6).
 */
@Injectable({ providedIn: 'root' })
export class ConflictResolver {
  private readonly store = inject(CollectionStore);
  private readonly outbox = inject(OutboxService);

  private reloadsThisPass = 0;

  constructor() {
    // D8: register as the conflict handler. Both parameters must be declared
    // or this does not compile.
    this.outbox.setConflictHandler((op, body) => this.resolve(op, body));

    // Reset the per-pass reload budget when the queue empties, i.e. when the
    // drain pass is over. An effect() reacts to the signal itself, not polling.
    effect(() => {
      if (this.outbox.pendingCount() === 0) {
        this.reloadsThisPass = 0;
      }
    });
  }

  private extractRevlog(op: OutboxOp): Record<string, unknown> | null {
    const revlog = (op.body as Record<string, unknown> | null)?.['revlog'] as
      | Record<string, unknown>
      | undefined;
    return revlog ?? null;
  }

  private extractRating(revlog: Record<string, unknown>): Rating | null {
    const button = revlog['button'] as number | undefined;
    if (typeof button !== 'number' || button < 1 || button > 4) {
      return null;
    }
    return RATINGS[button - 1];
  }

  private extractTimingInfo(revlog: Record<string, unknown>): {
    reviewedAt: number;
    timeMs: number;
  } {
    const reviewedAt = (revlog['reviewedAt'] as number | undefined) ?? Date.now();
    const timeMs = (revlog['timeMs'] as number | undefined) ?? 0;
    return { reviewedAt, timeMs };
  }

  async resolve(op: OutboxOp, body: unknown): Promise<ConflictOutcome> {
    // Non-/review path → unresolved
    if (op.path !== '/review') {
      return { outcome: 'unresolved', reason: 'conflict on non-review path' };
    }

    // Budget check: 2 reloads per drain pass
    if (this.reloadsThisPass >= 2) {
      return { outcome: 'unresolved', reason: 'reload budget exhausted' };
    }

    // Reload once per stale snapshot (Step 5 makes this await real)
    await this.store.load();
    this.reloadsThisPass++;

    // Read the server card from the 409 body
    const serverCard = (body as Record<string, unknown> | null)?.['card'] as Card | undefined;
    if (!serverCard) {
      return { outcome: 'unresolved', reason: '409 without card' };
    }

    // Recover the rating from the queued op
    const revlog = this.extractRevlog(op);
    if (!revlog) {
      return { outcome: 'unresolved', reason: 'no revlog in op body' };
    }

    const rating = this.extractRating(revlog);
    if (rating === null) {
      return { outcome: 'unresolved', reason: 'invalid button' };
    }

    // Resolve deck options: two lookups per the step
    const deck = this.store.deckById(serverCard.deckId);
    if (deck === undefined) {
      return { outcome: 'unresolved', reason: 'unknown deck' };
    }

    const opts = this.store.optionsFor(deck) ?? this.store.defaultDeckOptions();
    if (opts === undefined) {
      return { outcome: 'unresolved', reason: 'no deck options' };
    }

    // D10: re-schedule at the original answer instant, not Date.now()
    const coll = this.store.collection();
    if (coll === null) {
      return { outcome: 'unresolved', reason: 'no collection' };
    }

    const { reviewedAt, timeMs } = this.extractTimingInfo(revlog);
    const ctx = { now: reviewedAt, today: todayNumber(coll, reviewedAt) };
    const { card: fresh, revlog: freshRevlog } = schedulerFor(opts).answer(
      serverCard,
      rating,
      opts,
      ctx,
      timeMs,
    );

    // Apply the fresh card with the fresh revlog id
    const applied: Card = { ...fresh, rev: freshRevlog.id };
    this.store.applyCard(applied);

    // Return the replacement op, preserving FIFO order (AD-029)
    return {
      outcome: 'replaced',
      replacement: {
        id: freshRevlog.id,
        method: 'POST',
        path: '/review',
        body: {
          card: applied,
          revlog: freshRevlog,
          expectedRev: serverCard.rev ?? null,
        },
      },
    };
  }
}
