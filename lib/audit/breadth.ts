import type { Program, UnitConstraint } from "@/lib/programs";
import {
  deriveConstraintPools,
  programConstraints,
  UNIT_RE,
  type UnitPoolRequirement,
} from "./constraints";

/**
 * Faculty breadth / distribution requirements arrive as verbatim notes
 * (`program.{unitPlan,degreeRequirements}.constraints`), e.g. "Humanities — 1.0
 * unit: CLAS, ENGL, HIST, …". The calendar states them in UNITS, so we track
 * units, not a fabricated course count (0.5/course under-credits a 1.0 course).
 *
 * An independent subject filter: a course can satisfy breadth AND the major, so
 * it gates completion without inflating the unit-total denominator.
 */
export interface BreadthRequirement extends UnitPoolRequirement {
  /** Subject prefixes that satisfy it (uppercase), e.g. ["CLAS", "ENGL", …]. */
  subjects: string[];
}

/** A subject code: 1–10 letters, optionally with an internal slash/ampersand. */
const SUBJECT_RE = /^[A-Z][A-Z/&]{0,9}$/;

/**
 * Parse a breadth constraint into a trackable requirement, or null when it isn't
 * a subject-list rule (e.g. a level-only minimum) — caller surfaces those verbatim.
 */
export function parseBreadthConstraint(
  c: UnitConstraint,
): Omit<BreadthRequirement, "placedUnits" | "satisfiers"> | null {
  const src = c.sourceText ?? "";
  const um = src.match(UNIT_RE);
  if (!um) return null;
  const needUnits = Number(um[1]);
  if (!Number.isFinite(needUnits) || needUnits <= 0) return null;

  const colon = src.indexOf(":");
  if (colon === -1) return null;
  const subjects = src
    .slice(colon + 1)
    .split(/,\s*/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SUBJECT_RE.test(s));
  if (subjects.length === 0) return null;

  // Title: the segment before the dash ("Humanities — …"), else the label with
  // any "Breadth — " prefix stripped.
  const head = src.split(/\s+[—–-]\s+/)[0].trim();
  const title =
    head || c.label.replace(/^breadth\s*[—–-]\s*/i, "").trim() || c.label;
  return { title, subjects, needUnits, sourceText: src };
}

/**
 * A program's trackable breadth requirements, scored against placed courses.
 * Non-subject-list constraints are omitted (see {@link nonBreadthConstraints}).
 */
export function deriveBreadthRequirements(
  program: Program,
  placedCodes: Iterable<string>,
  unitsOf: (code: string) => number,
): BreadthRequirement[] {
  return deriveConstraintPools(
    program,
    placedCodes,
    unitsOf,
    parseBreadthConstraint,
    (p) => ({ subjects: new Set(p.subjects.map((s) => s.toLowerCase())) }),
  );
}

/** Constraints that aren't trackable breadth — surfaced verbatim as notes. */
export function nonBreadthConstraints(program: Program): UnitConstraint[] {
  return programConstraints(program).filter(
    (c) => parseBreadthConstraint(c) === null,
  );
}
