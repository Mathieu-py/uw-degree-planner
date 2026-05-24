import type { ParsedCourse, TranscriptParseResult } from "./types";

export interface Categorized {
  passed: ParsedCourse[];
  inProgress: ParsedCourse[];
  transfer: ParsedCourse[];
  skipped: ParsedCourse[];
  unrecognized: ParsedCourse[];
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
