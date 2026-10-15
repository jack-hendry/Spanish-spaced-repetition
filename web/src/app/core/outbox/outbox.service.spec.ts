import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ApiService } from '../api.service';
import { OutboxService } from './outbox.service';
import { OUTBOX_KEY } from './outbox-ops';
import type { OutboxOp } from './outbox-types';

function setup(): {
  service: OutboxService;
  send: Mock<(method: string, path: string, body: unknown) => Observable<unknown>>;
} {
  const send = vi.fn<(method: string, path: string, body: unknown) => Observable<unknown>>(() =>
    of({}),
  );
  const api = { send } satisfies Pick<ApiService, 'send'>;

  TestBed.configureTestingModule({
    providers: [{ provide: ApiService, useValue: api }],
  });
  const service = TestBed.inject(OutboxService);
  return { service, send };
}

describe('OutboxService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  // T1: enqueue writes to localStorage before returning
  it('enqueue writes to localStorage synchronously before returning', () => {
    const { service } = setup();

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { cardId: 'c1' },
    });

    // Assert localStorage was written in the same tick
    const stored = localStorage.getItem(OUTBOX_KEY);
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!) as Record<string, unknown>;
    expect((state['ops'] as unknown[]).length).toBe(1);
    expect((state['ops'] as Record<string, unknown>[])[0]['id']).toBe('op1');
    expect((state['ops'] as Record<string, unknown>[])[0]['attempts']).toBe(0);
    expect((state['ops'] as Record<string, unknown>[])[0]['failedReason']).toBeNull();
  });

  // T2: Service restores from pre-seeded localStorage
  it('restores pending and failed ops from localStorage on construction', () => {
    const existing: OutboxOp = {
      id: 'existing',
      method: 'POST',
      path: '/cards',
      body: {},
      attempts: 2,
      failedReason: null,
      createdAt: Date.now() - 10000,
    };
    const failed: OutboxOp = {
      id: 'failed-op',
      method: 'PATCH',
      path: '/cards/c1',
      body: {},
      attempts: 3,
      failedReason: 'HTTP 404',
      createdAt: Date.now() - 20000,
    };

    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify({
        version: 1,
        ops: [existing],
        failed: [failed],
      }),
    );

    const { service } = setup();

    expect(service.pending()).toHaveLength(1);
    expect(service.pending()[0]).toEqual(existing);
    expect(service.failed()).toHaveLength(1);
    expect(service.failed()[0]).toEqual(failed);
  });

  // T3: FIFO under failure — A fails retryably, B not attempted
  it('FIFO under failure: only head is attempted, B waits for A to retry', async () => {
    vi.useRealTimers(); // Disable fake timers for this test

    const { service, send } = setup();

    // A fails with 500 (retryable), B never called initially
    send.mockImplementationOnce(() => throwError(() => ({ status: 500, message: 'Server error' })));

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    // Wait for the enqueue-triggered drain to complete and fail
    await new Promise((resolve) => setTimeout(resolve, 10));

    // api.send should be called exactly once, with A only
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(['POST', '/review', { a: 1 }]);

    // B should still be in pending
    expect(service.pending()).toHaveLength(2);
    expect(service.pending()[0].id).toBe('A');
    expect(service.pending()[1].id).toBe('B');

    // A should have incremented attempts
    expect(service.pending()[0].attempts).toBe(1);

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T4: Retry after backoff succeeds, both land in order
  it('retry after backoff succeeds and drains B', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const { service, send } = setup();

    // First call to A fails with 500 (retryable)
    send.mockImplementationOnce(() => throwError(() => ({ status: 500, message: 'Server error' })));
    // Second call to A succeeds
    send.mockImplementationOnce(() => of({}));
    // Third call to B succeeds
    send.mockImplementationOnce(() => of({}));

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    // Wait for initial drain to fail and schedule retry
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A should have been called, failed, scheduled retry
    expect(send).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe('waiting');
    expect(service.pending()).toHaveLength(2);

    // Wait for backoff timeout (attempts=1 → 2000ms backoff)
    await new Promise((resolve) => setTimeout(resolve, 2100));

    // Now both should be drained
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1]).toEqual(['POST', '/review', { a: 1 }]);
    expect(send.mock.calls[2]).toEqual(['POST', '/review', { b: 2 }]);

    // Queue should be empty
    expect(service.pending()).toHaveLength(0);
    expect(service.status()).toBe('idle');

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T5: 404 moves op to failed, next op still drains
  it('404 (poison) moves op to failed and continues with next', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const { service, send } = setup();

    // A fails with 404 (poison)
    send.mockImplementationOnce(() => throwError(() => ({ status: 404, message: 'Not found' })));
    // B succeeds
    send.mockImplementationOnce(() => of({}));

    service.enqueue({
      id: 'A',
      method: 'PATCH',
      path: '/cards/c1',
      body: { ease: 2500 },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    // Wait for drain to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Both should have been attempted
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(['PATCH', '/cards/c1', { ease: 2500 }]);
    expect(send.mock.calls[1]).toEqual(['POST', '/review', { b: 2 }]);

    // A should be in failed, B should be gone
    expect(service.pending()).toHaveLength(0);
    expect(service.failed()).toHaveLength(1);
    expect(service.failed()[0].id).toBe('A');
    expect(service.failed()[0].failedReason).toBe('HTTP 404');

    // Status should be error since failed is non-empty
    expect(service.status()).toBe('error');

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T6: localStorage.setItem throwing sets storageError, doesn't throw
  it('localStorage.setItem error sets storageError signal without throwing', () => {
    const originalSetItem = Storage.prototype.setItem;
    let outboxCallCount = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === OUTBOX_KEY) {
        outboxCallCount++;
        // Throw on the second call to the outbox key
        if (outboxCallCount === 2) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        }
      }
      originalSetItem.call(this, key, value);
    };

    try {
      const { service } = setup();

      // First enqueue should succeed
      service.enqueue({
        id: 'op1',
        method: 'POST',
        path: '/review',
        body: {},
      });

      // Second enqueue should fail on persist and set storageError
      expect(() => {
        service.enqueue({
          id: 'op2',
          method: 'POST',
          path: '/review',
          body: {},
        });
      }).not.toThrow();

      expect(service.storageError()).toBe('QuotaExceededError');
    } finally {
      // Restore
      Storage.prototype.setItem = originalSetItem;
    }
  });

  // T7: Multiple ops enqueued correctly
  it('multiple enqueues persist each operation in order', () => {
    const { service } = setup();

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    service.enqueue({
      id: 'op2',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    const stored = localStorage.getItem(OUTBOX_KEY);
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!) as Record<string, unknown>;
    expect((state['ops'] as unknown[]).length).toBe(2);
    expect((state['ops'] as Record<string, unknown>[])[0]['id']).toBe('op1');
    expect((state['ops'] as Record<string, unknown>[])[1]['id']).toBe('op2');
  });

  // T8: retryFailed moves failed ops back to pending
  it('retryFailed moves all failed ops to tail of pending with reset state', () => {
    const { service } = setup();

    // Enqueue and fail some ops
    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/cards',
      body: {},
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: {},
    });

    // Manually move A to failed (simulate a prior failure)
    const pendingA = service.pending()[0];
    service.pending.update((ops) => ops.slice(1));
    service.failed.update((ops) => [
      ...ops,
      { ...pendingA, attempts: 3, failedReason: 'HTTP 422' },
    ]);

    expect(service.pending()).toHaveLength(1);
    expect(service.failed()).toHaveLength(1);

    // Call retryFailed, which internally calls persist()
    service.retryFailed();

    // A should be back in pending at the tail with reset state
    expect(service.pending()).toHaveLength(2);
    expect(service.failed()).toHaveLength(0);
    expect(service.pending()[1].id).toBe('A');
    expect(service.pending()[1].attempts).toBe(0);
    expect(service.pending()[1].failedReason).toBeNull();

    // Verify the state was persisted to localStorage by retryFailed()
    const storedJson = localStorage.getItem('srs.outbox.v1');
    expect(storedJson).not.toBeNull();
    const stored = JSON.parse(storedJson ?? '{}') as {
      version?: number;
      ops?: OutboxOp[];
      failed?: OutboxOp[];
    };
    expect(stored.version).toBe(1);
    expect(stored.ops).toBeDefined();
    expect(stored.failed).toBeDefined();
    expect(stored.ops).toHaveLength(2);
    expect(stored.failed).toHaveLength(0);
    expect(stored.ops![1].id).toBe('A');
    expect(stored.ops![1].attempts).toBe(0);
    expect(stored.ops![1].failedReason).toBeNull();
  });

  // T9: status transitions correctly
  it('status transitions from idle to draining to waiting during retry backoff', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const { service, send } = setup();

    expect(service.status()).toBe('idle');

    // Fail with 500 (retryable)
    send.mockImplementationOnce(() => throwError(() => ({ status: 500 })));

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: {},
    });

    // Wait for drain to fail and schedule backoff
    await new Promise((resolve) => setTimeout(resolve, 10));

    // After drain attempt, status should be waiting (backoff scheduled)
    expect(service.status()).toBe('waiting');

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T10: Retry-After header is respected if larger than backoff
  it('moves op to failed if no recovery possible after retries', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const { service, send } = setup();

    // Fail with 422 (poison)
    send.mockImplementationOnce(() =>
      throwError(() => ({
        status: 422,
        message: 'Unprocessable entity',
      })),
    );

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: {},
    });

    // Wait for drain to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should move to failed
    expect(service.pending()).toHaveLength(0);
    expect(service.failed()).toHaveLength(1);
    expect(service.failed()[0].failedReason).toBe('HTTP 422');

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T11: Regression test — second drain() call must await the first to complete
  it('second await drain() must await in-flight drain, not return early', () => {
    const { service, send } = setup();

    let sendCalled = false;

    send.mockImplementation(() => {
      sendCalled = true;
      return of({});
    });

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // Call drain twice rapidly
    const p1 = service.drain();
    const p2 = service.drain();

    // Both promises should eventually resolve (with or without being the same)
    // The key test: p2 should also resolve after the drain completes,
    // not instantly due to early return
    return Promise.all([p1, p2]).then(() => {
      // If p2 returned early due to the defect, send might not have been called yet
      // With the fix, both awaiters should wait for the actual drain
      expect(sendCalled).toBe(true);
      expect(service.pending()).toHaveLength(0);
    });
  });

  // T12: Request that never settles (hangs) causes attempts to increment and retry to schedule
  it('a hanging request (never settles) increments attempts and schedules retry', async () => {
    const { service, send } = setup();

    // Return an observable that never emits or errors (simulates a hung request)
    send.mockImplementationOnce(() => NEVER);

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // Start the drain
    void service.drain();

    // Advance time to trigger the timeout (15 seconds)
    vi.advanceTimersByTime(15_100);

    // Run all pending async operations to let the timeout error propagate
    await vi.runOnlyPendingTimersAsync();

    // Op should still be in pending (not moved to failed) with attempts incremented
    expect(service.pending()).toHaveLength(1);
    expect(service.pending()[0].id).toBe('op1');
    expect(service.pending()[0].attempts).toBe(1);

    // Status should be waiting (retry scheduled)
    expect(service.status()).toBe('waiting');
  });

  // T13: After a timeout, a subsequent drain() can still make progress
  it('after a timeout, a subsequent drain() can make progress', async () => {
    const { service, send } = setup();

    // First call: hang
    send.mockImplementationOnce(() => NEVER);
    // Second call: succeed
    send.mockImplementationOnce(() => of({}));

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // Start the drain
    void service.drain();

    // Run all timers to trigger the timeout and subsequent backoff
    await vi.runAllTimersAsync();

    // Op should be gone; the second drain should have succeeded
    expect(service.pending()).toHaveLength(0);
    expect(service.status()).toBe('idle');

    // api.send should have been called twice (hung first attempt, then success)
    expect(send).toHaveBeenCalledTimes(2);
  });

  // T14: A timeout does not move the op to failed
  it('a timeout does not move the op to failed', async () => {
    const { service, send } = setup();

    // Return an observable that never emits or errors (simulates a hung request)
    send.mockImplementationOnce(() => NEVER);

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // Start the drain
    void service.drain();

    // Advance time just past the timeout (15 seconds) to trigger the timeout
    vi.advanceTimersByTime(15_100);

    // Wait for the drain to settle
    await Promise.resolve();

    // Op should still be in pending, not in failed
    expect(service.pending()).toHaveLength(1);
    expect(service.failed()).toHaveLength(0);
  });

  // T15: Regression for Step 17 (A5) — leaving a deck and re-entering it
  // while a prior attempt is genuinely stalled (not fail-fast) must not hang
  // beyond the single REQUEST_TIMEOUT_MS window. This is what
  // `Review.init()`'s `await this.outbox.drain()` does on re-entry: it calls
  // `drain()` while an earlier drain (fired from `enqueue`) is still in
  // flight, hitting the coalescing branch at the top of `drain()`. A
  // fail-fast `throwError` scratch repro settled this branch fine (dead
  // hypothesis); a stalled `NEVER` observable does not, because the
  // coalescing branch re-invokes `drain()` the instant the first attempt
  // settles, without checking whether a backoff retry is already scheduled
  // — bypassing backoff and stacking a second full stall on top of the first.
  it('a concurrent drain() call settles at the single timeout, not a second bypassed retry', async () => {
    const { service, send } = setup();

    // Let the constructor's own initial (empty-queue) drain() settle first —
    // in the real app, plenty of time has passed since boot by the time the
    // user re-enters a deck, so this isn't racing that trivial first call.
    await Promise.resolve();
    await Promise.resolve();

    // Every attempt hangs — simulates a genuinely offline network, not a
    // fail-fast error (the already-dead hypothesis).
    send.mockImplementation(() => NEVER);

    service.enqueue({ id: 'A', method: 'POST', path: '/review', body: { a: 1 } });

    // Simulate Review.init() re-entering and calling drain() again while the
    // attempt fired synchronously inside enqueue() is still in flight.
    let settled = false;
    const p2 = service.drain().then(() => {
      settled = true;
    });

    // Advance just past the single REQUEST_TIMEOUT_MS window (15s).
    await vi.advanceTimersByTimeAsync(15_100);

    expect(settled).toBe(true);
    // Only the one hung attempt should have fired within this window. A
    // backoff-bypassing bug fires a second attempt immediately when the
    // first settles, which needs a second full 15s timeout to itself settle
    // — so `settled` would still be false and `send` would have been called
    // twice by this point.
    expect(send).toHaveBeenCalledTimes(1);
    expect(service.pending()).toHaveLength(1);
    expect(service.pending()[0].attempts).toBe(1);
    expect(service.status()).toBe('waiting');

    await p2;
  });

  // T16: Regression — a real HttpHeaders instance on the error must not
  // crash getRetryDelay(). Extracting `headers.get` into a bare variable and
  // calling it later detaches it from `this`, and the real HttpHeaders.get()
  // implementation calls `this.init()` internally, throwing
  // "Cannot read properties of undefined (reading 'init')" with no catch
  // around it in `_runDrain()`'s own catch block — so drain() rejects
  // instead of resolving. A plain-object `headers` mock (as used elsewhere
  // in this file) never exercises the real bound-method requirement and
  // would not have caught this.
  it('a retryable error carrying a real HttpHeaders instance does not crash the retry path', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const { service, send } = setup();

    const realError = new HttpErrorResponse({
      status: 0,
      headers: new HttpHeaders(),
    });
    send.mockImplementationOnce(() => throwError(() => realError));

    service.enqueue({
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // drain() must resolve, not reject, even though the underlying error
    // carries a real HttpHeaders whose .get() depends on `this`.
    await expect(service.drain()).resolves.toBeUndefined();

    // The op should still be pending with attempts incremented and a retry
    // scheduled — i.e. the retry path ran to completion instead of throwing
    // partway through.
    expect(service.pending()).toHaveLength(1);
    expect(service.pending()[0].id).toBe('op1');
    expect(service.pending()[0].attempts).toBe(1);
    expect(service.status()).toBe('waiting');

    vi.useFakeTimers(); // Re-enable for next tests
  });

  // T17: 409 with no handler registered → parks op in conflicts with 'no resolver'
  it('409 with no handler registered parks op in conflicts with "no resolver"', async () => {
    vi.useRealTimers();

    const { service, send } = setup();

    // A fails with 409 (conflict), no handler registered
    const conflictError = new HttpErrorResponse({
      status: 409,
      headers: new HttpHeaders(),
      error: { error: 'stale card', card: { id: 'c1', rev: 'old' } },
    });
    send.mockImplementationOnce(() => throwError(() => conflictError));
    // B succeeds
    send.mockImplementationOnce(() => of({}));

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { expectedRev: 'old' },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    // Wait for drain to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A should be in conflicts, B should have been attempted
    expect(service.pending()).toHaveLength(0);
    expect(service.conflicts()).toHaveLength(1);
    expect(service.conflicts()[0].id).toBe('A');
    expect(service.conflicts()[0].conflictReason).toBe('no resolver');
    // B was attempted and succeeded
    expect(send).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
  });

  // T18: 409 with handler returning 'replaced' substitutes at queue head and drains
  it('409 with handler returning "replaced" substitutes op at head and queue drains', async () => {
    vi.useRealTimers();

    const { service, send } = setup();

    const conflictError = new HttpErrorResponse({
      status: 409,
      headers: new HttpHeaders(),
      error: { error: 'stale card', card: { id: 'c1', rev: 'new' } },
    });
    send.mockImplementationOnce(() => throwError(() => conflictError));
    // After replacement, the new op succeeds
    send.mockImplementationOnce(() => of({}));
    // B also succeeds
    send.mockImplementationOnce(() => of({}));

    const handler = vi.fn(async (op: OutboxOp, body: unknown) => {
      void op;
      void body;
      return {
        outcome: 'replaced' as const,
        replacement: {
          id: 'A-replaced',
          method: 'POST' as const,
          path: '/review',
          body: { expectedRev: 'new' },
        },
      };
    });
    service.setConflictHandler(handler);

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { expectedRev: 'old' },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // A should be gone (replaced), B should be gone (succeeded)
    expect(service.pending()).toHaveLength(0);
    expect(service.conflicts()).toHaveLength(0);
    // Three calls: first A fails with 409, then replaced A succeeds, then B succeeds
    expect(send).toHaveBeenCalledTimes(3);
    // Second call should be with the replacement (new expectedRev)
    expect(send.mock.calls[1]).toEqual(['POST', '/review', { expectedRev: 'new' }]);
    // Handler was called
    expect(handler).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
  });

  // T19: 409 with handler returning 'unresolved' parks op with reason, queue behind drains
  it('409 with handler returning "unresolved" parks op in conflicts and drains behind it', async () => {
    vi.useRealTimers();

    const { service, send } = setup();

    const conflictError = new HttpErrorResponse({
      status: 409,
      headers: new HttpHeaders(),
      error: { error: 'stale card' },
    });
    send.mockImplementationOnce(() => throwError(() => conflictError));
    // B succeeds
    send.mockImplementationOnce(() => of({}));

    const handler = vi.fn(async (op: OutboxOp, body: unknown) => {
      void op;
      void body;
      return {
        outcome: 'unresolved' as const,
        reason: 'reload budget exhausted',
      };
    });
    service.setConflictHandler(handler);

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });
    service.enqueue({
      id: 'B',
      method: 'POST',
      path: '/review',
      body: { b: 2 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // A should be in conflicts with handler's reason, B should be gone
    expect(service.pending()).toHaveLength(0);
    expect(service.conflicts()).toHaveLength(1);
    expect(service.conflicts()[0].id).toBe('A');
    expect(service.conflicts()[0].conflictReason).toBe('reload budget exhausted');
    // Handler was called
    expect(handler).toHaveBeenCalledTimes(1);
    // B was attempted and succeeded
    expect(send).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
  });

  // T20: 409 does NOT increment attempts and does NOT schedule setTimeout backoff (A7)
  it('409 does not increment attempts and does not schedule setTimeout backoff', async () => {
    vi.useRealTimers();

    const { service, send } = setup();

    const conflictError = new HttpErrorResponse({
      status: 409,
      headers: new HttpHeaders(),
      error: { error: 'stale card' },
    });
    send.mockImplementationOnce(() => throwError(() => conflictError));

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    // Wait for drain to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Op should be in conflicts, not pending
    expect(service.conflicts()).toHaveLength(1);
    expect(service.pending()).toHaveLength(0);

    // A7: attempts must NOT be incremented for a 409
    expect(service.conflicts()[0].attempts).toBe(0);

    // A7: no setTimeout should be scheduled (status should not be 'waiting')
    expect(service.status()).toBe('idle');

    vi.useFakeTimers();
  });

  // T21: conflictCount increments on 409
  it('conflictCount increments on 409', async () => {
    vi.useRealTimers();

    const { service, send } = setup();

    expect(service.conflictCount()).toBe(0);

    const conflictError = new HttpErrorResponse({
      status: 409,
      headers: new HttpHeaders(),
      error: { error: 'stale card' },
    });
    send.mockImplementationOnce(() => throwError(() => conflictError));

    service.enqueue({
      id: 'A',
      method: 'POST',
      path: '/review',
      body: { a: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(service.conflictCount()).toBe(1);

    vi.useFakeTimers();
  });
});
