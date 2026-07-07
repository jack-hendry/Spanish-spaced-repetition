import { describe, expect, it } from 'vitest';

import { deckColor } from './deck-color';

const HSL_RE = /^hsl\(\d{1,3}, 65%, 55%\)$/;

describe('deckColor', () => {
  it('is deterministic: same name -> same color every call', () => {
    expect(deckColor('Spanish::Verbs')).toBe(deckColor('Spanish::Verbs'));
    expect(deckColor('Spanish::Verbs')).toBe(deckColor('Spanish::Verbs'));
  });

  it('returns a valid hsl() color string', () => {
    expect(deckColor('Spanish::Verbs')).toMatch(HSL_RE);
    expect(deckColor('')).toMatch(HSL_RE);
  });

  it('produces different colors for distinct names (no forced collision)', () => {
    const a = deckColor('Spanish::Verbs');
    const b = deckColor('Spanish::Nouns');
    const c = deckColor('French::Verbs');
    // Not a strict guarantee for arbitrary hashes, but true for these fixtures
    // and catches a degenerate "always return the same color" implementation.
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });
});
