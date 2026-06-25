import { describe, expect, it } from 'vitest';

import { diffTypeAnswer } from './type-answer';

describe('diffTypeAnswer', () => {
  it('marks an exact match as correct', () => {
    const out = diffTypeAnswer('hola', 'hola');
    expect(out).toContain('type-result--ok');
    expect(out).not.toContain('type-bad');
    expect(out).toContain('hola');
  });

  it('compares against the plain text of an HTML answer', () => {
    const out = diffTypeAnswer('<b>hola</b>', 'hola');
    expect(out).toContain('type-result--ok');
  });

  it('ignores surrounding whitespace', () => {
    expect(diffTypeAnswer('hola', '  hola ')).toContain('type-result--ok');
  });

  it('flags wrong characters and shows the expected answer', () => {
    const out = diffTypeAnswer('gato', 'goto');
    expect(out).toContain('type-result--bad');
    expect(out).toContain('type-given');
    expect(out).toContain('type-expected');
    // the mismatching typed char is flagged bad
    expect(out).toContain('type-bad');
    // common characters are kept good
    expect(out).toContain('type-good');
  });

  it('escapes HTML in the typed answer', () => {
    const out = diffTypeAnswer('x', '<i>');
    // each char is wrapped in its own diff span, but the angle brackets must
    // be entity-escaped rather than emitted as a live tag.
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).not.toContain('<i>');
  });
});
