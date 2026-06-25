// Anki-style cloze deletions: {{c1::hidden}} or {{c1::hidden::hint}}.
//
// A note's cloze field can carry several deletions sharing or differing in
// number. Each distinct number N produces one card whose ordinal is N-1; when
// that card is shown, the deletions numbered N are hidden ([...] or [hint]) and
// every other deletion is revealed as its plain text.

// `s` flag so deletions may span newlines; non-greedy so adjacent deletions
// don't merge. Hint (the second ::group) is optional.
const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs;

/** Distinct cloze numbers present in the text, ascending (e.g. [1, 2, 4]). */
export function clozeOrds(text: string): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) seen.add(Number(m[1]));
  return [...seen].sort((a, b) => a - b);
}

/**
 * Render cloze text for the card whose active deletion is `activeOrd` (1-based).
 * Deletions matching `activeOrd` are hidden until `reveal`, then shown wrapped
 * in `.cloze`; all other deletions render as their plain answer text.
 */
export function renderCloze(text: string, activeOrd: number, reveal: boolean): string {
  return text.replace(CLOZE_RE, (_whole, num: string, content: string, hint?: string) => {
    if (Number(num) !== activeOrd) return content;
    if (reveal) return `<span class="cloze">${content}</span>`;
    const placeholder = hint ? `[${hint}]` : '[...]';
    return `<span class="cloze">${placeholder}</span>`;
  });
}
