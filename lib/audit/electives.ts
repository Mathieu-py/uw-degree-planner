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
}

export interface BrowseElectiveSection {
  kind: "browse";
  title: string;
  /** Eligible codes to pre-filter the picker with (may be empty). */
  eligibleCodes: string[];
  /** Measured in units rather than a course count — no honest progress ring. */
  unitBased: boolean;
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
    : truncate(desc, 90);
}

export function classifyElective(e: ElectiveCategory): ElectiveSection {
  const desc = e.description.trim();
  const m = desc.match(FINITE_RE);
  if (m && e.approvedCourses && e.approvedCourses.length > 0) {
    return {
      kind: "finite",
      title: electiveTitle(e),
      need: Number(m[1]),
      options: e.approvedCourses,
    };
  }
  return {
    kind: "browse",
    title: electiveTitle(e),
    eligibleCodes: e.approvedCourses ?? [],
    unitBased: e.unitRequirement != null || /\bunits?\b/i.test(desc),
  };
}

/**
 * Classify every elective rule for a program, disambiguating repeated titles
 * (e.g. Biomedical has three "Complete 1 of the following" rules) with a
 * trailing index so each renders as a distinct section.
 */
export function deriveElectiveSections(program: Program): ElectiveSection[] {
  const cats = program.electives ?? [];
  const seen = new Map<string, number>();
  return cats.map((e) => {
    const section = classifyElective(e);
    const n = (seen.get(section.title) ?? 0) + 1;
    seen.set(section.title, n);
    return n > 1 ? { ...section, title: `${section.title} (${n})` } : section;
  });
}
