/** Format an interval (in days, possibly fractional) as an Anki-style label. */
export function formatDays(days: number): string {
  if (days < 1) {
    const mins = Math.round(days * 1440);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(mins / 60);
    return `${hrs}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return years < 10 ? `${years.toFixed(1)}y` : `${Math.round(years)}y`;
}

export function minutesToDays(min: number): number {
  return min / 1440;
}
