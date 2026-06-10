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
  /**
   * Every program resolved from the transcript's `Plan:`/`Program:` lines, in
   * order of appearance, deduped. Empty when nothing resolved. More than one =
   * a double-degree. The first is the primary (anchors the raw display text).
   */
  detectedProgramIds: string[];
  /**
   * Per-program specialization detected from spec-bearing `Plan:` lines:
   * `programId → specialization slug`. A double-degree transcript can carry one
   * per program. Empty when none detected; a program with no spec is absent.
   */
  detectedSpecializationsByProgramId: Record<string, string>;
  detectedCurrentTerm: TermLetter | null;
  detectedSystemOfStudy: "coop" | "regular" | null;
  rawPlanText: string | null;
  courses: ParsedCourse[];
  warnings: string[];
}
