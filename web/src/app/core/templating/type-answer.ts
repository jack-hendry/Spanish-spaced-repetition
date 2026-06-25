// Comparison for "type in the answer" cards ({{type:Field}}). Renders the typed
// response against the expected text the way Anki does: a coloured copy of what
// was typed (good vs. wrong characters) and, when they differ, the expected
// answer with the missing characters highlighted.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strip tags so an HTML answer field compares against plain typed text. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

/** Longest-common-subsequence char matching between two strings. */
function lcsMarks(a: string, b: string): { aMatch: boolean[]; bMatch: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMatch = new Array<boolean>(n).fill(false);
  const bMatch = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aMatch[i] = bMatch[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { aMatch, bMatch };
}

function markup(text: string, matched: boolean[], goodClass: string, badClass: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const cls = matched[i] ? goodClass : badClass;
    out += `<span class="${cls}">${escapeHtml(text[i])}</span>`;
  }
  return out;
}

/**
 * Build the comparison HTML for a typed answer. `expected` may contain HTML
 * (it is stripped for comparison); `typed` is the raw user input.
 */
export function diffTypeAnswer(expected: string, typed: string): string {
  const exp = stripHtml(expected).trim();
  const got = typed.trim();

  if (got === exp) {
    return `<div class="type-result type-result--ok"><code class="type-given">${escapeHtml(
      exp,
    )}</code></div>`;
  }

  const { aMatch, bMatch } = lcsMarks(got, exp);
  const given = markup(got, aMatch, 'type-good', 'type-bad');
  const expectedLine = markup(exp, bMatch, 'type-have', 'type-missing');
  return (
    '<div class="type-result type-result--bad">' +
    `<code class="type-given">${given}</code>` +
    `<code class="type-expected">${expectedLine}</code>` +
    '</div>'
  );
}
