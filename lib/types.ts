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
 * Active set of filters. Every UI control writes through to this shape;
 * URL search params encode it for shareable views.
 */
export interface FilterState {
  excludePrefixes: string[];
  includePrefixes: string[];
  levels: number[];
  hasSeatsAvailable: boolean;
  completedCourses: string[];
  hideUnmetPrereqs: boolean;
  ratingAndThreshold: { easy: number; useful: number } | null;
  minUseful: number | null;
  minEasy: number | null;
}
