import { Injectable, computed, inject, signal } from '@angular/core';
import { lastValueFrom, timeout } from 'rxjs';

import { ApiService } from '../api.service';
import { backoffMs, classify, OUTBOX_KEY, parseState, REQUEST_TIMEOUT_MS } from './outbox-ops';
import type { OutboxOp, OutboxState } from './outbox-types';

@Injectable({ providedIn: 'root' })
export class OutboxService {
  private readonly api = inject(ApiService);

  readonly pending = signal<OutboxOp[]>([]);
  readonly failed = signal<OutboxOp[]>([]);
  readonly status = signal<'idle' | 'draining' | 'waiting' | 'error'>('idle');
  readonly pendingCount = computed(() => this.pending().length);
  readonly storageError = signal<string | null>(null);

  private drainPromise: Promise<void> | null = null;

  constructor() {
    // Restore state from localStorage on init
    const state = parseState(localStorage.getItem(OUTBOX_KEY));
    this.pending.set(state.ops);
    this.failed.set(state.failed);

    // Update status based on loaded state
    this.updateStatus();

    // Listen for online event and attempt to drain
    window.addEventListener('online', () => {
      void this.drain();
    });

    // Kick off initial drain
    void this.drain();
  }

  /**
   * Enqueue an operation synchronously. Persists to localStorage immediately
   * before returning. A QuotaExceededError sets the storageError signal and
   * never throws.
   */
  enqueue(op: Omit<OutboxOp, 'attempts' | 'failedReason' | 'createdAt'>): void {
    const newOp: OutboxOp = {
      ...op,
      attempts: 0,
      failedReason: null,
      createdAt: Date.now(),
    };

    this.pending.update((ops) => [...ops, newOp]);
    this.persist();
    void this.drain();
  }

  /**
   * Drain the pending queue, one operation at a time (FIFO). Only one drain
   * can run at a time. If a drain is already in flight, returns a promise
   * that waits for it to settle and then re-checks for more work.
   * Handles retries with exponential backoff and poison classification.
   */
  drain(): Promise<void> {
    if (this.drainPromise) {
      // A drain is in flight. Await it, then re-check: its loop may already
      // have exited before this op was enqueued, in which case start a fresh
      // run. Only do that when the exit was because the queue emptied — not
      // when it exited via the retry branch, which already scheduled its own
      // delayed `setTimeout(() => void this.drain(), retryDelay)` (Step 17 /
      // A5). Re-triggering unconditionally here would bypass that backoff and
      // fire a second attempt immediately; against a genuinely stalled
      // (not fail-fast) network, that second attempt stalls for another full
      // REQUEST_TIMEOUT_MS, so any caller coalesced onto this promise —
      // exactly what `Review.init()`'s `await this.outbox.drain()` does on
      // re-entry — never settles in bounded time.
      return this.drainPromise.then(() => {
        if (
          this.pending().length > 0 &&
          this.drainPromise === null &&
          this.status() !== 'waiting'
        ) {
          return this.drain();
        }
        return undefined;
      });
    }

    const p = this._runDrain().finally(() => {
      if (this.drainPromise === p) this.drainPromise = null;
    });
    this.drainPromise = p;
    return p;
  }

  /**
   * Private async function that performs the actual drain work.
   */
  private async _runDrain(): Promise<void> {
    while (this.pending().length > 0) {
      const op = this.pending()[0];
      this.status.set('draining');

      try {
        await lastValueFrom(
          this.api.send(op.method, op.path, op.body).pipe(timeout(REQUEST_TIMEOUT_MS)),
        );
        // Success: remove the op and continue
        this.pending.update((ops) => ops.slice(1));
        this.persist();
      } catch (err) {
        const errObj = err as Record<string, unknown>;
        const rawStatus = errObj['status'];
        const status = typeof rawStatus === 'number' ? rawStatus : null;
        const classification = classify(status);

        if (classification === 'poison') {
          // Poison: move to failed and continue
          const failedOp: OutboxOp = {
            ...op,
            failedReason: `HTTP ${status ?? 'unknown'}`,
          };
          this.pending.update((ops) => ops.slice(1));
          this.failed.update((ops) => [...ops, failedOp]);
          this.persist();
          this.updateStatus();
          // Continue with next op
        } else if (classification === 'retry') {
          // Retryable: increment attempts, persist, schedule backoff, and stop
          const retryDelay = this.getRetryDelay(err as Record<string, unknown>, op.attempts);
          this.pending.update((ops) => {
            const updated = [...ops];
            updated[0] = { ...updated[0], attempts: updated[0].attempts + 1 };
            return updated;
          });
          this.persist();
          this.status.set('waiting');
          setTimeout(() => void this.drain(), retryDelay);
          break;
        }
      }
    }

    // Queue is now empty
    this.updateStatus();
  }

  /**
   * Move all failed ops back to the tail of pending with fresh state
   * and kick off a drain.
   */
  retryFailed(): void {
    if (this.failed().length === 0) {
      return;
    }

    const resetOps = this.failed().map((op) => ({
      ...op,
      attempts: 0,
      failedReason: null,
    }));

    this.pending.update((ops) => [...ops, ...resetOps]);
    this.failed.set([]);
    this.persist();
    this.updateStatus();
    void this.drain();
  }

  /**
   * Persist the current state to localStorage. Sets storageError on failure
   * but never throws.
   */
  private persist(): void {
    try {
      const state: OutboxState = {
        version: 1,
        ops: this.pending(),
        failed: this.failed(),
      };
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(state));
      this.storageError.set(null);
    } catch (err) {
      const message = err instanceof DOMException ? err.message : 'Unknown storage error';
      this.storageError.set(message);
    }
  }

  /**
   * Update the status signal based on current state.
   */
  private updateStatus(): void {
    if (this.failed().length > 0) {
      this.status.set('error');
    } else if (this.pending().length === 0) {
      this.status.set('idle');
    }
  }

  /**
   * Get the retry delay in milliseconds. Checks for Retry-After header first,
   * then falls back to exponential backoff.
   */
  private getRetryDelay(err: Record<string, unknown>, attempts: number): number {
    const headers = err['headers'] as { get?: (key: string) => string | null } | undefined;
    const retryAfter = headers?.get?.('Retry-After');
    if (typeof retryAfter === 'string' && retryAfter.length > 0) {
      const retryAfterMs = parseInt(retryAfter, 10) * 1000;
      if (!isNaN(retryAfterMs)) {
        return Math.max(retryAfterMs, backoffMs(attempts + 1));
      }
    }
    return backoffMs(attempts + 1);
  }
}
