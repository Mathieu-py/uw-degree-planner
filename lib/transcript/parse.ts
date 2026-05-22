import { PROGRAMS, TERM_LETTERS, type TermLetter } from "../programs";
import type { CourseStatus, ParsedCourse, TranscriptParseResult } from "./types";

export type { CourseStatus, ParsedCourse, TranscriptParseResult } from "./types";

const TERM_HEADER_RE = /^(Fall|Winter|Spring)\s+(\d{4})\s*$/i;
const TRANSFER_HEADER_RE = /^Transfer\s+Credit\s*$/i;
const WORK_TERM_HEADER_RE = /^(Co-?op\s+)?Work\s+Term\b/i;
const PLAN_LINE_RE = /^Plan:\s*(.+?)\s*$/i;

// Course-code at start of line, strictly uppercase to avoid matching metadata
// like "Spring 2024 Average: 78". The trailing tail (description + any unit
// columns + grade) is captured greedily; the grade is the last whitespace
// token on the line.
const COURSE_ROW_RE = /^([A-Z]{2,8})\s*(\d{1,4}[A-Z]?)\b\s*(.+)$/;

const STATUS_PRIORITY: Record<CourseStatus, number> = {
  passed: 5,
  "in-progress": 4,
  transfer: 3,
  skipped: 2,
  unrecognized: 1,
};

type SectionState =
  | { kind: "none" }
  | { kind: "transfer" }
  | { kind: "term"; label: string; studyIndex: number | null };

export function parseTranscript(text: string): TranscriptParseResult {
  if (!text.trim()) {
    return {
      detectedProgramId: null,
      detectedCurrentTerm: null,
      rawPlanText: null,
      courses: [],
      warnings: [],
    };
  }

  const lines = text.split(/\r?\n/);

  let rawPlanText: string | null = null;
  let currentSection: SectionState = { kind: "none" };
  let studyTermCounter = 0;
  let currentTermIPIdx = -1;
  let lastPassedTermIdx = -1;
  const rawCourses: ParsedCourse[] = [];
  const warnings: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (rawPlanText === null) {
      const planMatch = PLAN_LINE_RE.exec(line);
      if (planMatch) {
        rawPlanText = planMatch[1];
        continue;
      }
    }

    const termHeader = TERM_HEADER_RE.exec(line);
    if (termHeader) {
      currentSection = {
        kind: "term",
        label: `${capitalize(termHeader[1])} ${termHeader[2]}`,
        studyIndex: null,
      };
      continue;
    }

    if (TRANSFER_HEADER_RE.test(line)) {
      currentSection = { kind: "transfer" };
      continue;
    }

    if (WORK_TERM_HEADER_RE.test(line)) {
      currentSection = { kind: "none" };
      continue;
    }

    const courseMatch = COURSE_ROW_RE.exec(line);
    if (!courseMatch) continue;

    const [, prefix, number, tail] = courseMatch;
    const code = (prefix + number).toLowerCase();

    // WKRPT rows don't contribute to completedCourses and don't make their
    // containing term count as a study term — the student didn't take real
    // coursework. Skip entirely.
    if (/^wkrpt/.test(code)) continue;

    // First real course in a term commits the term as a study term.
    if (currentSection.kind === "term" && currentSection.studyIndex === null) {
      currentSection.studyIndex = studyTermCounter;
      studyTermCounter++;
    }

    const tokens = tail.trim().split(/\s+/);
    const rawGrade = tokens[tokens.length - 1] ?? "";
    const status = classifyStatus({ rawGrade, section: currentSection });

    if (status === "in-progress" && currentSection.kind === "term") {
      currentTermIPIdx = currentSection.studyIndex ?? currentTermIPIdx;
    } else if (status === "passed" && currentSection.kind === "term") {
      if (
        currentSection.studyIndex !== null &&
        currentSection.studyIndex > lastPassedTermIdx
      ) {
        lastPassedTermIdx = currentSection.studyIndex;
      }
    }

    const termLabel =
      currentSection.kind === "term"
        ? currentSection.label
        : currentSection.kind === "transfer"
          ? "Transfer Credit"
          : "(unknown section)";

    rawCourses.push({
      code,
      name: tail.trim(),
      termLabel,
      status,
      rawGrade,
    });
  }

  // Dedup: a course taken multiple times keeps its best-status attempt.
  const dedup = new Map<string, ParsedCourse>();
  for (const c of rawCourses) {
    const prior = dedup.get(c.code);
    if (!prior || STATUS_PRIORITY[c.status] > STATUS_PRIORITY[prior.status]) {
      dedup.set(c.code, c);
    }
  }
  const courses = [...dedup.values()];

  if (studyTermCounter > TERM_LETTERS.length) {
    warnings.push(
      `Transcript has ${studyTermCounter} study terms; only 1A–4B are supported. Current-term detection may be inaccurate.`,
    );
  }

  let detectedCurrentTerm: TermLetter | null = null;
  if (currentTermIPIdx >= 0 && currentTermIPIdx < TERM_LETTERS.length) {
    detectedCurrentTerm = TERM_LETTERS[currentTermIPIdx];
  } else if (lastPassedTermIdx >= 0) {
    const nextIdx = lastPassedTermIdx + 1;
    if (nextIdx < TERM_LETTERS.length) {
      detectedCurrentTerm = TERM_LETTERS[nextIdx];
    } else {
      warnings.push(
        "Most recent graded term is 4B; can't infer a 'next' current term.",
      );
    }
  }

  const detectedProgramId =
    rawPlanText !== null ? matchProgramSlug(rawPlanText) : null;

  return {
    detectedProgramId,
    detectedCurrentTerm,
    rawPlanText,
    courses,
    warnings,
  };
}

function classifyStatus({
  rawGrade,
  section,
}: {
  rawGrade: string;
  section: SectionState;
}): CourseStatus {
  if (section.kind === "transfer" || rawGrade === "TR") return "transfer";
  if (rawGrade === "IP") return "in-progress";
  if (/^(F|W|WD|NCR|AU|INC|DNW)$/i.test(rawGrade)) return "skipped";
  if (/^(CR|P)$/i.test(rawGrade)) return "passed";
  if (/^\d+(?:\.\d+)?$/.test(rawGrade)) {
    return parseFloat(rawGrade) >= 50 ? "passed" : "skipped";
  }
  return "unrecognized";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeProgramName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchProgramSlug(planText: string): string | null {
  const needle = normalizeProgramName(planText);
  if (!needle) return null;

  const entries = Object.entries(PROGRAMS).map(([id, p]) => ({
    id,
    normalized: normalizeProgramName(p.name),
  }));

  const exact = entries.filter((e) => e.normalized === needle);
  if (exact.length === 1) return exact[0].id;

  const substr = entries.filter((e) => e.normalized.includes(needle));
  if (substr.length === 1) return substr[0].id;

  return null;
}
