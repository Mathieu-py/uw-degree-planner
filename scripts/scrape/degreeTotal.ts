import type { DegreeParseResult } from "./degree";

/**
 * The whole-degree total to stamp on a degree-linked program, or null to keep its
 * own. Two cases:
 *  - states no total of its own → propagate the degree total (original behaviour;
 *    e.g. Math majors and Math Joint Honours, whose total lives on the degree page);
 *  - states a smaller "Complete a total of N units" → that's a MAJOR subtotal
 *    (e.g. `h-sociology` lists 8.0 while the BA degree is 20.0); the degree total
 *    is the real denominator and wins — EXCEPT for a Joint Honours half-degree
 *    (e.g. a Science joint plan listing 12.75), which keeps its own partial total.
 * Source: the calendar's degree-level requirements pages.
 */
export function resolveDegreeTotalUnits(
  slug: string,
  programName: string,
  statedTotal: number | undefined,
  parsed: Pick<
    DegreeParseResult,
    "generalTotal" | "honoursTotal" | "fourYearTotal"
  >,
): number | null {
  // Pick the total matching the program's degree type (15.0 vs 20.0 vs 20.0).
  const degreeTotal = /^3g-/.test(slug)
    ? (parsed.generalTotal ?? parsed.honoursTotal)
    : /^4g-/.test(slug)
      ? (parsed.fourYearTotal ?? parsed.generalTotal ?? parsed.honoursTotal)
      : parsed.honoursTotal;
  if (degreeTotal == null) return null;
  // No stated total: propagate the degree total — for every degree type.
  if (statedTotal == null) return degreeTotal;
  // States a smaller subtotal: the degree total wins, unless this is a Joint
  // Honours half-degree. Never shrink a stated total (`>` guards a mis-parse).
  if (degreeTotal > statedTotal && !/joint honours/i.test(programName)) {
    return degreeTotal;
  }
  return null;
}
