import type { Program, UnitConstraint } from "@/lib/programs";

/**
 * Faculty breadth / distribution requirements arrive as verbatim notes
 * (`program.unitPlan.constraints` / `program.degreeRequirements.constraints`),
 * e.g. "Humanities — 1.0 unit: CLAS, ENGL, HIST, MEDVL, PHIL". The calendar
 * states them in UNITS, so we track them in units too — "how many units of
 * placed courses are in these subjects?" — rather than fabricating a course
 * count (the old "1.0 unit → 2 courses" assumed 0.5 units/course and
 * under-credited a 1.0-unit course).
 *
 * It's an INDEPENDENT subject filter over the plan: a course can satisfy breadth
 * AND the major (as real audits allow), with no allocation and no reconciliation
 * against the unit total — so it gates completion without inflating the
 * denominator.
 */
export interface BreadthRequirement {
  /** Display name, e.g. "Humanities". */
  title: string;
  /** Subject prefixes that satisfy it (uppercase), e.g. ["CLAS", "ENGL", …]. */
  subjects: string[];
  /** Units required, exactly as the calendar states (e.g. 1.0). */
  needUnits: number;
  /** Units of placed courses whose subject is in `subjects`. */
  placedUnits: number;
  /** Those placed course codes (catalog form), for met chips / Browse. */
  satisfiers: string[];
  /** Verbatim requirement statement. */
  sourceText: string;
}

const UNIT_RE = /(\d+(?:\.\d+)?)\s*units?/i;
/** A subject code: 1–10 letters, optionally with an internal slash/ampersand. */
const SUBJECT_RE = /^[A-Z][A-Z/&]{0,9}$/;

/** Subject prefix of a catalog code: leading letters, uppercased ("hist250" → "HIST"). */
export function subjectOf(code: string): string {
  return (code.match(/^[a-z]+/i)?.[0] ?? "").toUpperCase();
}

/**
 * Parse a breadth/distribution constraint into a trackable count requirement.
 * Returns null when the text isn't a subject-list breadth rule (e.g. a level-only
 * minimum with no subject list) — the caller surfaces those verbatim instead.
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

  // Title: the segment before the dash ("Humanities — 1.0 unit: …"), else the
  // label with any "Breadth — " prefix stripped.
  const head = src.split(/\s+[—–-]\s+/)[0]?.trim();
  const title =
    head && head.length > 0
      ? head
      : c.label.replace(/^breadth\s*[—–-]\s*/i, "").trim() || c.label;
  return { title, subjects, needUnits, sourceText: src };
}

/** Every breadth/distribution constraint a program carries (both sources). */
function programConstraints(program: Program): UnitConstraint[] {
  return [
    ...(program.unitPlan?.constraints ?? []),
    ...(program.degreeRequirements?.constraints ?? []),
  ];
}

/**
 * Trackable breadth requirements for a program, scored against the placed
 * courses. Constraints that don't parse as subject-list breadth are omitted
 * here (see {@link nonBreadthConstraints}).
 */
export function deriveBreadthRequirements(
  program: Program,
  placedCodes: Iterable<string>,
  unitsOf: (code: string) => number,
): BreadthRequirement[] {
  const placed = [...placedCodes];
  const out: BreadthRequirement[] = [];
  for (const c of programConstraints(program)) {
    const parsed = parseBreadthConstraint(c);
    if (!parsed) continue;
    const set = new Set(parsed.subjects);
    const satisfiers = placed.filter((code) => set.has(subjectOf(code)));
    const placedUnits = satisfiers.reduce(
      (sum, code) => sum + unitsOf(code),
      0,
    );
    out.push({ ...parsed, placedUnits, satisfiers });
  }
  return out;
}

/** Constraints that aren't trackable breadth — surfaced verbatim as notes. */
export function nonBreadthConstraints(program: Program): UnitConstraint[] {
  return programConstraints(program).filter(
    (c) => parseBreadthConstraint(c) === null,
  );
}
