import { describe, expect, it } from 'vitest';

import { backoffMs, classify, EMPTY_STATE, OUTBOX_KEY, parseState } from './outbox-ops';
import type { OutboxOp, OutboxState } from './outbox-types';

describe('classify', () => {
  describe('retry cases', () => {
    it('returns "retry" for null (network error)', () => {
      expect(classify(null)).toBe('retry');
    });

    it('returns "retry" for 401 (credentials may come back)', () => {
      expect(classify(401)).toBe('retry');
    });

    it('returns "retry" for 403 (permissions may change)', () => {
      expect(classify(403)).toBe('retry');
    });

    it('returns "retry" for 408 (request timeout)', () => {
      expect(classify(408)).toBe('retry');
    });

    it('returns "retry" for 429 (rate limit)', () => {
      expect(classify(429)).toBe('retry');
    });

    it('returns "retry" for 500 (server error)', () => {
      expect(classify(500)).toBe('retry');
    });

    it('returns "retry" for 503 (service unavailable)', () => {
      expect(classify(503)).toBe('retry');
    });

    it('returns "retry" for boundary 399 (below 200)', () => {
      expect(classify(399)).toBe('retry');
    });

    it('returns "retry" for 0 (unknown error)', () => {
      expect(classify(0)).toBe('retry');
    });
  });

  describe('ok cases', () => {
    it('returns "ok" for 200 (success)', () => {
      expect(classify(200)).toBe('ok');
    });

    it('returns "ok" for 201 (created)', () => {
      expect(classify(201)).toBe('ok');
    });

    it('returns "ok" for 204 (no content)', () => {
      expect(classify(204)).toBe('ok');
    });

    it('returns "ok" for 299 (end of 2xx range)', () => {
      expect(classify(299)).toBe('ok');
    });
  });

  describe('poison cases', () => {
    it('returns "poison" for 400 (bad request)', () => {
      expect(classify(400)).toBe('poison');
    });

    it('returns "poison" for 404 (not found)', () => {
      expect(classify(404)).toBe('poison');
    });

    it('returns "poison" for 422 (unprocessable entity)', () => {
      expect(classify(422)).toBe('poison');
    });

    it('returns "retry" for boundary 399 (not poison)', () => {
      expect(classify(399)).toBe('retry');
    });

    it('returns "retry" for boundary 423 (not poison)', () => {
      expect(classify(423)).toBe('retry');
    });
  });

  describe('conflict cases', () => {
    it('returns "conflict" for 409 (conflict)', () => {
      expect(classify(409)).toBe('conflict');
    });

    it('returns "retry" for boundary 408 (not conflict)', () => {
      expect(classify(408)).toBe('retry');
    });

    it('returns "retry" for boundary 410 (not conflict)', () => {
      expect(classify(410)).toBe('retry');
    });
  });
});

describe('backoffMs', () => {
  it('returns 2000ms floor for attempt 1', () => {
    expect(backoffMs(1)).toBe(2000);
  });

  it('returns 4000ms for attempt 2', () => {
    expect(backoffMs(2)).toBe(4000);
  });

  it('returns correct ms for attempt 5', () => {
    // 2000 * 2^4 = 2000 * 16 = 32000
    expect(backoffMs(5)).toBe(32000);
  });

  it('caps at 60000ms for attempt 20', () => {
    // 2000 * 2^19 = huge, capped at 60000
    expect(backoffMs(20)).toBe(60000);
  });

  it('respects the 60000ms cap', () => {
    expect(backoffMs(50)).toBe(60000);
  });

  it('maintains 2000ms floor (attempt 0 or negative)', () => {
    // Math.max(0, -1) = 0, so 2000 * 2^0 = 2000
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(-1)).toBe(2000);
  });
});

describe('parseState', () => {
  it('returns deep copy of EMPTY_STATE for null', () => {
    const result = parseState(null);
    expect(result).toEqual(EMPTY_STATE);
    expect(result).not.toBe(EMPTY_STATE);
  });

  it('returns deep copy of EMPTY_STATE for invalid JSON', () => {
    const result = parseState('not valid json {');
    expect(result).toEqual(EMPTY_STATE);
    expect(result).not.toBe(EMPTY_STATE);
  });

  it('returns deep copy of EMPTY_STATE for non-object', () => {
    expect(parseState('null')).toEqual(EMPTY_STATE);
    expect(parseState('123')).toEqual(EMPTY_STATE);
    expect(parseState('"string"')).toEqual(EMPTY_STATE);
    expect(parseState('[]')).toEqual(EMPTY_STATE);
  });

  it('returns deep copy of EMPTY_STATE for version !== 1', () => {
    const result = parseState(JSON.stringify({ version: 2, ops: [], failed: [] }));
    expect(result).toEqual(EMPTY_STATE);
    expect(result).not.toBe(EMPTY_STATE);
  });

  it('returns deep copy of EMPTY_STATE when ops is not an array', () => {
    const result = parseState(JSON.stringify({ version: 1, ops: {}, failed: [] }));
    expect(result).toEqual(EMPTY_STATE);
    expect(result).not.toBe(EMPTY_STATE);
  });

  it('returns deep copy of EMPTY_STATE when failed is not an array', () => {
    const result = parseState(JSON.stringify({ version: 1, ops: [], failed: 'not array' }));
    expect(result).toEqual(EMPTY_STATE);
    expect(result).not.toBe(EMPTY_STATE);
  });

  it('returns deep copy for valid populated state', () => {
    const op: OutboxOp = {
      id: 'op1',
      method: 'POST',
      path: '/review',
      body: { card: 'c1' },
      createdAt: 1000,
      attempts: 2,
      failedReason: null,
    };
    const state: OutboxState = {
      version: 1,
      ops: [op],
      failed: [],
      conflicts: [],
    };
    const serialized = JSON.stringify(state);
    const result = parseState(serialized);

    expect(result).toEqual(state);
    expect(result).not.toBe(state);
    expect(result.ops[0]).not.toBe(op);
  });

  it('round-trips a state through stringify and parse', () => {
    const original: OutboxState = {
      version: 1,
      ops: [
        {
          id: 'op1',
          method: 'POST',
          path: '/review',
          body: { card: 'c1' },
          createdAt: 1000,
          attempts: 0,
          failedReason: null,
        },
      ],
      failed: [
        {
          id: 'op2',
          method: 'PATCH',
          path: '/cards/c2',
          body: { ease: 2600 },
          createdAt: 2000,
          attempts: 5,
          failedReason: 'poison: 422',
        },
      ],
      conflicts: [],
    };

    const serialized = JSON.stringify(original);
    const recovered = parseState(serialized);

    expect(recovered).toEqual(original);
    expect(recovered).not.toBe(original);
  });

  it('restores a pre-024 state with no conflicts key, defaulting to []', () => {
    // A pre-spec-024 stored state has no 'conflicts' key at all.
    // parseState must add it automatically to maintain backward compatibility.
    const pre024State = {
      version: 1,
      ops: [
        {
          id: 'op1',
          method: 'POST',
          path: '/review',
          body: { card: 'c1' },
          createdAt: 1000,
          attempts: 0,
          failedReason: null,
        },
      ],
      failed: [],
      // Note: no 'conflicts' key
    };

    const serialized = JSON.stringify(pre024State);
    const recovered = parseState(serialized);

    // Should restore the ops and failed as-is, and add conflicts: []
    expect(recovered.version).toBe(1);
    expect(recovered.ops).toHaveLength(1);
    expect(recovered.ops[0].id).toBe('op1');
    expect(recovered.failed).toHaveLength(0);
    expect(recovered.conflicts).toEqual([]);
  });
});

describe('constants', () => {
  it('exports OUTBOX_KEY', () => {
    expect(OUTBOX_KEY).toBe('srs.outbox.v1');
  });

  it('exports EMPTY_STATE with version 1 and empty arrays', () => {
    expect(EMPTY_STATE).toEqual({ version: 1, ops: [], failed: [], conflicts: [] });
  });
});
