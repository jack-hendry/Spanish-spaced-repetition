import { describe, expect, it } from 'vitest';

import { clozeOrds, renderCloze } from './cloze';

describe('clozeOrds', () => {
  it('returns distinct numbers, ascending', () => {
    expect(clozeOrds('{{c1::a}} y {{c2::b}} y {{c1::c}}')).toEqual([1, 2]);
  });

  it('handles sparse numbering', () => {
    expect(clozeOrds('{{c1::a}} {{c3::b}}')).toEqual([1, 3]);
  });

  it('returns [] when there are no deletions', () => {
    expect(clozeOrds('plain text')).toEqual([]);
  });

  it('parses deletions with hints', () => {
    expect(clozeOrds('{{c2::casa::house}}')).toEqual([2]);
  });
});

describe('renderCloze', () => {
  const text = 'El {{c1::gato}} bebe {{c2::leche::drink}}';

  it('hides the active deletion and reveals the others (question side)', () => {
    expect(renderCloze(text, 1, false)).toBe('El <span class="cloze">[...]</span> bebe leche');
  });

  it('uses the hint as the placeholder when present', () => {
    expect(renderCloze(text, 2, false)).toBe('El gato bebe <span class="cloze">[drink]</span>');
  });

  it('reveals the active deletion wrapped in .cloze (answer side)', () => {
    expect(renderCloze(text, 1, true)).toBe('El <span class="cloze">gato</span> bebe leche');
  });

  it('reveals only the answer text, dropping the hint', () => {
    expect(renderCloze(text, 2, true)).toBe('El gato bebe <span class="cloze">leche</span>');
  });
});
