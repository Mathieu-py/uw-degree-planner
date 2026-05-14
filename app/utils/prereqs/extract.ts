/**
 * Layer 1 of the prereq pipeline: pull canonical course-code tokens out of
 * a free-text prereq string. Knows nothing about boolean structure — for
 * "MATH116 or MATH117" it returns ["math116", "math117"] without saying
 * which one suffices. Layer 2 (parse.ts) handles operators.
 *
 * Course-code shapes observed in UWFlow data:
 *   MATH116, AFM 101, BUS393W, AE300, MTHEL100, AFM382/AFM481
 * Catalog numbers are 3 digits with an optional trailing letter.
 */

const COURSE_CODE_RE = /\b([A-Z]{2,7})\s?(\d{3}[A-Z]?)\b/g;

export function normalizeCourseCode(code: string): string {
  return code.replace(/\s+/g, "").toLowerCase();
}

export function extractCourseCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(COURSE_CODE_RE)) {
    const code = normalizeCourseCode(`${match[1]}${match[2]}`);
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
