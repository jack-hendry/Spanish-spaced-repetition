import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileStore } from './file-store.js';
import { buildSeedNoteTypes, NOTE_TYPE_IDS } from './seed.js';

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

  it('nt-spanish-2sided has exactly two templates: A → B (ord 0) and Listening (ord 1)', () => {
    const noteTypes = buildSeedNoteTypes();
    const spanish2Sided = noteTypes.find(
      (nt) => nt.id === NOTE_TYPE_IDS.spanish2
    );

    expect(spanish2Sided).toBeDefined();
    expect(spanish2Sided!.templates).toHaveLength(2);

    const ord0 = spanish2Sided!.templates[0];
    expect(ord0.ord).toBe(0);
    expect(ord0.name).toBe('A → B');

    const ord1 = spanish2Sided!.templates[1];
    expect(ord1.ord).toBe(1);
    expect(ord1.name).toBe('Listening');

    // Verify the Listening qfmt contains only SideAAudio and SideBAudio
    expect(ord1.qfmt).toContain('{{SideAAudio}}');
    expect(ord1.qfmt).toContain('{{SideBAudio}}');
    expect(ord1.qfmt).not.toContain('{{SideA}}');
    expect(ord1.qfmt).not.toContain('{{SideB}}');
    expect(ord1.qfmt).not.toContain('{{SideAImage}}');
    expect(ord1.qfmt).not.toContain('{{SideBImage}}');
  });
});
