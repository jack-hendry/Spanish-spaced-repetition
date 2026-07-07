// Deterministic deck-name -> color for the sidebar's color dots. No color is
// persisted (see SPEC Req 3 / Non-goal 6): the same name always hashes to the
// same color, computed fresh on every load.

/** djb2-style string hash; stable across runs/platforms, good bit spread. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Derive a stable HSL color string from a deck name. Pure and deterministic:
 * the same `name` always returns the exact same color.
 */
export function deckColor(name: string): string {
  const hash = hashString(name);
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
