import { type PoolFilter, poolMatch } from "@/lib/courses/code";
import { countNoun, truncate } from "@/lib/format";
import type { ElectiveCategory, Program } from "@/lib/programs";
import { LEVEL_BOUND_RE, subjectList } from "./constraints";

/**
 * Elective rules (`program.electives[]`) are free-text notes carried alongside
 * the rule tree. Classify each by the shape of its `description`/
 * `approvedCourses` into one UI treatment:
 *
 * - **finite** — "Complete N of the following" + fixed list → ring + draggable
 *   approved-course chips.
 * - **subjectPool** — a unit-based subject + level filter ("0.5 unit of
 *   BIOL/CHEM/… at 200+") → trackable ring; any in-scope placed course counts.
 * - **browse** — everything else (open lists, cross-list refs, listless unit
 *   rules) → a Browse action, nothing to drag.
 */

interface FiniteElectiveSection {
  kind: "finite";
  title: string;
  /** Count to satisfy, parsed from the description. */
  need: number;
  /** Approved course codes (lowercase, catalog form). */
  options: string[];
  /** Verbatim requirement statement, when the source provides one. */
  sourceText?: string;
}

interface BrowseElectiveSection {
  kind: "browse";
  title: string;
  /** Eligible codes to pre-filter the picker with (may be empty). */
  eligibleCodes: string[];
  /** Measured in units rather than a course count — no honest progress ring. */
  unitBased: boolean;
  /** Verbatim requirement statement, when the source provides one. */
  sourceText?: string;
}

/**
 * A unit-based SUBJECT + LEVEL filter ("0.5 unit of BIOL/CHEM/HLTH/KIN at 200+").
 * Trackable: any placed course whose prefix is in `subjects` and level fits the
 * bounds counts toward a ring. `need` is the course count (units ÷ 0.5).
 */
export interface SubjectPoolElectiveSection {
  kind: "subjectPool";
  title: string;
  /** Lowercase subject prefixes, e.g. ["biol", "chem", "hlth", "kin"]. */
  subjects: string[];
  /** Inclusive level bounds (bucketed to the hundred), when stated. */
  minLevel?: number;
  maxLevel?: number;
  /** Courses to complete = stated units ÷ 0.5 (for the headline bucket). */
  need: number;
  /** Units required, exactly as the calendar states it (for display). */
  needUnits: number;
  /** Verbatim requirement statement, when the source provides one. */
  sourceText?: string;
}

export type ElectiveSection =
  | FiniteElectiveSection
  | BrowseElectiveSection
  | SubjectPoolElectiveSection;

/** "Complete 2 of the following: …" → a finite, draggable approved list. */
const FINITE_RE = /^complete\s+(\d+)\s+of the following/i;

// A connective clause referencing sibling lists by position ("Complete 3
// additional courses from the above lists", "… from List 3") rather than
// carrying its own pool.
const CROSS_LIST_CONNECTIVE_RE =
  /from the above lists?|from List\s+\d|from the following lists/i;

/** "… N units of <subjects> courses …" — a unit-based subject filter. */
const SUBJECT_POOL_RE =
  /(\d+(?:\.\d+)?)\s*units?\s+of\s+([a-z][a-z,/&\s]*?)\s+courses?/i;

/**
 * Parse a subject-pool rule into a trackable section, or null if the text isn't
 * that shape. Count comes from `unitRequirement`, else the units in the text.
 */
function parseSubjectPoolElective(
  e: ElectiveCategory,
): SubjectPoolElectiveSection | null {
  const desc = e.description.trim();
  const m = desc.match(SUBJECT_POOL_RE);
  const units = e.unitRequirement ?? (m ? Number(m[1]) : null);
  if (units == null || !m) return null;
  const subjects = subjectList(m[2]);
  if (subjects.length === 0) return null;

  const lvl = desc.match(LEVEL_BOUND_RE);
  const section: SubjectPoolElectiveSection = {
    kind: "subjectPool",
    title: `${countNoun(units, "unit")} of ${subjects
      .map((s) => s.toUpperCase())
      .join(
        "/",
      )}${lvl ? ` (${lvl[1]}${/below|lower/i.test(lvl[2]) ? "-" : "+"})` : ""}`,
    subjects,
    need: Math.max(1, Math.round(units / 0.5)),
    needUnits: units,
    ...(e.sourceText ? { sourceText: e.sourceText } : {}),
  };
  if (lvl) {
    const n = Number(lvl[1]);
    if (/below|lower/i.test(lvl[2])) section.maxLevel = n;
    else section.minLevel = n;
  }
  return section;
}

/** A subject-pool elective section as a {@link PoolFilter}. Build once per
 *  section (the `subjects` Set is reused across every placed code tested). */
export function subjectPoolFilter(s: SubjectPoolElectiveSection): PoolFilter {
  return {
    subjects: new Set(s.subjects),
    minLevel: s.minLevel,
    maxLevel: s.maxLevel,
  };
}

/** Whether a placed course satisfies a subject-pool section's subject + level.
 *  For a hot loop over many codes, build the filter once via
 *  {@link subjectPoolFilter} and call `poolMatch` directly instead. */
export function subjectPoolEligible(
  code: string,
  s: SubjectPoolElectiveSection,
): boolean {
  return poolMatch(code, subjectPoolFilter(s));
}

/**
 * A clean section label. Descriptions often embed a course list after a colon
 * ("Complete N of the following: AE311 - …") — keep only the clause before it.
 * Colon-less unit descriptions ("6.0 units of ANTH courses") pass through.
 */
function electiveTitle(e: ElectiveCategory): string {
  const desc = e.description.trim();
  const m = desc.match(FINITE_RE);
  if (m) return `Complete ${m[1]} of the following`;
  const head = desc.split(":")[0].trim();
  return head.length > 0 && head.length < desc.length
    ? head
    : truncate(desc, 140);
}

/** A category carrying a non-empty approved-course list (narrows the optional). */
type WithList = ElectiveCategory & { approvedCourses: string[] };
const hasApprovedList = (e: ElectiveCategory): e is WithList =>
  e.approvedCourses != null && e.approvedCourses.length > 0;

export function classifyElective(e: ElectiveCategory): ElectiveSection {
  const desc = e.description.trim();
  const m = desc.match(FINITE_RE);
  // Count from the description ("Complete N…") or recovered `requiredCount`;
  // with an approved list, a trackable draggable finite list.
  const need = m ? Number(m[1]) : e.requiredCount;
  if (need != null && hasApprovedList(e)) {
    return {
      kind: "finite",
      title: electiveTitle(e),
      need,
      options: e.approvedCourses,
      ...(e.sourceText ? { sourceText: e.sourceText } : {}),
    };
  }
  // A subject+level filter is trackable without a fixed list — prefer it over
  // the plain browse fallback.
  const pool = parseSubjectPoolElective(e);
  if (pool) return pool;
  return {
    kind: "browse",
    title: electiveTitle(e),
    eligibleCodes: e.approvedCourses ?? [],
    unitBased: e.unitRequirement != null || /\bunits?\b/i.test(desc),
    ...(e.sourceText ? { sourceText: e.sourceText } : {}),
  };
}

/**
 * Collapse overlapping elective lists. The scrape sometimes emits a pool as
 * both its sub-lists AND the aggregate unioning them (e.g. Biomedical's three
 * "Complete 1 of {List N}" plus a "Technical Electives List" = List 1∪2∪3),
 * double-counting. When one list's `approvedCourses` exactly equals the union
 * of ≥2 others', drop those subsumed sub-lists and keep the aggregate.
 */
export function consolidateElectives(
  cats: readonly ElectiveCategory[],
): ElectiveCategory[] {
  const withList = cats.filter(hasApprovedList);
  const subsumed = new Set<ElectiveCategory>();
  for (const agg of withList) {
    const aggSet = new Set(agg.approvedCourses);
    const parts = withList.filter(
      (o) =>
        o !== agg &&
        !subsumed.has(o) &&
        o.approvedCourses.every((c) => aggSet.has(c)),
    );
    if (parts.length < 2) continue;
    const union = new Set(parts.flatMap((o) => o.approvedCourses));
    // Aggregate must be EXACTLY the union of its parts (no extras, no gaps),
    // else it's a distinct list that merely overlaps, not a parent.
    if (union.size !== aggSet.size) continue;
    for (const p of parts) subsumed.add(p);
  }
  // If consolidation fired, also drop courseless "connective" orphans that
  // reference the collapsed lists by position ("Complete 3 more from the above
  // lists…"): their count is already in the aggregate, and they'd dangle.
  // Gated on `subsumed.size` so that with no aggregate to absorb it, we keep
  // the orphan rather than hide a requirement nothing else represents.
  if (subsumed.size > 0) {
    for (const e of cats) {
      if (!hasApprovedList(e) && CROSS_LIST_CONNECTIVE_RE.test(e.description)) {
        subsumed.add(e);
      }
    }
  }
  return cats.filter((e) => !subsumed.has(e));
}

/**
 * Classify every elective rule for a program, disambiguating repeated titles
 * (e.g. three "Complete 1 of the following") with a trailing index.
 */
export function deriveElectiveSections(program: Program): ElectiveSection[] {
  const cats = consolidateElectives(program.electives ?? []);
  const seen = new Map<string, number>();
  return cats.map((e) => {
    const section = classifyElective(e);
    const n = (seen.get(section.title) ?? 0) + 1;
    seen.set(section.title, n);
    return n > 1 ? { ...section, title: `${section.title} (${n})` } : section;
  });
}
