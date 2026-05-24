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
 * Course enriched with derived fields used by filters and UI.
 */
export interface Course extends UWFlowCourse {
  prefix: string;
  level: number;
  hasSeats: boolean;
}

export type TermId = number;

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
