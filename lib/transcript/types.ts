import type { TermLetter } from "@/lib/programs";

export type CourseStatus =
  | "passed"
  | "inProgress"
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
  detectedSpecializationSlug: string | null;
  detectedCurrentTerm: TermLetter | null;
  detectedSystemOfStudy: "coop" | "regular" | null;
  rawPlanText: string | null;
  courses: ParsedCourse[];
  warnings: string[];
}
