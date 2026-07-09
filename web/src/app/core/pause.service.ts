import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { CollectionStore } from './collection.store';
import { computeResumeCardUpdates } from './pause-shift';

/** The absolute-`due` payload snapshotted to localStorage before a resume POST. */
interface ResumePayload {
  expectedPausedAt: number;
  cardUpdates: { id: string; due: number }[];
}

const KEY_PREFIX = 'resume-pending:';

/**
 * Orchestrates global pause / resume, plus crash-safe recovery.
 *
 * Pausing is the existing `PATCH /api/collection`; the shift on resume is
 * computed exactly once (from the cards' at-pause `due`), snapshotted to
 * localStorage keyed by `pausedAt`, then POSTed as absolute `due` targets.
 * Retry / recovery **re-sends the saved snapshot verbatim** — it never
 * recomputes, since a crash between the server's card-write and collection-write
 * leaves cards already shifted while `pausedAt` stays set, and re-applying the
 * absolute targets converges (no double-shift). See SPEC R11/R11a/R11b, D3.
 */
@Injectable({ providedIn: 'root' })
export class PauseService {
  private readonly api = inject(ApiService);
  private readonly store = inject(CollectionStore);

  /** Pause scheduling. No-op if already paused (never overwrite `pausedAt`). */
  async pause(): Promise<void> {
    const coll = this.store.collection();
    if (!coll || coll.pausedAt != null) return;
    const pausedAt = Date.now();
    await lastValueFrom(this.api.patchCollection({ pausedAt }));
    this.store.collection.set({ ...coll, pausedAt });
  }

  /**
   * Resume scheduling: compute the shift once, snapshot it, POST it, and on
   * success clear the pause + apply the shifted `due` to the cached cards.
   */
  async resume(): Promise<void> {
    const coll = this.store.collection();
    if (!coll || coll.pausedAt == null) return;
    const pausedAt = coll.pausedAt;

    const cardUpdates = computeResumeCardUpdates(coll, this.store.cards(), Date.now());
    const payload: ResumePayload = { expectedPausedAt: pausedAt, cardUpdates };

    // Snapshot the absolute payload before the POST so an interrupted resume is
    // recoverable (R11).
    localStorage.setItem(this.storageKey(pausedAt), JSON.stringify(payload));

    await this.applyResume(payload);
  }

  /**
   * On app load, complete an interrupted resume. If `pausedAt` is set and a
   * saved payload exists for that exact episode, re-send it (the only automatic
   * resume). If no saved payload exists, this is a normal never-resumed pause —
   * stay paused. Stale keys for other episodes are ignored, not pruned (R11a).
   */
  async recoverOnLoad(): Promise<void> {
    const coll = this.store.collection();
    if (!coll || coll.pausedAt == null) return;

    const raw = localStorage.getItem(this.storageKey(coll.pausedAt));
    if (raw == null) return;

    const payload = JSON.parse(raw) as ResumePayload;
    await this.applyResume(payload);
  }

  /**
   * Send an already-snapshotted payload to the resume endpoint, then on success
   * mirror the server's writes into the store and drop the snapshot. Shared by
   * `resume()` and `recoverOnLoad()` so recovery re-sends the exact saved bytes
   * rather than recomputing.
   */
  private async applyResume(payload: ResumePayload): Promise<void> {
    await lastValueFrom(this.api.resume(payload));

    const coll = this.store.collection();
    if (coll) this.store.collection.set({ ...coll, pausedAt: null });

    if (payload.cardUpdates.length) {
      const byId = new Map(payload.cardUpdates.map((u) => [u.id, u.due]));
      this.store.cards.update((cards) =>
        cards.map((c) => (byId.has(c.id) ? { ...c, due: byId.get(c.id)! } : c)),
      );
    }

    localStorage.removeItem(this.storageKey(payload.expectedPausedAt));
  }

  private storageKey(pausedAt: number): string {
    return KEY_PREFIX + pausedAt;
  }
}
