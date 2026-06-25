import { describe, expect, it } from 'vitest';

import { renderCard, renderTemplate, transformMedia } from './template-renderer';

describe('renderTemplate', () => {
  it('substitutes simple fields', () => {
    expect(renderTemplate('{{Front}}', { Front: 'hola', Back: 'hi' })).toBe('hola');
  });

  it('supports field names with spaces', () => {
    expect(renderTemplate('{{Back Extra}}', { 'Back Extra': 'note' })).toBe('note');
  });

  it('injects FrontSide into the answer', () => {
    const out = renderTemplate('{{FrontSide}}<hr>{{Back}}', { Back: 'hi' }, 'hola');
    expect(out).toBe('hola<hr>hi');
  });

  it('renders {{#Field}} only when the field is non-empty', () => {
    const tpl = '{{Front}}{{#Hint}} (<i>{{Hint}}</i>){{/Hint}}';
    expect(renderTemplate(tpl, { Front: 'q', Hint: 'clue' })).toBe('q (<i>clue</i>)');
    expect(renderTemplate(tpl, { Front: 'q', Hint: '' })).toBe('q');
  });

  it('renders {{^Field}} only when the field is empty', () => {
    const tpl = '{{^Audio}}no audio{{/Audio}}';
    expect(renderTemplate(tpl, { Audio: '' })).toBe('no audio');
    expect(renderTemplate(tpl, { Audio: '[sound:x]' })).toBe('');
  });

  it('treats whitespace/tags-only fields as empty for conditionals', () => {
    expect(renderTemplate('{{#A}}x{{/A}}', { A: '<br>  ' })).toBe('');
  });

  it('handles nested conditionals (innermost first)', () => {
    const tpl = '{{#A}}A{{#B}}B{{/B}}{{/A}}';
    expect(renderTemplate(tpl, { A: '1', B: '1' })).toBe('AB');
    expect(renderTemplate(tpl, { A: '1', B: '' })).toBe('A');
    expect(renderTemplate(tpl, { A: '', B: '1' })).toBe('');
  });

  it('renders {{type:Field}} as empty on the question side', () => {
    expect(renderTemplate('{{Front}}{{type:Back}}', { Front: 'q', Back: 'x' })).toBe('q');
  });

  it('renders {{type:Field}} as a comparison on the answer side', () => {
    const out = renderTemplate('{{type:Back}}', { Back: 'casa' }, '', 'back', {
      typedAnswer: 'casa',
    });
    expect(out).toContain('type-result--ok');
  });

  it('renders {{cloze:Field}} using the card ordinal', () => {
    const fields = { Text: 'El {{c1::gato}} y el {{c2::perro}}' };
    // ord 0 -> active cloze 1 hidden, cloze 2 revealed (question side)
    expect(renderTemplate('{{cloze:Text}}', fields, '', 'front', { ord: 0 })).toBe(
      'El <span class="cloze">[...]</span> y el perro',
    );
    // answer side reveals the active deletion
    expect(renderTemplate('{{cloze:Text}}', fields, '', 'back', { ord: 1 })).toBe(
      'El gato y el <span class="cloze">perro</span>',
    );
  });
});

describe('transformMedia', () => {
  it('turns [sound:URL] into an audio element', () => {
    const out = transformMedia('[sound:https://x/a.mp3]');
    expect(out).toContain('<audio');
    expect(out).toContain('src="https://x/a.mp3"');
  });
});

describe('renderCard', () => {
  it('renders the Spanish 2-sided template with audio', () => {
    const { front, back } = renderCard(
      '{{SideA}}{{SideAImage}}{{SideAAudio}}',
      '{{FrontSide}}<hr id="answer">{{SideB}}{{SideBAudio}}',
      {
        SideA: 'aunt',
        SideAImage: '',
        SideAAudio: '',
        SideB: 'la tía',
        SideBAudio: '[sound:https://x/b.mp3]',
      },
    );
    expect(front).toBe('aunt');
    expect(back).toContain('aunt<hr id="answer">la tía');
    expect(back).toContain('<audio');
  });
});
