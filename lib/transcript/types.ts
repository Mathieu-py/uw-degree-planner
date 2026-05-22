import type { TermLetter } from "../programs";

export type CourseStatus =
  | "passed"
  | "in-progress"
  | "skipped"
  | "transfer"
  | "unrecognized";

export interface ParsedCourse {
  code: string;
  name: string;
  termLabel: string;
  status: CourseStatus;
  rawGrade: string;
}

export interface TranscriptParseResult {
  detectedProgramId: string | null;
  detectedCurrentTerm: TermLetter | null;
  rawPlanText: string | null;
  courses: ParsedCourse[];
  warnings: string[];
}
