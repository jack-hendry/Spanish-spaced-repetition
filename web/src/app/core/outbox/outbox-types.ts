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
  /** Reason why the op is in the conflicts list (e.g., 'no resolver', or a
   *  ConflictHandler's unresolved reason). Only set for ops moved to conflicts. */
  conflictReason?: string;
  /** How many times ConflictResolver has re-applied this review's lineage.
   *  Carried onto each replacement op; absent = 0 (ops queued before spec
   *  025). Bounds a ping-pong per review, not per drain pass (AD-032). */
  reapplies?: number;
}

/** The shape of what is read from localStorage — conflicts may be absent in
 *  pre-spec-024 stored states. */
export interface StoredOutboxState {
  version: 1;
  /** FIFO. Index 0 is the next op to send. */
  ops: OutboxOp[];
  /** Poisoned ops: retained, surfaced, never auto-deleted. */
  failed: OutboxOp[];
  /** Conflicted ops (409s) that require resolution. Retained, surfaced, never
   *  auto-deleted. Unlike 'failed' (which user can retry), conflicts require
   *  special handling from a ConflictHandler or manual review. Optional for
   *  backward compatibility with pre-spec-024 stored states. */
  conflicts?: OutboxOp[];
}

/** In-app shape: conflicts is guaranteed to be present (defaulted if missing). */
export interface OutboxState {
  version: 1;
  /** FIFO. Index 0 is the next op to send. */
  ops: OutboxOp[];
  /** Poisoned ops: retained, surfaced, never auto-deleted. */
  failed: OutboxOp[];
  /** Conflicted ops (409s) that require resolution. Retained, surfaced, never
   *  auto-deleted. Unlike 'failed' (which user can retry), conflicts require
   *  special handling from a ConflictHandler or manual review. */
  conflicts: OutboxOp[];
}

/** D8 seam: the outbox detects a 409 and delegates. `replaced` substitutes
 *  the op IN PLACE at the queue head, preserving FIFO (AD-029). */
export type ConflictOutcome =
  | { outcome: 'replaced'; replacement: Omit<OutboxOp, 'attempts' | 'failedReason' | 'createdAt'> }
  | { outcome: 'unresolved'; reason: string };

/** `pass` identifies the `_runDrain()` invocation the conflict arose in, so
 *  the resolver can reload at most once per pass (spec 025 D1, AD-032). */
export type ConflictHandler = (
  op: OutboxOp,
  body: unknown,
  pass: number,
) => Promise<ConflictOutcome>;
