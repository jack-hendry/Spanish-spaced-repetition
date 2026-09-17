import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmptyStoreError, assertPopulatedStore } from './sentinel.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'srs-sentinel-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('assertPopulatedStore', () => {
  it('throws EmptyStoreError when cards.json is missing', () => {
    writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ id: 'n1' }]), 'utf8');

    expect(() => assertPopulatedStore(dir)).toThrow(EmptyStoreError);
    expect(() => assertPopulatedStore(dir)).toThrow(/cards\.json.*ALLOW_EMPTY_STORE/);
  });

  it('throws EmptyStoreError when cards.json is an empty array', () => {
    writeFileSync(join(dir, 'cards.json'), JSON.stringify([]), 'utf8');
    writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ id: 'n1' }]), 'utf8');

    expect(() => assertPopulatedStore(dir)).toThrow(EmptyStoreError);
    expect(() => assertPopulatedStore(dir)).toThrow(/cards\.json.*empty.*ALLOW_EMPTY_STORE/);
  });

  it('throws EmptyStoreError when cards.json is malformed JSON', () => {
    writeFileSync(join(dir, 'cards.json'), 'not valid json', 'utf8');
    writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ id: 'n1' }]), 'utf8');

    expect(() => assertPopulatedStore(dir)).toThrow(EmptyStoreError);
    expect(() => assertPopulatedStore(dir)).toThrow(/cards\.json.*valid JSON.*ALLOW_EMPTY_STORE/);
  });

  it('throws EmptyStoreError when cards.json is populated but notes.json is empty', () => {
    writeFileSync(join(dir, 'cards.json'), JSON.stringify([{ id: 'c1' }]), 'utf8');
    writeFileSync(join(dir, 'notes.json'), JSON.stringify([]), 'utf8');

    expect(() => assertPopulatedStore(dir)).toThrow(EmptyStoreError);
    expect(() => assertPopulatedStore(dir)).toThrow(/notes\.json.*empty.*ALLOW_EMPTY_STORE/);
  });

  it('returns normally when both cards.json and notes.json are populated', () => {
    writeFileSync(join(dir, 'cards.json'), JSON.stringify([{ id: 'c1' }]), 'utf8');
    writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ id: 'n1' }]), 'utf8');

    expect(() => assertPopulatedStore(dir)).not.toThrow();
  });
});
