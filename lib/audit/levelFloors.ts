import { courseLevel, coursePrefix, levelBucket } from "@/lib/courses/code";
import type { Program, UnitConstraint } from "@/lib/programs";

/**
 * Faculty "level-floor" requirements: a minimum number of UNITS that must sit
 * at or above (occasionally below) a course level — e.g. "14.5 units must be at
 * the 200-level or above", "3.0 units at the 300-level or above (excluding SCI
 * courses)", "0.5 unit of BIOL or EARTH courses at the 300-level or above".
 *
 * These arrive as verbatim constraint notes with no subject *list* (so
 * `parseBreadthConstraint` rejects them) and were previously surfaced as inert
 * text — a plan could read 100% with a floor unmet. They're an independent
 * filter over the whole plan (a course counts toward a floor AND its major), so
 * like breadth they GATE completion without inflating the unit denominator.
 */
export interface LevelFloor {
  /** Readable label, e.g. "14.5 units at the 200-level or above". */
  title: string;
  /** Units required. */
  need: number;
  /** Inclusive level bound (bucketed to the hundred). One of these is set. */
  minLevel?: number;
  maxLevel?: number;
  /** Optional subject include-list (lowercase prefixes); empty = any subject. */
  subjects?: string[];
  /** Optional subject exclude-list (lowercase prefixes). */
  excludeSubjects?: string[];
  /** Placed units that satisfy the floor. */
  placedUnits: number;
  /** Verbatim requirement statement. */
  sourceText: string;
}

const UNIT_RE = /(\d+(?:\.\d+)?)\s*units?/i;
const LEVEL_RE = /(\d{3})-level\s+(?:or|and)\s+(above|higher|below|lower)/i;
const SUBJECTS_OF_RE = /units?\s+of\s+(?:additional\s+)?([a-z][a-z,/&\s]*?)\s+(?:courses|lecture)/i;
const EXCLUDE_RE = /excluding\s+([a-z][a-z,/&\s]*?)\s+courses?/i;

/** Subject tokens from a fragment like "BIOL or EARTH" → ["biol", "earth"]. */
function subjectList(fragment: string): string[] {
  return fragment
    .split(/[,/&]|\bor\b|\band\b|\s+/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,6}$/.test(s) && s !== "additional");
}

/**
 * Parse a constraint note into a level floor, or null when it isn't one (no
 * unit amount, or no level bound).
 */
export function parseLevelFloor(
  c: UnitConstraint,
): Omit<LevelFloor, "placedUnits"> | null {
  const src = c.sourceText ?? c.label ?? "";
  const um = src.match(UNIT_RE);
  const lm = src.match(LEVEL_RE);
  if (!um || !lm) return null;
  const need = Number(um[1]);
  if (!Number.isFinite(need) || need <= 0) return null;

  const level = Number(lm[1]);
  const above = !/below|lower/i.test(lm[2]);
  const subjMatch = src.match(SUBJECTS_OF_RE);
  const subjects = subjMatch ? subjectList(subjMatch[1]) : [];
  const exclMatch = src.match(EXCLUDE_RE);
  const excludeSubjects = exclMatch ? subjectList(exclMatch[1]) : [];

  const title =
    `${need} unit${need === 1 ? "" : "s"}` +
    (subjects.length ? ` of ${subjects.map((s) => s.toUpperCase()).join("/")}` : "") +
    ` at the ${level}-level or ${above ? "above" : "below"}` +
    (excludeSubjects.length
      ? ` (excl. ${excludeSubjects.map((s) => s.toUpperCase()).join("/")})`
      : "");

  return {
    title,
    need,
    ...(above ? { minLevel: level } : { maxLevel: level }),
    ...(subjects.length ? { subjects } : {}),
    ...(excludeSubjects.length ? { excludeSubjects } : {}),
    sourceText: src,
  };
}

/** Whether a placed course's prefix + level satisfy a floor's bounds. */
function matches(code: string, f: Omit<LevelFloor, "placedUnits">): boolean {
  const prefix = coursePrefix(code);
  if (f.subjects && !f.subjects.includes(prefix)) return false;
  if (f.excludeSubjects?.includes(prefix)) return false;
  const lvl = levelBucket(courseLevel(code));
  if (f.minLevel != null && lvl < f.minLevel) return false;
  if (f.maxLevel != null && lvl > f.maxLevel) return false;
  return true;
}

function programConstraints(program: Program): UnitConstraint[] {
  return [
    ...(program.unitPlan?.constraints ?? []),
    ...(program.degreeRequirements?.constraints ?? []),
  ];
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
  const placed = [...placedCodes];
  const out: LevelFloor[] = [];
  for (const c of programConstraints(program)) {
    const f = parseLevelFloor(c);
    if (!f) continue;
    let placedUnits = 0;
    for (const code of placed) if (matches(code, f)) placedUnits += unitsOf(code);
    out.push({ ...f, placedUnits });
  }
  return out;
}
