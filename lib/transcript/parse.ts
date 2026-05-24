import { PROGRAMS, TERM_LETTERS, type TermLetter } from "../programs";
import type {
  CourseStatus,
  ParsedCourse,
  TranscriptParseResult,
} from "./types";

export type { ParsedCourse, TranscriptParseResult } from "./types";

const TERM_HEADER_RE = /^(Fall|Winter|Spring)\s+(\d{4})\s*$/i;
const TRANSFER_HEADER_RE = /^Transfer\s+Credit\s*$/i;
const WORK_TERM_HEADER_RE = /^(Co-?op\s+)?Work\s+Term\b/i;
// Quest transcripts label the student's major one of two ways depending on
// which section it appears in: the academic-record header uses
// `Plan: <major>`, while the per-term-section header uses
// `Program: <major>, Honours, Co-operative Program`. Either should resolve
// to the same program slug. The comma-split happens at extraction time so
// the suffix doesn't break matchProgramSlug.
const PLAN_LINE_RE = /^(?:Plan|Program):\s*(.+?)\s*$/i;

// Course-code at start of line, strictly uppercase to avoid matching metadata
// like "Spring 2024 Average: 78". The trailing tail (description + any unit
// columns + grade) is captured greedily; the grade is the last whitespace
// token on the line.
const COURSE_ROW_RE = /^([A-Z]{2,8})\s*(\d{3,4}[A-Z]?)\b\s*(.+)$/;

// Quest transcript rows for past terms have an "Attempted Earned" decimal
// pair (e.g. `0.50 0.50`) before the grade column. Future-term enrollments
// have no grade column yet — only `code` + `description`. Without context,
// the last whitespace-token of a future-term row resolves to a description
// word like "2" (from "Calculus 2") or "Systems" (from "Digital Systems")
// and classifyStatus mis-reads it as a grade.
const ATTEMPTED_EARNED_RE = /\b\d+\.\d+\s+\d+\.\d+\b/;

// Letter-grade tokens that are valid on their own without the column pair —
// notably backdated transfer credits (`MATH 137 Calculus 1 TR`) which appear
// in regular term sections with no Attempted/Earned. Numeric grades are NOT
// in this set: a bare "2" without columns can't be distinguished from a
// description word and must be treated as a future enrollment.
//
// Single source of truth: NON_NUMERIC_GRADE_RE is derived from the keys so the
// detector and the classifier can't drift out of sync.
const NON_NUMERIC_GRADES: Record<
  string,
  Exclude<CourseStatus, "unrecognized">
> = {
  TR: "transfer",
  IP: "inProgress",
  CR: "passed",
  P: "passed",
  F: "skipped",
  W: "skipped",
  WD: "skipped",
  NCR: "skipped",
  AU: "skipped",
  INC: "skipped",
  DNW: "skipped",
};

const NON_NUMERIC_GRADE_RE = new RegExp(
  `^(${Object.keys(NON_NUMERIC_GRADES).join("|")})$`,
  "i",
);

const STATUS_PRIORITY: Record<CourseStatus, number> = {
  passed: 5,
  inProgress: 4,
  transfer: 3,
  skipped: 2,
  unrecognized: 1,
};

type SectionState =
  | { kind: "none" }
  | { kind: "transfer" }
  | { kind: "term"; label: string; studyIndex: number | null };

export function parseTranscript(text: string): TranscriptParseResult {
  const lines = text.split(/\r?\n/);

  // Collect every Plan:/Program: candidate so we can pick the first one that
  // resolves to a real program slug. Necessary because Quest emits multiple
  // such lines (a faculty header like `Program: Engineering` AND per-term
  // `Program: Systems Design Engineering, Honours, …`); the faculty header
  // would otherwise win the "first match" race and silently fail detection.
  const planCandidates: string[] = [];
  // Raw, comma-tail-preserved Plan/Program line bodies. We strip the tail
  // before pushing into `planCandidates` (since the major name is what
  // matches program slugs), but `Co-operative Program` lives in that tail —
  // so co-op detection scans the raw form after the main loop.
  const planLineBodies: string[] = [];
  let currentSection: SectionState = { kind: "none" };
  let studyTermCounter = 0;
  let currentTermIPIdx = -1;
  let lastPassedTermIdx = -1;
  const rawCourses: ParsedCourse[] = [];
  const warnings: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const planMatch = PLAN_LINE_RE.exec(line);
    if (planMatch) {
      // The Program: line carries `<major>, Honours, Co-operative Program`;
      // drop everything past the first comma so the major name matches
      // PROGRAMS[*].name. Plan: lines are typically already bare majors.
      const body = planMatch[1];
      planLineBodies.push(body);
      const candidate = body.split(",")[0].trim();
      if (candidate) planCandidates.push(candidate);
      continue;
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
    if (code.startsWith("wkrpt")) continue;

    // First real course in a term commits the term as a study term.
    if (currentSection.kind === "term" && currentSection.studyIndex === null) {
      currentSection.studyIndex = studyTermCounter;
      studyTermCounter++;
    }

    const tokens = tail.trim().split(/\s+/);
    const lastToken = tokens[tokens.length - 1] ?? "";
    const hasGradeColumns = ATTEMPTED_EARNED_RE.test(tail);

    // A row is a future enrollment when it's inside a term section but has
    // neither Attempted/Earned columns nor a recognized non-numeric grade —
    // the "last token" then is a description word (e.g. "2" from "Calculus
    // 2"), not a grade. Treat as in-progress with no grade. Every other
    // shape delegates to classifyStatus on the last token (handles past
    // graded rows, backdated TR/CR rows, and transfer-section rows).
    const isFutureEnrollment =
      !hasGradeColumns &&
      !NON_NUMERIC_GRADE_RE.test(lastToken) &&
      currentSection.kind === "term";
    const rawGrade = isFutureEnrollment ? "" : lastToken;
    const status: CourseStatus = isFutureEnrollment
      ? "inProgress"
      : classifyStatus({ rawGrade, section: currentSection });

    if (currentSection.kind === "term") {
      if (status === "inProgress") {
        currentTermIPIdx = currentSection.studyIndex ?? currentTermIPIdx;
      } else if (
        status === "passed" &&
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

  // Pick the first candidate that resolves to a real program slug; fall back
  // to the first candidate string so the UI can still show what we saw if
  // none matched ("Detected: <X> — pick after import"). Prefer the
  // specialization match (program + spec) when available, since it carries
  // strictly more information than the parent-only match — so a parent-only
  // hit does not stop the scan; a later candidate carrying a spec can still
  // upgrade the detection.
  let detectedProgramId: string | null = null;
  let detectedSpecializationSlug: string | null = null;
  let rawPlanText: string | null = planCandidates[0] ?? null;
  for (const cand of planCandidates) {
    const spec = matchSpecializationFromPlan(cand);
    if (spec) {
      detectedProgramId = spec.programId;
      detectedSpecializationSlug = spec.specializationSlug;
      rawPlanText = cand;
      break;
    }
    if (detectedProgramId === null) {
      const slug = matchProgramSlug(cand);
      if (slug) {
        detectedProgramId = slug;
        rawPlanText = cand;
      }
    }
  }

  // Co-op detection: any Plan/Program line carrying "Co-operative Program" in
  // its tail (after the major name) flips the student to co-op. If we saw a
  // Plan line at all but none mentioned co-op, treat it as regular. No Plan
  // line at all → null (unknown).
  const COOP_RE = /co-?operative\s+program/i;
  let detectedSystemOfStudy: "coop" | "regular" | null = null;
  if (planLineBodies.length > 0) {
    detectedSystemOfStudy = planLineBodies.some((b) => COOP_RE.test(b))
      ? "coop"
      : "regular";
  }

  return {
    detectedProgramId,
    detectedSpecializationSlug,
    detectedCurrentTerm,
    detectedSystemOfStudy,
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
  if (section.kind === "transfer") return "transfer";
  const upper = rawGrade.toUpperCase();
  if (upper in NON_NUMERIC_GRADES) return NON_NUMERIC_GRADES[upper];
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

// Precomputed at module load — PROGRAMS is static, so normalizing every name
// on each matchProgramSlug call was wasted work.
const NORMALIZED_PROGRAMS: ReadonlyArray<{ id: string; normalized: string }> =
  Object.entries(PROGRAMS).map(([id, p]) => ({
    id,
    normalized: normalizeProgramName(p.name),
  }));

export function matchProgramSlug(planText: string): string | null {
  const needle = normalizeProgramName(planText);
  if (!needle) return null;

  const exact = NORMALIZED_PROGRAMS.filter((e) => e.normalized === needle);
  if (exact.length === 1) return exact[0].id;

  const substr = NORMALIZED_PROGRAMS.filter((e) =>
    e.normalized.includes(needle),
  );
  if (substr.length === 1) return substr[0].id;

  return null;
}

// Quest formats specialization-bearing Plan lines as
// `Plan: Honours History — Global Interactions Specialization`. The
// separator is an em-dash (U+2014); some exports also use an en-dash or
// a plain hyphen-minus surrounded by spaces. The right-hand side is
// expected to contain the literal "Specialization" (case-insensitive).
const PLAN_SPLIT_RE = /\s+[—–-]\s+/;

// "Specialization" appears in every spec name and every Plan spec-half, so
// it carries no disambiguation signal — strip it when counting tokens.
const SPEC_SENTINEL_TOKENS = new Set(["specialization", "specializations"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokensForSpecMatch(normalized: string): string[] {
  return normalized
    .split(/[\s,]+/)
    .filter((t) => t.length > 0 && !SPEC_SENTINEL_TOKENS.has(t));
}

/**
 * Parse a Plan/Program line that contains both a parent program and a
 * specialization. Returns the resolved program slug + specialization slug
 * if both halves match, otherwise null (callers should then fall back to
 * `matchProgramSlug` on the full line).
 *
 * The fallback after exact match uses word-boundary token coverage rather
 * than raw substring: every non-sentinel token in the needle must appear as
 * a whole word in the candidate, AND the needle must carry at least two
 * non-sentinel tokens. A single token like "Interfaces" otherwise
 * substring-matches "Human Factors and Interfaces Specialization" and
 * silently picks a spec the user didn't intend.
 */
export function matchSpecializationFromPlan(
  planText: string,
): { programId: string; specializationSlug: string } | null {
  const parts = planText.split(PLAN_SPLIT_RE);
  if (parts.length < 2) return null;
  const specHalf = parts[parts.length - 1];
  if (!/specialization/i.test(specHalf)) return null;

  const programId = matchProgramSlug(parts.slice(0, -1).join(" "));
  if (!programId) return null;

  const program = PROGRAMS[programId];
  const specs = program?.specializations;
  if (!specs || specs.length === 0) return null;

  const needle = normalizeProgramName(specHalf);
  if (!needle) return null;

  const exact = specs.filter((s) => normalizeProgramName(s.name) === needle);
  if (exact.length === 1) {
    return { programId, specializationSlug: exact[0].slug };
  }

  const needleTokens = tokensForSpecMatch(needle);
  if (needleTokens.length < 2) return null;
  const tokenRes = needleTokens.map(
    (t) => new RegExp(`\\b${escapeRegExp(t)}\\b`),
  );
  const matches = specs.filter((s) => {
    const candidate = normalizeProgramName(s.name);
    return tokenRes.every((re) => re.test(candidate));
  });
  if (matches.length === 1) {
    return { programId, specializationSlug: matches[0].slug };
  }
  return null;
}
