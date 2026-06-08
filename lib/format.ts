export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatCourseCode(code: string): string {
  const m = code.toUpperCase().match(/^([A-Z]+)(\d+[A-Z]*)$/);
  return m ? `${m[1]} ${m[2]}` : code.toUpperCase();
}

/** Units as a compact string: trims trailing zeros (20.0→"20", 13.5→"13.5"). */
export function fmtUnits(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Has a unit-based requirement been met? Unit totals are summed floats, so an
 * exact `>=` can miss by a rounding epsilon — compare with tolerance.
 */
export function unitsMet(placedUnits: number, needUnits: number): boolean {
  return placedUnits >= needUnits - 1e-9;
}

/** `noun` pluralized by `count`: pluralize(1, "course")→"course", (2)→"courses". */
export function pluralize(
  count: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return count === 1 ? noun : plural;
}

/**
 * `count` and its pluralized `noun`: countNoun(1, "course")→"1 course". Use
 * {@link pluralize} alone when an adjective separates the count from the noun
 * ("3 placed courses") or the count needs its own formatting.
 */
export function countNoun(
  count: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return `${count} ${pluralize(count, noun, plural)}`;
}

/** Human level-range note, e.g. "300–400 level". Null when unbounded. */
export function formatLevelRange(min?: number, max?: number): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null)
    return min === max ? `${min} level` : `${min}–${max} level`;
  if (min != null) return `${min}+ level`;
  return `up to ${max} level`;
}

/** First `max` items joined with `sep`, with " +N" appended when more remain. */
export function joinWithOverflow(
  items: string[],
  sep = " · ",
  max = 3,
): string {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return shown.join(sep) + (extra > 0 ? ` +${extra}` : "");
}

export function truncate(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
