import { Injectable, inject } from '@angular/core';

import { CollectionStore, todayNumber } from '../collection.store';
import { schedulerFor } from '../scheduling/scheduler-factory';
import type { Card } from '../models';
import { RATINGS } from '../scheduling/types';
import type { Rating } from '../scheduling/types';
import { OutboxService } from './outbox.service';
import type { ConflictOutcome, OutboxOp } from './outbox-types';

/** Spec 025 D2 / AD-032: an original send plus at most two re-applied
 *  sends — original (0) → 409 → (1) → 409 → (2) → 409 → parked. */
export const MAX_REAPPLIES = 2;

/**
 * D8 seam: the outbox detects a 409 and delegates to this resolver, which
 * re-applies the rejected rating on top of the server's card at the
 * original answer instant (D10).
 *
 * Spec 025 / AD-032: the store is reloaded at most once per drain pass
 * (only a successful reload counts), and each review's lineage is
 * re-applied at most MAX_REAPPLIES times before it is parked in the
 * visible conflicts list. The bound follows the lineage, not the card: a
 * conflict legitimately cascades along an offline chain of one card.
 */
@Injectable({ providedIn: 'root' })
export class ConflictResolver {
  private readonly store = inject(CollectionStore);
  private readonly outbox = inject(OutboxService);

  private reloadedForPass: number | null = null;

  constructor() {
    // D8: register as the conflict handler.
    this.outbox.setConflictHandler((op, body, pass) => this.resolve(op, body, pass));
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

  async resolve(op: OutboxOp, body: unknown, pass: number): Promise<ConflictOutcome> {
    if (op.path !== '/review') {
      return { outcome: 'unresolved', reason: 'conflict on non-review path' };
    }

    // D2: bound per lineage, checked before anything spends the reload.
    const reapplies = op.reapplies ?? 0;
    if (reapplies >= MAX_REAPPLIES) {
      return { outcome: 'unresolved', reason: 'reapply limit reached' };
    }

    const serverCard = (body as Record<string, unknown> | null)?.['card'] as Card | undefined;
    if (!serverCard) {
      return { outcome: 'unresolved', reason: '409 without card' };
    }

    const revlog = this.extractRevlog(op);
    if (!revlog) {
      return { outcome: 'unresolved', reason: 'no revlog in op body' };
    }

    const rating = this.extractRating(revlog);
    if (rating === null) {
      return { outcome: 'unresolved', reason: 'invalid button' };
    }

    // D1: one successful reload per drain pass. load() swallows errors, so
    // a failed reload is not recorded and the next conflict retries it.
    if (this.reloadedForPass !== pass) {
      await this.store.load();
      if (this.store.error() === null) this.reloadedForPass = pass;
    }

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

    const applied: Card = { ...fresh, rev: freshRevlog.id };
    this.store.applyCard(applied);

    // Replace in place at the queue head, preserving FIFO (AD-029).
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
        reapplies: reapplies + 1,
      },
    };
  }
}
