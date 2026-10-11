/** An API mutation queued for delivery. Persisted verbatim. */
export interface OutboxOp {
  /** Client-minted and stable across retries. For a review op this is the
   *  `RevlogEntry.id`, so the client key and the server dedupe agree. */
  id: string;
  method: 'POST' | 'PATCH';
  /** Path relative to `/api` — e.g. `/review`, `/cards/c123`. */
  path: string;
  body: unknown;
  /** Epoch ms the op was created. FIFO tiebreak and UI age. */
  createdAt: number;
  /** Consecutive failed attempts; drives backoff. */
  attempts: number;
  /** Null while retryable; set once classified poison. */
  failedReason: string | null;
}

/** What is held in localStorage under `OUTBOX_KEY`. */
export interface OutboxState {
  version: 1;
  /** FIFO. Index 0 is the next op to send. */
  ops: OutboxOp[];
  /** Poisoned ops: retained, surfaced, never auto-deleted. */
  failed: OutboxOp[];
}
