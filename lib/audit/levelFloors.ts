import { countNoun } from "@/lib/format";
import type { Program, UnitConstraint } from "@/lib/programs";
import {
  deriveConstraintPools,
  LEVEL_BOUND_RE,
  subjectList,
  UNIT_RE,
  type UnitPoolRequirement,
} from "./constraints";

/**
 * Faculty "level-floor" requirements: minimum UNITS at or above (occasionally
 * below) a course level — e.g. "14.5 units at the 200-level or above", "3.0
 * units at the 300-level or above (excluding SCI courses)".
 *
 * They arrive as verbatim notes with no subject list (so
 * `parseBreadthConstraint` rejects them). Like breadth, an independent filter
 * over the plan: they gate completion without inflating the unit denominator.
 */
export interface LevelFloor extends UnitPoolRequirement {
  /** Inclusive level bound (bucketed to the hundred). One of these is set. */
  minLevel?: number;
  maxLevel?: number;
  /** Optional subject include-list (lowercase prefixes); empty = any subject. */
  subjects?: string[];
  /** Optional subject exclude-list (lowercase prefixes). */
  excludeSubjects?: string[];
}

const SUBJECTS_OF_RE =
  /units?\s+of\s+(?:additional\s+)?([a-z][a-z,/&\s]*?)\s+(?:courses|lecture)/i;
const EXCLUDE_RE = /excluding\s+([a-z][a-z,/&\s]*?)\s+courses?/i;

/** Parse a constraint into a level floor, or null (no unit amount or no level bound). */
export function parseLevelFloor(
  c: UnitConstraint,
): Omit<LevelFloor, "placedUnits" | "satisfiers"> | null {
  const src = c.sourceText ?? c.label ?? "";
  const um = src.match(UNIT_RE);
  const lm = src.match(LEVEL_BOUND_RE);
  if (!um || !lm) return null;
  const needUnits = Number(um[1]);
  if (!Number.isFinite(needUnits) || needUnits <= 0) return null;

  const level = Number(lm[1]);
  const above = !/below|lower/i.test(lm[2]);
  const subjMatch = src.match(SUBJECTS_OF_RE);
  const subjects = subjMatch ? subjectList(subjMatch[1]) : [];
  const exclMatch = src.match(EXCLUDE_RE);
  const excludeSubjects = exclMatch ? subjectList(exclMatch[1]) : [];

  const title =
    countNoun(needUnits, "unit") +
    (subjects.length
      ? ` of ${subjects.map((s) => s.toUpperCase()).join("/")}`
      : "") +
    ` at the ${level}-level or ${above ? "above" : "below"}` +
    (excludeSubjects.length
      ? ` (excl. ${excludeSubjects.map((s) => s.toUpperCase()).join("/")})`
      : "");

  return {
    title,
    needUnits,
    ...(above ? { minLevel: level } : { maxLevel: level }),
    ...(subjects.length ? { subjects } : {}),
    ...(excludeSubjects.length ? { excludeSubjects } : {}),
    sourceText: src,
  };
}

/** Whether a constraint is a level floor (so callers can avoid double-display). */
export function isLevelFloor(c: UnitConstraint): boolean {
  return parseLevelFloor(c) !== null;
}

/**
 * Every level-floor requirement a program carries, scored against the placed
 * courses' units. `unitsOf` supplies per-course units (default 0.5 upstream).
 */
export function deriveLevelFloors(
  program: Program,
  placedCodes: Iterable<string>,
  unitsOf: (code: string) => number,
): LevelFloor[] {
  return deriveConstraintPools(
    program,
    placedCodes,
    unitsOf,
    parseLevelFloor,
    // A placed course counts when its prefix + level satisfy the floor's bounds.
    (f) => ({
      subjects: f.subjects && new Set(f.subjects),
      minLevel: f.minLevel,
      maxLevel: f.maxLevel,
      excludeSubjects: f.excludeSubjects && new Set(f.excludeSubjects),
    }),
  );
}
