import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileStore } from './file-store.js';

describe('fresh seed', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('seeds a new collection with pausedAt: null', async () => {
    dir = mkdtempSync(join(tmpdir(), 'srs-seed-'));
    const store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    expect(store.getCollection().pausedAt).toBe(null);
  });
});
