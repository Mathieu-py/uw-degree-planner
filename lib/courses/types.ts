import type { PrereqNode } from "@/lib/prereqs/parse";

/** A course from UWFlow's GraphQL endpoint (upstream snake_case schema). */
export interface UWFlowRating {
  easy: number | null;
  useful: number | null;
  liked: number | null;
  filled_count: number | null;
}

/**
 * A course section's seating in the snapshot. Sourced from UW Open Data class
 * schedules; field names kept for back-compat with the original UWFlow shape.
 */
export interface CourseSection {
  id: number;
  enrollment_total: number;
  enrollment_capacity: number;
}

/**
 * Base course record from the catalog builder, before snapshot derivations.
 * Joined by code from several sources: name/description/prose/`rating` from
 * UWFlow, `sections` from UW Open Data; units/cross-listings/ASTs added on
 * {@link CatalogCourse}.
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
 * A course in the committed catalog snapshot. `description` is excluded — it
 * dominates the file and only /course/[code] reads it, so it lives in a sibling
 * descriptions file.
 */
export type CatalogCourse = Omit<BaseCourse, "description"> & {
  /**
   * Unit weight: 0.5 standard, 0.25 lab/seminar, 1.0+ full-year. Enriched from
   * Kuali (UWFlow lacks it). `undefined` when unknown — the audit counts the
   * course rather than misreport units.
   */
  units?: number;
  /**
   * Cross-listed equivalents (lowercased) from Kuali's authoritative
   * `crossListedCourses` — UW's source for course equivalence; one member counts
   * as the others (GitHub #21). Absent when none.
   */
  crossListed?: string[];
  /**
   * Antireq codes (lowercased) from Kuali's structured `antirequisites` — the
   * authoritative replacement for parsing UWFlow's free-text `antireqs`. Preferred
   * when present (see `resolveAntireqCodes`); else fall back to the prose. An
   * EMPTY array means Kuali authoritatively lists zero antireqs — it suppresses
   * the prose fallback rather than triggering it.
   */
  antireqCodes?: string[];
  /**
   * Prereq AST built from Kuali's structured `prerequisites` — authoritative
   * replacement for parsing UWFlow's free-text `prereqs`. Preferred when present
   * (see `resolvePrereqs`); else fall back to the prose parser. Stored only when
   * Kuali yields a non-empty tree.
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

/** Catalog course re-joined with its description, for the detail page. Elsewhere uses {@link Course}. */
export type CourseDetail = Course & { description: string | null };

/** Filter predicates on a Course in isolation. `hideUnmetPrereqs` is a no-op when completed is empty. */
export interface PureFilters {
  /** Subject prefixes to hide (deny-list). Empty = disabled. */
  excludePrefixes: string[];
  /**
   * Subject prefixes to restrict to (allow-list). Empty = disabled. A prefix in
   * both lists is hidden — exclude wins.
   */
  includePrefixes: string[];
  levels: number[];
  hasSeatsAvailable: boolean;
  hideUnmetPrereqs: boolean;
  minUseful: number | null;
  minEasy: number | null;
}

/**
 * Filter values to pre-apply when the slot picker opens — e.g. a "Browse" seeds
 * its subjects (as `includePrefixes`) and level range, which the student can adjust.
 */
export interface FilterPreset {
  includePrefixes?: string[];
  levels?: number[];
}
