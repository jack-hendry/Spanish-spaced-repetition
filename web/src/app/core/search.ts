// A small Anki-ish search query language for the card browser.
//
//   hola               bare words match note text (case-insensitive, AND-ed)
//   "buenos dias"      quoted phrases match as a whole
//   deck:verbs         card's deck name contains the value
//   tag:grammar        note has a tag at/under the value ("a::b" matches "a")
//   is:new is:due      card state: new | learning | review | due | suspended | buried
//
// `parseQuery` compiles a query string into a predicate over a SearchRow.

import type { Card, Note } from './models';

/** A flattened, pre-lowercased row the predicate runs against. */
export interface SearchRow {
  card: Card;
  note: Note;
  /** Full hierarchical deck name, lowercased. */
  deckName: string;
  /** All field values concatenated + lowercased (tags stripped of markup). */
  text: string;
  /** Note tags, lowercased. */
  tags: string[];
}

export type SearchPredicate = (row: SearchRow, today: number) => boolean;

const TOKEN_RE = /(\w+:)?("[^"]*"|\S+)/g;

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function isDue(card: Card, today: number): boolean {
  if (card.queue === 'learning') return true;
  return card.queue === 'review' && card.type === 'review' && card.due <= today;
}

function stateMatches(card: Card, state: string): boolean {
  switch (state) {
    case 'new':
      return card.queue === 'new';
    case 'learning':
    case 'learn':
      return card.queue === 'learning';
    case 'review':
      return card.queue === 'review' && card.type === 'review';
    case 'suspended':
      return card.queue === 'suspended';
    case 'buried':
      return card.queue === 'schedBuried' || card.queue === 'userBuried';
    default:
      return false; // unknown is:X never matches
  }
}

/** Does the note carry `value` as a tag, or as an ancestor of a "::" tag? */
function hasTag(tags: string[], value: string): boolean {
  return tags.some((t) => t === value || t.startsWith(value + '::'));
}

function compileTerm(qualifier: string | undefined, value: string): SearchPredicate {
  const v = value.toLowerCase();
  switch (qualifier) {
    case 'deck':
      return (row) => row.deckName.includes(v);
    case 'tag':
      return (row) => hasTag(row.tags, v);
    case 'is':
      return (row, today) => (v === 'due' ? isDue(row.card, today) : stateMatches(row.card, v));
    default:
      // Bare word (or unknown qualifier treated as text): substring over fields.
      return (row) => row.text.includes(v);
  }
}

/**
 * Compile a query into a predicate. An empty query matches everything. All terms
 * are AND-ed together.
 */
export function parseQuery(query: string): SearchPredicate {
  const terms: SearchPredicate[] = [];
  for (const m of query.matchAll(TOKEN_RE)) {
    const qualifier = m[1] ? m[1].slice(0, -1).toLowerCase() : undefined;
    const value = unquote(m[2]);
    if (!value && qualifier === undefined) continue;
    terms.push(compileTerm(qualifier, value));
  }
  if (!terms.length) return () => true;
  return (row, today) => terms.every((t) => t(row, today));
}
