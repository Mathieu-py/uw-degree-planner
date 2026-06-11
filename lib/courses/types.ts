import type { PrereqNode } from "@/lib/prereqs/parse";

/** A course from UWFlow's GraphQL endpoint (upstream snake_case schema). */
export interface UWFlowRating {
  easy: number | null;
  useful: number | null;
  liked: number | null;
  filled_count: number | null;
}

/**
 * A course section's seating, as stored in the snapshot. Sourced from UW Open
 * Data's class schedules (the registrar's live enrolment), keyed names kept for
 * back-compat with the original UWFlow shape.
 */
export interface CourseSection {
  id: number;
  enrollment_total: number;
  enrollment_capacity: number;
}

/**
 * The base course record assembled by the catalog builder, before snapshot
 * derivations. Fields come from several UW sources joined by code: name,
 * description, requirement prose and `rating` from UWFlow; `sections` from UW
 * Open Data; units/cross-listings/requisite ASTs are added on {@link CatalogCourse}.
 */
export interface BaseCourse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  prereqs: string | null;
  coreqs: string | null;
  antireqs: string | null;
  rating: UWFlowRating | null;
  sections: CourseSection[];
}

/**
 * A course in the committed catalog snapshot. `description` is excluded (it
 * dominates the file and only /course/[code] reads it, so it lives in a sibling
 * descriptions file).
 */
export type CatalogCourse = Omit<BaseCourse, "description"> & {
  /**
   * Unit weight: 0.5 standard, 0.25 lab/seminar, 1.0+ full-year. UWFlow doesn't
   * expose it, so the fetch script enriches from Kuali. `undefined` when
   * unknown — the audit counts the course rather than misreport units.
   */
  units?: number;
  /**
   * Cross-listed equivalents — the same course offered under another code, from
   * Kuali's authoritative `crossListedCourses` field (lowercased codes). UW's
   * source for course equivalence: a student who took one member has effectively
   * taken the others (GitHub #21). `undefined`/absent when the course has none.
   */
  crossListed?: string[];
  /**
   * Antirequisite course codes from Kuali's structured `antirequisites` rule
   * tree (lowercased) — the authoritative replacement for parsing UWFlow's
   * free-text `antireqs`. When present, the validator/eligibility prefer this
   * over the regex (see `resolveAntireqCodes`). `undefined` when Kuali has no
   * structured antireqs for the course → callers fall back to the prose.
   */
  antireqCodes?: string[];
  /**
   * Prerequisite AST parsed from Kuali's structured `prerequisites` rule tree at
   * build time — the authoritative replacement for parsing UWFlow's free-text
   * `prereqs` at runtime. When present, callers prefer it (see `resolvePrereqs`);
   * `undefined`/absent → fall back to the prose parser. Stored only when Kuali
   * yields a non-empty tree.
   */
  prereqAst?: PrereqNode | null;
  /** Corequisite AST, same contract as {@link prereqAst} (see `resolveCoreqs`). */
  coreqAst?: PrereqNode | null;
};

/** Course enriched with derived fields used by filters and UI. */
export interface Course extends CatalogCourse {
  prefix: string;
  level: number;
  hasSeats: boolean;
}

/**
 * A catalog course re-joined with its calendar description, for the detail
 * page. Everywhere else uses the lean {@link Course}.
 */
export type CourseDetail = Course & { description: string | null };

/**
 * Filter predicates acting on a Course in isolation. `hideUnmetPrereqs` is a
 * presentation toggle — a no-op when the completed list is empty.
 */
export interface PureFilters {
  /** Subject prefixes to hide (deny-list). Empty = disabled. */
  excludePrefixes: string[];
  /**
   * Subject prefixes to restrict results to (allow-list). Empty = disabled;
   * non-empty shows ONLY these prefixes. `excludePrefixes` still applies, so a
   * prefix in both lists is hidden (exclude wins).
   */
  includePrefixes: string[];
  levels: number[];
  hasSeatsAvailable: boolean;
  hideUnmetPrereqs: boolean;
  minUseful: number | null;
  minEasy: number | null;
}

/**
 * Filter values to pre-apply when the slot picker opens — e.g. an audit
 * subject-pool "Browse" seeds its subjects (as `includePrefixes`) and level
 * range, which the student can adjust.
 */
export interface FilterPreset {
  includePrefixes?: string[];
  levels?: number[];
}
