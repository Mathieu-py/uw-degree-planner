import { PASS_THRESHOLD } from "@/lib/plan/grades";
import { TERM_LETTERS, type TermLetter } from "@/lib/programs";
import { PROGRAMS } from "@/lib/programsRegistry";
import type {
  CourseStatus,
  ParsedCourse,
  TranscriptParseResult,
} from "./types";

export type { ParsedCourse, TranscriptParseResult } from "./types";

const TERM_HEADER_RE = /^(Fall|Winter|Spring)\s+(\d{4})\s*$/i;
const TRANSFER_HEADER_RE = /^Transfer\s+Credit\s*$/i;
const WORK_TERM_HEADER_RE = /^(Co-?op\s+)?Work\s+Term\b/i;
// Quest labels the major as either `Plan: <major>` or `Program: <major>,
// Honours, Co-operative Program`; both must resolve to the same slug, so we
// comma-split the suffix off at extraction time.
const PLAN_LINE_RE = /^(?:Plan|Program):\s*(.+?)\s*$/i;

// Course code at line start, strictly uppercase to skip metadata like
// "Spring 2024 Average: 78". Tail (description + units + grade) captured
// greedily; the grade is the last whitespace token.
const COURSE_ROW_RE = /^([A-Z]{2,8})\s*(\d{3,4}[A-Z]?)\b\s*(.+)$/;

// Past-term rows carry an "Attempted Earned" decimal pair (e.g. `0.50 0.50`)
// before the grade; future-term rows have no grade column. Without this
// signal, a future row's last token is a description word (e.g. "2" from
// "Calculus 2") that classifyStatus would misread as a grade.
const ATTEMPTED_EARNED_RE = /\b\d+\.\d+\s+\d+\.\d+\b/;

// Letter grades valid without the column pair — notably backdated transfer
// credits (`MATH 137 Calculus 1 TR`) in regular term sections. Numeric grades
// are excluded: a bare "2" without columns is indistinguishable from a
// description word and must be treated as a future enrollment.
// NON_NUMERIC_GRADE_RE derives from these keys so detector and classifier
// can't drift.
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

  // All Plan:/Program: candidates, so we can pick the first that resolves to a
  // real slug. Quest emits several (faculty header `Program: Engineering` plus
  // per-term `Program: Systems Design Engineering, …`); a naive first-match
  // would let the faculty header win and silently fail detection.
  const planCandidates: string[] = [];
  // Raw bodies with the comma tail intact. planCandidates drops the tail (the
  // major name matches slugs), but `Co-operative Program` lives in the tail —
  // co-op detection scans these after the main loop.
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
      // Drop everything past the first comma so the major name matches
      // PROGRAMS[*].name (Plan: lines are usually already bare majors).
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

    // WKRPT rows aren't real coursework: skip, and don't let them mark their
    // term as a study term.
    if (code.startsWith("wkrpt")) continue;

    // First real course in a term commits the term as a study term.
    if (currentSection.kind === "term" && currentSection.studyIndex === null) {
      currentSection.studyIndex = studyTermCounter;
      studyTermCounter++;
    }

    const tokens = tail.trim().split(/\s+/);
    const lastToken = tokens[tokens.length - 1] ?? "";
    const hasGradeColumns = ATTEMPTED_EARNED_RE.test(tail);

    // Future enrollment: in a term section but with neither grade columns nor
    // a recognized non-numeric grade, so the last token is a description word,
    // not a grade. Treat as in-progress; everything else delegates to
    // classifyStatus on the last token.
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

  // Each distinct program resolving to a real slug, in order of appearance — a
  // double-degree student has two Plan lines. Ambiguous or generic lines
  // ("Computer Science"; "Program: Engineering") resolve to null and are skipped
  // so a single-degree transcript yields one slug. The first is primary.
  const detectedProgramIds: string[] = [];
  const seen = new Set<string>();
  // Per-program specialization (first spec-bearing line per id wins).
  const detectedSpecializationsByProgramId: Record<string, string> = {};
  let rawPlanText: string | null = planCandidates[0] ?? null;
  for (const cand of planCandidates) {
    const spec = matchSpecializationFromPlan(cand);
    const slug = spec ? spec.programId : matchProgramSlug(cand);
    if (!slug) continue;
    const isNew = !seen.has(slug);
    if (isNew) {
      seen.add(slug);
      detectedProgramIds.push(slug);
    }
    if (spec && !(slug in detectedSpecializationsByProgramId)) {
      detectedSpecializationsByProgramId[slug] = spec.specializationSlug;
    }
    // Primary (first) program anchors the raw display text.
    if (slug === detectedProgramIds[0] && (isNew || spec)) rawPlanText = cand;
  }

  // Any Plan/Program line mentioning "Co-operative Program" → co-op; a Plan
  // line without it → regular; no Plan line at all → null (unknown).
  const COOP_RE = /co-?operative\s+program/i;
  let detectedSystemOfStudy: "coop" | "regular" | null = null;
  if (planLineBodies.length > 0) {
    detectedSystemOfStudy = planLineBodies.some((b) => COOP_RE.test(b))
      ? "coop"
      : "regular";
  }

  return {
    detectedProgramIds,
    detectedSpecializationsByProgramId,
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
    return parseFloat(rawGrade) >= PASS_THRESHOLD ? "passed" : "skipped";
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

// Precomputed at module load: PROGRAMS is static, so re-normalizing per call
// was wasted work.
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

// Spec-bearing Plan lines look like `Plan: Honours History — Global
// Interactions Specialization`. Separator is em/en-dash or spaced hyphen; the
// right half is expected to contain "Specialization".
const PLAN_SPLIT_RE = /\s+[—–-]\s+/;

// "Specialization" appears in every spec name and Plan spec-half, so it
// carries no disambiguation signal — strip it when counting tokens.
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
 * Resolve a Plan/Program line carrying both a parent program and a
 * specialization to { programId, specializationSlug }, or null if either half
 * fails to match (callers fall back to `matchProgramSlug` on the full line).
 *
 * The non-exact fallback uses word-boundary token coverage, not substring:
 * every non-sentinel needle token must appear as a whole word, and the needle
 * must carry ≥2 such tokens. Otherwise a lone "Interfaces" substring-matches
 * "Human Factors and Interfaces Specialization" and picks a spec by accident.
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

export interface Categorized {
  passed: ParsedCourse[];
  inProgress: ParsedCourse[];
  transfer: ParsedCourse[];
  skipped: ParsedCourse[];
  unrecognized: ParsedCourse[];
}

/**
 * Bucket parsed courses by status. A course with a real status but a code not
 * in the catalog is demoted to `unrecognized` so the modal can prompt first.
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
