// Renders Anki-style card templates: {{Field}}, {{FrontSide}}, the
// {{#Field}}…{{/Field}} / {{^Field}}…{{/Field}} conditional sections, and the
// {{cloze:Field}} and {{type:Field}} filters.

import { renderCloze } from './cloze';
import { diffTypeAnswer } from './type-answer';

export type Fields = Record<string, string>;

const FIELD_NAME = '([^#^/}][^}]*?)';

type Side = 'front' | 'back';

interface RenderCtx {
  fields: Fields;
  frontSide: string;
  side: Side;
  /** Card ordinal (0-based); the active cloze deletion is ord + 1. */
  ord: number;
  /** Raw text the user typed for a {{type:}} card. */
  typedAnswer: string;
}

/** A field counts as "empty" (for conditionals) if blank after stripping tags. */
function isEmpty(value: string | undefined): boolean {
  if (value == null || value === '') return true;
  return value.replace(/<[^>]*>/g, '').trim() === '';
}

/** Expand {{#X}}…{{/X}} and {{^X}}…{{/X}} sections, innermost first. */
function expandSections(tpl: string, fields: Fields): string {
  // Matches a section with no nested section markers inside (i.e. innermost).
  const section = new RegExp(
    `{{([#^])\\s*${FIELD_NAME}\\s*}}((?:(?!{{[#^/]).)*?){{/\\s*\\2\\s*}}`,
    's',
  );
  let out = tpl;
  let guard = 0;
  let m: RegExpExecArray | null;
  while ((m = section.exec(out)) && guard++ < 1000) {
    const [whole, kind, name, body] = m;
    const empty = isEmpty(fields[name.trim()]);
    const keep = kind === '#' ? !empty : empty;
    out = out.slice(0, m.index) + (keep ? body : '') + out.slice(m.index + whole.length);
  }
  return out;
}

/** Resolve a {{filter:Field}} reference. Unknown filters fall back to the field. */
function applyFilter(filter: string, field: string, whole: string, ctx: RenderCtx): string {
  const value = ctx.fields[field] ?? '';
  switch (filter) {
    case 'cloze':
      return renderCloze(value, ctx.ord + 1, ctx.side === 'back');
    case 'type':
      // The question side hosts a live input rendered by the component; the
      // answer side shows the typed-vs-expected comparison.
      return ctx.side === 'back' ? diffTypeAnswer(value, ctx.typedAnswer) : '';
    case 'hint':
    case 'text':
      return value;
    default:
      return Object.hasOwn(ctx.fields, field) ? value : whole;
  }
}

/** Replace {{FrontSide}}, {{filter:Field}} and {{Field}} references. */
function substituteFields(tpl: string, ctx: RenderCtx): string {
  return tpl.replace(new RegExp(`{{\\s*${FIELD_NAME}\\s*}}`, 'g'), (whole, raw: string) => {
    const name = raw.trim();
    if (name === 'FrontSide') return ctx.frontSide;
    const colon = name.indexOf(':');
    if (colon !== -1) {
      return applyFilter(name.slice(0, colon).trim(), name.slice(colon + 1).trim(), whole, ctx);
    }
    return ctx.fields[name] ?? '';
  });
}

export interface RenderOptions {
  /** Card ordinal — selects the active cloze deletion (default 0). */
  ord?: number;
  /** The user's typed answer for {{type:}} cards. */
  typedAnswer?: string;
}

/**
 * Render a single side (qfmt or afmt). `frontSide` is the rendered question
 * HTML, substituted wherever {{FrontSide}} appears in the answer template.
 */
export function renderTemplate(
  tpl: string,
  fields: Fields,
  frontSide = '',
  side: Side = 'front',
  options: RenderOptions = {},
): string {
  const ctx: RenderCtx = {
    fields,
    frontSide,
    side,
    ord: options.ord ?? 0,
    typedAnswer: options.typedAnswer ?? '',
  };
  return substituteFields(expandSections(tpl, fields), ctx);
}

/**
 * Transform Anki media markers into playable HTML:
 *   [sound:URL]  -> <audio controls src="URL"></audio>
 * Images already arrive as <img> tags from the importer.
 */
export function transformMedia(html: string): string {
  return html.replace(/\[sound:([^\]]+)\]/g, (_m, url: string) => {
    const safe = url.trim().replace(/"/g, '&quot;');
    return `<audio controls preload="none" src="${safe}" class="card-audio"></audio>`;
  });
}

export interface RenderedCard {
  front: string;
  back: string;
}

/**
 * Render both sides of a card. The question side is rendered first so it can be
 * injected as {{FrontSide}} into the answer; media is transformed last so both
 * the field content and the FrontSide portion are handled once.
 */
export function renderCard(
  qfmt: string,
  afmt: string,
  fields: Fields,
  options: RenderOptions = {},
): RenderedCard {
  const frontRaw = renderTemplate(qfmt, fields, '', 'front', options);
  const backRaw = renderTemplate(afmt, fields, frontRaw, 'back', options);
  return {
    front: transformMedia(frontRaw),
    back: transformMedia(backRaw),
  };
}
