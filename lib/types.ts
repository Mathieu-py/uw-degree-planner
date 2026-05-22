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

export interface UWFlowSection {
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
 * Course enriched with derived fields used by filters and UI.
 */
export interface Course extends UWFlowCourse {
  prefix: string;
  level: number;
  hasSeats: boolean;
}

export type TermId = number;

/**
 * Filter predicates that act on a Course in isolation. URL-encoded for
 * shareable views. `hideUnmetPrereqs` is a presentation toggle — an empty
 * `completedCourses` (see StudentPassage) makes it a no-op.
 */
export interface PureFilters {
  excludePrefixes: string[];
  levels: number[];
  hasSeatsAvailable: boolean;
  hideUnmetPrereqs: boolean;
  minUseful: number | null;
  minEasy: number | null;
}

/**
 * The student's academic context: which program they're in, which term they're
 * planning for, and which courses they've completed. `programId`/`currentTerm`
 * are URL-encoded so a seeded view is shareable; `completedCourses` is profile
 * data persisted in localStorage and never written to the URL.
 */
export interface StudentPassage {
  programId: string | null;
  currentTerm: string | null;
  completedCourses: string[];
}
