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

  it('renders Listening template: audio-only front, full back', () => {
    const { front, back } = renderCard(
      '{{SideAAudio}}{{SideBAudio}}',
      '{{SideA}}{{SideAImage}}{{SideAAudio}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
      {
        SideA: 'tía',
        SideAImage: '<img src="tia.jpg" />',
        SideAAudio: '[sound:word-tia.mp3]',
        SideB: 'la tía en la familia',
        SideBImage: '<img src="family.jpg" />',
        SideBAudio: '[sound:sentence-tia.mp3]',
      },
    );

    // Front: audio-only (two audio elements, no text/images)
    expect(front).toContain('<audio');
    expect(front).toContain('class="card-audio"');
    // Should have exactly two audio elements (word and sentence)
    expect((front.match(/<audio/g) || []).length).toBe(2);
    // Should NOT contain any text
    expect(front).not.toContain('tía');
    expect(front).not.toContain('la tía');
    // Should NOT contain images
    expect(front).not.toContain('img');
    expect(front).not.toContain('tia.jpg');
    expect(front).not.toContain('family.jpg');

    // Back: full content (text, images, audio)
    expect(back).toContain('tía');
    expect(back).toContain('la tía en la familia');
    expect(back).toContain('tia.jpg');
    expect(back).toContain('family.jpg');
    // Should have two audio elements
    expect((back.match(/<audio/g) || []).length).toBe(2);
    // Should contain the answer divider
    expect(back).toContain('<hr id="answer">');
  });
});
