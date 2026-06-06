/**
 * Elective rules (`program.electives[]`) are not part of the compiled rule
 * tree — they're free-text requirement notes carried alongside it. This module
 * classifies each note into one of these UI treatments, driven entirely by the
 * shape of its `description`/`approvedCourses` (see the real shapes in
 * `data/programs.json`):
 *
 * - **finite** — "Complete N of the following: …" with a fixed `approvedCourses`
 *   list. There IS a specific missing set, so the panel renders a ring + the
 *   approved courses as draggable chips.
 * - **subjectPool** — a unit-based SUBJECT + LEVEL filter ("0.5 unit of
 *   BIOL/CHEM/… at 200+"). Trackable like a rule-tree `subjectPool`: any
 *   in-scope placed course counts, so it gets a real progress ring.
 * - **browse** — everything else: open reference lists ("Natural Science
 *   List"), cross-list references, and unit-based rules with no fixed list.
 *   There's no fixed list to drag, so the panel renders a Browse action.
 */

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

/**
 * A unit-based rule over a SUBJECT + LEVEL filter ("Complete 0.5 unit of BIOL,
 * CHEM, HLTH, or KIN courses at the 200-level or above"). Unlike a plain browse,
 * this IS trackable: any placed course whose prefix is in `subjects` and whose
 * level fits the bounds counts, so it gets a real progress ring (like a rule-tree
 * `subjectPool`). `need` is the course count (units ÷ 0.5).
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
