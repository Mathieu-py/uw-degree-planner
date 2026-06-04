import type { Program, UnitConstraint } from "@/lib/programs";

/**
 * Faculty breadth / distribution requirements arrive as verbatim notes
 * (`program.unitPlan.constraints` / `program.degreeRequirements.constraints`),
 * e.g. "Humanities — 1.0 unit: CLAS, ENGL, HIST, MEDVL, PHIL". Every such note
 * in the catalog states a 0.5-unit-multiple amount and an explicit subject list,
 * so it converts losslessly to a *course count*: "complete 2 courses from {CLAS,
 * ENGL, HIST, MEDVL, PHIL}".
 *
 * That count is a reliable, trackable requirement precisely because it's an
 * INDEPENDENT subject filter over the plan — "how many placed courses are in
 * these subjects?" There's no allocation (a course can satisfy breadth AND the
 * major, as real audits allow) and no reconciliation against a unit total, so it
 * can't reproduce the count-vs-units contradictions the old unit engine did.
 *
 * The one assumption is 0.5 units per course; a rare 1.0-unit course in a
 * breadth subject counts as one toward the requirement (mild under-credit). The
 * requirement *statement* itself is exact.
 */
export interface BreadthRequirement {
  /** Display name, e.g. "Humanities". */
  title: string;
  /** Subject prefixes that satisfy it (uppercase), e.g. ["CLAS", "ENGL", …]. */
  subjects: string[];
  /** Courses needed = stated units ÷ 0.5. */
  need: number;
  /** Distinct placed courses whose subject is in `subjects`. */
  placed: number;
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
): Omit<BreadthRequirement, "placed" | "satisfiers"> | null {
  const src = c.sourceText ?? "";
  const um = src.match(UNIT_RE);
  if (!um) return null;
  const units = Number(um[1]);
  if (!Number.isFinite(units) || units <= 0) return null;
  const need = Math.round(units / 0.5);

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
  return { title, subjects, need, sourceText: src };
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
): BreadthRequirement[] {
  const placed = [...placedCodes];
  const out: BreadthRequirement[] = [];
  for (const c of programConstraints(program)) {
    const parsed = parseBreadthConstraint(c);
    if (!parsed) continue;
    const set = new Set(parsed.subjects);
    const satisfiers = placed.filter((code) => set.has(subjectOf(code)));
    out.push({ ...parsed, placed: satisfiers.length, satisfiers });
  }
  return out;
}

/** Constraints that aren't trackable breadth — surfaced verbatim as notes. */
export function nonBreadthConstraints(program: Program): UnitConstraint[] {
  return programConstraints(program).filter(
    (c) => parseBreadthConstraint(c) === null,
  );
}
