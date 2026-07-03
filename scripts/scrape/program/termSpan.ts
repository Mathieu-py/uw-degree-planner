import type { Program } from "../../../lib/programs";

/**
 * Academic-term span from total units: a full-time year ≈ 5.0 units (two terms),
 * so terms = 2·round(units / 5), clamped to [2, 8] (`TermLetter` ≤ 4B; 5-year
 * double degrees collapse to 8). Source: uwaterloo.ca/.../campus-lingo —
 * Three-Year General = 15.0 units / 6 terms, four-year = 20.0 / 8.
 */
export function termSpanFromUnits(totalUnits: number): number {
  const years = Math.round(totalUnits / 5);
  return Math.min(8, Math.max(2, years * 2));
}

/** Below this, a flexible `totalUnits` is a major-only artifact, not a degree total. */
const MIN_DEGREE_TOTAL = 12.5;

/**
 * Span to stamp as `numberOfTerms`. Kuali has no length field — degree length
 * lives only in the title's credential clause and the unit total, read in that
 * order: engineering ⇒ 8; a single "Three-Year General" ⇒ 6 and "Honours" /
 * "Four-Year" ⇒ 8 (the clause is trusted over a mis-propagated or partial unit
 * total); a double degree keeps its honours length; else derive from `totalUnits`
 * (15→6, 20→8, 26→8); fallback 8.
 */
export function deriveNumberOfTerms(program: Program): number {
  if (program.kind === "engineering") return 8;
  const name = program.name.toLowerCase();
  const isDoubleDegree = name.includes("double degree");
  // Credential clause wins over the unit total: a joint honours lists only its
  // half (Physics leaks 12.75, which would derive to 6 instead of 8).
  if (!isDoubleDegree && name.includes("three-year")) return 6;
  if (name.includes("honours") || name.includes("four-year")) return 8;
  const total = program.unitPlan?.totalUnits;
  if (total != null && total >= MIN_DEGREE_TOTAL)
    return termSpanFromUnits(total);
  return 8;
}
