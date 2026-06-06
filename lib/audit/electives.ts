import { truncate } from "@/lib/format";
import type { ElectiveCategory, Program } from "@/lib/programs";

/**
 * Elective rules (`program.electives[]`) are not part of the compiled rule
 * tree — they're free-text requirement notes carried alongside it. This module
 * classifies each note into one of two UI treatments, driven entirely by the
 * shape of its `description`/`approvedCourses` (see the real shapes in
 * `data/programs.json`):
 *
 * - **finite** — "Complete N of the following: …" with a fixed `approvedCourses`
 *   list. There IS a specific missing set, so the panel renders a ring + the
 *   approved courses as draggable chips.
 * - **browse** — everything else: open reference lists ("Natural Science List",
 *   "Technical Electives List"), cross-list references ("Complete 2 additional
 *   courses from List 1 or List 2"), and unit-based rules ("Complete a minimum
 *   of 0.5 unit of BIOL/CHEM/…"). There's no fixed list to drag, so the panel
 *   renders a Browse action instead. Unit-based notes deliberately show NO
 *   fabricated progress (the catalog carries no per-course unit values).
 */

/** "Complete 2 of the following: …" → a finite, draggable approved list. */
const FINITE_RE = /^complete\s+(\d+)\s+of the following/i;

export interface FiniteElectiveSection {
  kind: "finite";
  title: string;
  /** Count to satisfy, parsed from the description. */
  need: number;
  /** Approved course codes (lowercase, catalog form). */
  options: string[];
  /** Verbatim requirement statement, when the source provides one. */
  sourceText?: string;
}

export interface BrowseElectiveSection {
  kind: "browse";
  title: string;
  /** Eligible codes to pre-filter the picker with (may be empty). */
  eligibleCodes: string[];
  /** Measured in units rather than a course count — no honest progress ring. */
  unitBased: boolean;
  /** Verbatim requirement statement, when the source provides one. */
  sourceText?: string;
}

export type ElectiveSection = FiniteElectiveSection | BrowseElectiveSection;

/**
 * A clean section label. Many descriptions carry a giant embedded course list
 * after a colon ("Complete N of the following: AE311 - … (0.50)CIVE…"); keep
 * only the requirement clause. Unit-style descriptions ("6.0 units of ANTH
 * courses") have no colon and pass through unchanged.
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

export function classifyElective(e: ElectiveCategory): ElectiveSection {
  const desc = e.description.trim();
  const m = desc.match(FINITE_RE);
  // A finite count comes from the description ("Complete N of the following")
  // or the recovered `requiredCount` (a "Technical Electives List" whose count
  // lived in the source rule text). Either way, with an approved list it's a
  // trackable, draggable finite elective.
  const need = m ? Number(m[1]) : e.requiredCount;
  if (need != null && e.approvedCourses && e.approvedCourses.length > 0) {
    return {
      kind: "finite",
      title: electiveTitle(e),
      need,
      options: e.approvedCourses,
      ...(e.sourceText ? { sourceText: e.sourceText } : {}),
    };
  }
  return {
    kind: "browse",
    title: electiveTitle(e),
    eligibleCodes: e.approvedCourses ?? [],
    unitBased: e.unitRequirement != null || /\bunits?\b/i.test(desc),
    ...(e.sourceText ? { sourceText: e.sourceText } : {}),
  };
}

/**
 * Collapse overlapping elective lists. The UW scrape sometimes emits a pool
 * both as its sub-lists AND as the aggregate that unions them — e.g. Biomedical
 * has "Complete 1 of {List 1}", "Complete 1 of {List 2}", "Complete 1 of {List
 * 3}" (37 + 2 + 16 codes) plus a "Technical Electives List" whose 55 approved
 * codes are EXACTLY List 1 ∪ 2 ∪ 3. Counted naively that's the same ~7 courses
 * required twice. When one list's `approvedCourses` equals the union of ≥2
 * others', drop the subsumed sub-lists and keep only the aggregate — one honest
 * requirement, one row. (The sub-lists' "≥1 from each" wording is dropped from
 * tracking; the aggregate's own `sourceText` still shows the verbatim rule.)
 */
export function consolidateElectives(
  cats: readonly ElectiveCategory[],
): ElectiveCategory[] {
  const withList = cats.filter(
    (e) => e.approvedCourses && e.approvedCourses.length > 0,
  );
  const subsumed = new Set<ElectiveCategory>();
  for (const agg of withList) {
    const aggSet = new Set(agg.approvedCourses);
    const parts = withList.filter(
      (o) =>
        o !== agg &&
        !subsumed.has(o) &&
        o.approvedCourses!.every((c) => aggSet.has(c)),
    );
    if (parts.length < 2) continue;
    const union = new Set(parts.flatMap((o) => o.approvedCourses!));
    // The aggregate must be EXACTLY the union of its parts (no extra codes, no
    // gaps) — otherwise it's a distinct list that merely overlaps, not a parent.
    if (union.size !== aggSet.size) continue;
    for (const p of parts) subsumed.add(p);
  }
  return cats.filter((e) => !subsumed.has(e));
}

/**
 * Classify every elective rule for a program, disambiguating repeated titles
 * (e.g. Biomedical has three "Complete 1 of the following" rules) with a
 * trailing index so each renders as a distinct section.
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
