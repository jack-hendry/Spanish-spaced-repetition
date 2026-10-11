// Revlog deduplication test: verify that appendRevlog is idempotent on RevlogEntry.id

import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, afterAll, it, expect } from 'vitest';

import type { RevlogEntry } from '../models/index.js';
import { FileStore } from './file-store.js';

describe('FileStore revlog deduplication', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'srs-revlog-dedupe-'));

  afterAll(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('appending two entries with different ids yields 2 lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srs-'));
    mkdirSync(dir, { recursive: true });

    const store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    const entry1: RevlogEntry = {
      id: 'rev-1',
      cardId: 'c1',
      reviewedAt: 1000,
      button: 1,
      type: 'learn',
      interval: 0,
      lastInterval: 0,
      factorOrStability: 2500,
      timeMs: 10,
    };

    const entry2: RevlogEntry = {
      id: 'rev-2',
      cardId: 'c2',
      reviewedAt: 2000,
      button: 2,
      type: 'learn',
      interval: 0,
      lastInterval: 0,
      factorOrStability: 2500,
      timeMs: 15,
    };

    await store.appendRevlog(entry1);
    await store.appendRevlog(entry2);

    const lines = readFileSync(join(dir, 'revlog.ndjson'), 'utf8')
      .split('\n')
      .filter((line) => line.trim());

    expect(lines).toHaveLength(2);
    rmSync(dir, { recursive: true });
  });

  it('appending the same entry twice yields 1 line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srs-'));
    mkdirSync(dir, { recursive: true });

    const store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    const entry: RevlogEntry = {
      id: 'rev-duplicate',
      cardId: 'c1',
      reviewedAt: 1000,
      button: 1,
      type: 'learn',
      interval: 0,
      lastInterval: 0,
      factorOrStability: 2500,
      timeMs: 10,
    };

    await store.appendRevlog(entry);
    await store.appendRevlog(entry);

    const lines = readFileSync(join(dir, 'revlog.ndjson'), 'utf8')
      .split('\n')
      .filter((line) => line.trim());

    expect(lines).toHaveLength(1);
    rmSync(dir, { recursive: true });
  });

  it('a store re-init()ed over an existing revlog.ndjson still rejects a duplicate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srs-'));
    mkdirSync(dir, { recursive: true });

    // First store: create an entry
    const store1 = new FileStore(dir, { debounceMs: 0 });
    await store1.init();

    const entry: RevlogEntry = {
      id: 'rev-persistent',
      cardId: 'c1',
      reviewedAt: 1000,
      button: 1,
      type: 'learn',
      interval: 0,
      lastInterval: 0,
      factorOrStability: 2500,
      timeMs: 10,
    };

    await store1.appendRevlog(entry);

    // Second store: re-init on the same directory, then try to append the same id
    const store2 = new FileStore(dir, { debounceMs: 0 });
    await store2.init();

    await store2.appendRevlog(entry);

    const lines = readFileSync(join(dir, 'revlog.ndjson'), 'utf8')
      .split('\n')
      .filter((line) => line.trim());

    expect(lines).toHaveLength(1);
    rmSync(dir, { recursive: true });
  });
});
