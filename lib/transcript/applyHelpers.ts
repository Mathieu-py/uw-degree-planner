import type { TermLetter } from "../programs";
import type { StudentPassage } from "../types";
import type { ParsedCourse, TranscriptParseResult } from "./types";

export interface Categorized {
  passed: ParsedCourse[];
  inProgress: ParsedCourse[];
  transfer: ParsedCourse[];
  skipped: ParsedCourse[];
  unrecognized: ParsedCourse[];
}

export interface TranscriptImportPayload {
  codes: string[];
  programId: string | null;
  currentTerm: TermLetter | null;
  specializationId: string | null;
  systemOfStudy: "coop" | "regular" | null;
}

/**
 * Bucket each parsed course by status. Courses with a real status but a
 * code not in the loaded catalog are demoted to `unrecognized` so the
 * modal can prompt the user before adopting them.
 */
export function categorize(
  parseResult: TranscriptParseResult,
  catalog: ReadonlySet<string>,
): Categorized {
  const out: Categorized = {
    passed: [],
    inProgress: [],
    transfer: [],
    skipped: [],
    unrecognized: [],
  };
  for (const c of parseResult.courses) {
    if (c.status === "skipped") {
      out.skipped.push(c);
      continue;
    }
    if (c.status === "unrecognized" || !catalog.has(c.code)) {
      out.unrecognized.push(c);
      continue;
    }
    if (c.status === "passed") out.passed.push(c);
    else if (c.status === "inProgress") out.inProgress.push(c);
    else if (c.status === "transfer") out.transfer.push(c);
  }
  return out;
}

/**
 * Compose the apply payload. Skipped courses are always excluded.
 * Unrecognized codes are included only if they appear in
 * `includedUnrecognized` — that Set is the user's explicit opt-in.
 */
export function buildImportPayload(
  parseResult: TranscriptParseResult,
  categorized: Categorized,
  includedUnrecognized: ReadonlySet<string>,
): TranscriptImportPayload {
  const codes = new Set<string>([
    ...categorized.passed.map((c) => c.code),
    ...categorized.inProgress.map((c) => c.code),
    ...categorized.transfer.map((c) => c.code),
    ...categorized.unrecognized
      .filter((c) => includedUnrecognized.has(c.code))
      .map((c) => c.code),
  ]);
  return {
    codes: [...codes].sort(),
    programId: parseResult.detectedProgramId,
    currentTerm: parseResult.detectedCurrentTerm,
    specializationId: parseResult.detectedSpecializationSlug,
    systemOfStudy: parseResult.detectedSystemOfStudy,
  };
}

/**
 * Build a new StudentPassage from a transcript-import payload. The transcript
 * IS the source of truth — every passage field is replaced. Pure filters
 * (catalog view chips) are a separate slice and untouched at the call site.
 */
export function applyTranscriptToStudentPassage(
  payload: TranscriptImportPayload,
): StudentPassage {
  return {
    programId: payload.programId,
    currentTerm: payload.currentTerm,
    completedCourses: payload.codes,
    specializationId: payload.specializationId,
    choiceGroupSelections: {},
    systemOfStudy: payload.systemOfStudy,
  };
}
