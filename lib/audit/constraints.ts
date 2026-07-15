import { type PoolFilter, poolMatch } from "@/lib/courses/code";
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

/**
 * A unit-scored requirement derived from a verbatim calendar constraint:
 * stated in UNITS (as the calendar phrases it, never a fabricated course
 * count — 0.5/course would under-credit a 1.0-unit course), scored against
 * placed courses. Base shape of breadth requirements and level floors.
 */
export interface UnitPoolRequirement {
  /** Display name. */
  title: string;
  /** Units required, exactly as the calendar states (e.g. 1.0). */
  needUnits: number;
  /** Units of placed courses matching the pool's filter. */
  placedUnits: number;
  /** Matching placed codes (catalog form), for met chips / Browse. */
  satisfiers: string[];
  /** Verbatim requirement statement. */
  sourceText: string;
}

/**
 * Parse each program constraint with `parse` (null ⇒ not this pool kind) and
 * score the survivors: placed courses matching `poolMatch(code, filterOf(p))`
 * become `satisfiers`, their units sum to `placedUnits`. The parsers stay
 * per-kind — only this scoring loop is shared.
 */
export function deriveConstraintPools<P>(
  program: Program,
  placedCodes: Iterable<string>,
  unitsOf: (code: string) => number,
  parse: (c: UnitConstraint) => P | null,
  filterOf: (parsed: P) => PoolFilter,
): (P & { placedUnits: number; satisfiers: string[] })[] {
  const placed = [...placedCodes];
  const out: (P & { placedUnits: number; satisfiers: string[] })[] = [];
  for (const c of programConstraints(program)) {
    const parsed = parse(c);
    if (!parsed) continue;
    const filter = filterOf(parsed);
    const satisfiers = placed.filter((code) => poolMatch(code, filter));
    const placedUnits = satisfiers.reduce(
      (sum, code) => sum + unitsOf(code),
      0,
    );
    out.push({ ...parsed, placedUnits, satisfiers });
  }
  return out;
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
