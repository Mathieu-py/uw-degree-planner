/**
 * Shape of a course as returned by UWFlow's GraphQL endpoint.
 * Field names match the upstream schema and use snake_case.
 */
export interface UWFlowRating {
  easy: number | null;
  useful: number | null;
  liked: number | null;
  filled_count: number | null;
}

interface UWFlowSection {
  id: number;
  enrollment_total: number;
  enrollment_capacity: number;
}

export interface UWFlowCourse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  prereqs: string | null;
  coreqs: string | null;
  antireqs: string | null;
  rating: UWFlowRating | null;
  sections: UWFlowSection[];
}

/**
 * A course as persisted in the committed catalog snapshot. `description` is
 * deliberately excluded — that prose is the bulk of the file and is only read
 * by the /course/[code] route, so it lives in a sibling descriptions file
 * instead of being shipped with every catalog payload.
 */
export type CatalogCourse = Omit<UWFlowCourse, "description"> & {
  /**
   * Course unit weight (credits): 0.5 for a standard course, 0.25 for a
   * lab/seminar, 1.0+ for a full-year course. UWFlow doesn't expose this, so
   * the fetch script enriches each course from the Kuali course catalog.
   * `undefined` when no weight is known — the audit then counts the course
   * rather than misreporting its units.
   */
  units?: number;
};

/**
 * Course enriched with derived fields used by filters and UI.
 */
export interface Course extends CatalogCourse {
  prefix: string;
  level: number;
  hasSeats: boolean;
}

/**
 * A catalog course re-joined with its calendar description, for the course
 * detail page. Everywhere else uses the lean {@link Course}.
 */
export type CourseDetail = Course & { description: string | null };

/**
 * Filter predicates that act on a Course in isolation. `hideUnmetPrereqs` is
 * a presentation toggle — an empty completed-courses list makes it a no-op.
 */
export interface PureFilters {
  excludePrefixes: string[];
  levels: number[];
  hasSeatsAvailable: boolean;
  hideUnmetPrereqs: boolean;
  minUseful: number | null;
  minEasy: number | null;
}
