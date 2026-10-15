import type { OutboxState, StoredOutboxState } from './outbox-types';

export const OUTBOX_KEY = 'srs.outbox.v1';

/**
 * HTTP request timeout for outbox operations, in milliseconds.
 * A hung request (no response, no error) would otherwise wedge the single-flight
 * drain queue permanently. This timeout ensures a stalled request becomes a
 * retryable failure rather than a permanent block.
 *
 * 15 seconds is conservative: a slow mobile connection should complete most
 * requests in that window, but a genuinely stuck connection self-heals within
 * 15 seconds instead of locking the queue until the app restarts.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export const EMPTY_STATE: OutboxState = { version: 1, ops: [], failed: [], conflicts: [] };

export function classify(status: number | null): 'ok' | 'retry' | 'poison' | 'conflict' {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 404 || status === 422) return 'poison';
  return 'retry';
}

export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

export function parseState(raw: string | null): StoredOutboxState {
  // Return deep copy of EMPTY_STATE for null
  if (raw === null) return JSON.parse(JSON.stringify(EMPTY_STATE)) as StoredOutboxState;

  try {
    const parsed = JSON.parse(raw) as unknown;

    // Check if it's an object
    if (typeof parsed !== 'object' || parsed === null) {
      return JSON.parse(JSON.stringify(EMPTY_STATE)) as StoredOutboxState;
    }

    const obj = parsed as Record<string, unknown>;
    // Check version
    if (obj['version'] !== 1) {
      return JSON.parse(JSON.stringify(EMPTY_STATE)) as StoredOutboxState;
    }

    // Check that ops and failed are arrays
    if (!Array.isArray(obj['ops']) || !Array.isArray(obj['failed'])) {
      return JSON.parse(JSON.stringify(EMPTY_STATE)) as StoredOutboxState;
    }

    // Widen the v1 shape backward-compatibly: a state written before spec 024
    // has no `conflicts`. Do NOT bump `version` — parseState returns
    // EMPTY_STATE for any version !== 1, which would silently DISCARD every
    // queued review in every existing client's localStorage.
    obj['conflicts'] = Array.isArray(obj['conflicts']) ? obj['conflicts'] : [];

    // Return deep copy of the parsed state
    return JSON.parse(JSON.stringify(obj)) as StoredOutboxState;
  } catch {
    // Invalid JSON or any other error
    return JSON.parse(JSON.stringify(EMPTY_STATE)) as StoredOutboxState;
  }
}
