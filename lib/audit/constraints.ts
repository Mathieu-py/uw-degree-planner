import type { Program, UnitConstraint } from "@/lib/programs";

/**
 * Every degree-level constraint a program carries, from both sources Kuali
 * emits them in: the program's own `unitPlan.constraints` and the faculty
 * `degreeRequirements.constraints`. Breadth and level-floor derivation both
 * start from this list (each keeps the constraints it can parse, surfacing the
 * rest verbatim).
 */
export function programConstraints(program: Program): UnitConstraint[] {
  return [
    ...(program.unitPlan?.constraints ?? []),
    ...(program.degreeRequirements?.constraints ?? []),
  ];
}

// --- Shared patterns for parsing constraint text (breadth / level-floor /
// elective rules all read the same Kuali phrasings). ---

/** A unit amount: "1.0 unit", "14.5 units". */
export const UNIT_RE = /(\d+(?:\.\d+)?)\s*units?/i;
/** A level bound: "200-level or above", "300-level and below". */
export const LEVEL_BOUND_RE =
  /(\d{3})-level\s+(?:or|and)\s+(above|higher|below|lower)/i;

/** Subject tokens from a fragment like "BIOL or EARTH" → ["biol", "earth"]. */
export function subjectList(fragment: string): string[] {
  return fragment
    .split(/[,/&]|\bor\b|\band\b|\s+/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,6}$/.test(s) && s !== "additional");
}
