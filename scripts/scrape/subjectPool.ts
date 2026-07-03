import type { Faculty, RuleNode } from "../../lib/programs";
import { WORD_NUMBERS } from "./counts";
import { facultyFromName, subjectsForFaculties } from "./data/subjectFaculty";
import { extractSubjectCodes } from "./normalize";

// A genuine pool-narrowing clause ("excluding CS100", "exclusive of …", "except
// …") — clarifying parentheticals ("0.5 unit", "see Additional Constraints") are not.
const EXCLUSION_RE = /^(?:exclud|exclusive\s+of|except)/i;

// A cap ("at most N", "a maximum of N", "no more than N", "up to N") is a CEILING
// on how much of a pool may count, NOT a requirement. The audit's subjectPool
// models only floors (met when have >= need), so parsing a cap as one would
// wrongly demand the student max the pool out. Reject it up front so the rule
// falls through to unverified. (Pick caps are handled by the rule tree's
// COMPLETE_NO_MORE_THAN_RE, which sets selectMax with no floor.)
const POOL_CAP_RE =
  /^Complete\s+(?:at\s+most|a\s+maximum\s+of|no\s+more\s+than|up\s+to)\b/i;

interface PoolHead {
  amount: number;
  isUnits: boolean;
  /** The text remaining after the "Complete N [units] [of|in]" lead-in. */
  rest: string;
}

// A unit total stated as a trailing clause ("… to a total of 8.0 units"). Both
// forms of parseHead strip it from `rest` so it doesn't leak into subject parsing.
const TOTAL_UNITS_RE = /\bto a total of\s+(\d+(?:\.\d+)?)\s+units?\b/i;

/**
 * Match the "Complete N [units] [of|in]" lead-in. Count may be a digit, a word,
 * or "a"/"an". Only floor lead-ins ("at least", "a minimum of") are accepted;
 * caps are rejected up front by {@link POOL_CAP_RE}. Falls back to a count-less
 * "Complete [additional] units of …" whose amount is a trailing "to a total of
 * N units" (R5). Null when neither.
 */
function parseHead(fullText: string): PoolHead | null {
  const head = fullText.match(
    /^Complete\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(units?\b\s*)?(?:of\s+|in\s+)?/i,
  );
  if (head) {
    return {
      amount: WORD_NUMBERS[head[1].toLowerCase()] ?? Number(head[1]),
      isUnits: head[2] != null,
      rest: fullText.slice(head[0].length).replace(TOTAL_UNITS_RE, " ").trim(),
    };
  }
  // No leading count ("Complete additional units of PSCI courses … to a total of
  // 8.0 units") — take the amount from the trailing total. R5.
  const noCount = fullText.match(
    /^Complete\s+(?:additional\s+)?units?\s+(?:of\s+|in\s+)?/i,
  );
  const total = TOTAL_UNITS_RE.exec(fullText);
  if (noCount && total) {
    return {
      amount: Number(total[1]),
      isUnits: true,
      rest: fullText
        .slice(noCount[0].length)
        .replace(TOTAL_UNITS_RE, " ")
        .trim(),
    };
  }
  return null;
}

/**
 * Pull parentheticals out so they don't confuse level/from parsing, keeping only
 * genuine exclusions ({@link EXCLUSION_RE}). Then drop count-qualifier noise (a
 * stray leading "additional", a per-course "0.5-unit" size).
 */
function stripExclusionsAndQualifiers(
  rest: string,
  exclusions: string[],
): string {
  return (
    rest
      .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
        const t = inner.trim();
        if (t && EXCLUSION_RE.test(t)) exclusions.push(t);
        return " ";
      })
      .replace(/\s+/g, " ")
      .trim()
      // Drop a stray leading "additional" so the subject code after it is found.
      .replace(/^additional\s+/i, "")
      // Drop a per-course unit-size qualifier ("0.5-unit course"), not a unit total.
      .replace(/^[\d.]+[\s-]unit\s+/i, "")
  );
}

interface SubjectMatch {
  subjectCodes: string[];
  /** Text remaining after the subject descriptor ("STAT courses", "courses", …). */
  rest: string;
}

/**
 * Parse the subject descriptor: "STAT courses" | "ENVS and/or ERS courses" |
 * "math/Science courses" (subjects from a later "from …") | bare "courses".
 * Subjects may instead arrive via "from:", so an empty result isn't yet a fail.
 */
function parseSubjects(rest: string): SubjectMatch {
  // All-caps codes joined by and/or/comma; case-sensitive so prose words aren't
  // mistaken for codes. A descriptor adjective ("lecture", "lab") may precede the
  // noun, which is "courses" or "electives" ("Complete 2 PHARM electives"). R5.
  const codesMatch = rest.match(
    /^([A-Z]{2,8}(?:\s*(?:,\s*(?:or|and)|and\/or|,|and|or)\s*[A-Z]{2,8})*)\s+(?:(?:lecture|laboratory|lab|elective|approved)\s+)*(?:courses?|electives?)\b/,
  );
  if (codesMatch) {
    const subjectCodes = extractSubjectCodes(codesMatch[1], "upper");
    return { subjectCodes, rest: rest.slice(codesMatch[0].length).trim() };
  }
  // A bare code sized by units, no "courses" noun ("BIOL 0.5 unit, any level"). R5.
  const sized = rest.match(/^([A-Z]{2,8})\s+[\d.]+[\s-]units?\b/);
  if (sized) {
    return {
      subjectCodes: extractSubjectCodes(sized[1], "upper"),
      rest: rest.slice(sized[0].length).trim(),
    };
  }
  if (/^[A-Za-z]+\s+courses?\b/.test(rest)) {
    // A non-code noun ("Science courses") — subjects must come from "from: …".
    return {
      subjectCodes: [],
      rest: rest.replace(/^[A-Za-z]+\s+courses?\b/, "").trim(),
    };
  }
  if (/^courses?\b/i.test(rest)) {
    return { subjectCodes: [], rest: rest.replace(/^courses?\b/i, "").trim() };
  }
  // No "courses" noun — don't bail; subjects come from the "from:" clause.
  return { subjectCodes: [], rest };
}

interface LevelRange {
  minLevel?: number;
  maxLevel?: number;
  rest: string;
}

/**
 * Parse an optional "at the <level>" constraint: one level → floor; several
 * ("300- or 400-level", "600-/700-level", "200-, 300-, or 400-level") → min..max.
 * A single level with "or above/higher" stays a floor.
 */
function parseLevelRange(rest: string): LevelRange {
  const levelMatch = rest.match(
    /^at the\s+([\d\s,\-or/]+?)\s*-?\s*level(?:\s+or\s+(?:above|higher))?\b/i,
  );
  if (!levelMatch) return { rest };
  const nums = (levelMatch[1].match(/\d+/g) ?? []).map(Number);
  const out: LevelRange = { rest: rest.slice(levelMatch[0].length).trim() };
  if (nums.length > 0) {
    out.minLevel = Math.min(...nums);
    // Several levels span a range; one level (even with "or above") is a floor.
    if (nums.length > 1) out.maxLevel = Math.max(...nums);
  }
  return out;
}

/**
 * Parse an optional "from [the following subject codes] <list>[; <exclusion>]"
 * clause. Returns the codes it names (empty when absent); pushes a trailing
 * `;`-led genuine exclusion ({@link EXCLUSION_RE}) onto `exclusions`.
 */
function parseFromClause(rest: string, exclusions: string[]): string[] {
  const fromMatch = rest.match(
    /^from(?:\s+the\s+following\s+subject\s+codes|\s+the\s+following\s+subjects)?:?\s*(.+)$/i,
  );
  if (!fromMatch) return [];
  const parts = fromMatch[1].split(";").map((p) => p.trim());
  const fromSubjects = parts[0]
    .split(/[,\s]+/)
    // Strip trailing punctuation ("STV." at a sentence end) before the filter.
    .map((s) => s.replace(/[^A-Za-z]/g, ""))
    .filter((s) => /^[A-Z]{2,8}$/.test(s));
  for (const p of parts.slice(1)) if (EXCLUSION_RE.test(p)) exclusions.push(p);
  return fromSubjects;
}

/**
 * Resolve a faculty-scoped clause ("Faculty of Arts", "Faculties: Environment,
 * Health, Science") to the faculties it names — read up to a clause break, split
 * on connectives, each fragment via {@link facultyFromName}. See #117 (bucket B).
 */
function parseFacultyClause(text: string): Faculty[] {
  if (!/facult/i.test(text)) return [];
  // Stop the capture before a "from" clause (with or without a leading "or"), so
  // "Faculty of Arts from: CS, MATH" yields "Arts", not "Arts from: CS, MATH"
  // (whose "MATH" would wrongly pull in the whole Math faculty). See #117 (B).
  const m = text.match(
    /facult(?:y\s+of|ies)\b\s*:?\s*([\s\S]+?)(?=;|\.|$|,?\s+(?:or\s+)?from\b)/i,
  );
  if (!m) return [];
  const found = new Set<Faculty>();
  for (const part of m[1].split(/[,;/]|\band\b|\bor\b/i)) {
    const faculty = facultyFromName(part.trim());
    if (faculty) found.add(faculty);
  }
  return [...found];
}

/**
 * Build a `subjectPool` node from the text after the count lead-in (subject
 * descriptor + optional level + "from:" list). Shared by {@link parseSubjectPool}
 * and {@link parseChooseAnyPool}. Null when no enumerable subject set survives.
 */
function buildPool(
  restIn: string,
  selectCount: number,
  needUnits?: number,
): RuleNode | null {
  // A pool selects whole courses, never a fraction (a fractional `selectCount`
  // means a unit-stated pool, floored to one course). When units were stated,
  // `needUnits` carries the real requirement and the audit scores by units.
  const count = Math.max(1, Math.round(selectCount));
  const exclusions: string[] = [];
  let rest = stripExclusionsAndQualifiers(restIn, exclusions);

  const subjects = parseSubjects(rest);
  let subjectCodes = subjects.subjectCodes;
  rest = subjects.rest;

  // "any level" / ", any level" carries no bound — strip it so it doesn't block
  // the "from:" clause that follows.
  rest = rest.replace(/^,?\s*(?:at\s+)?any\s+level\s*/i, "");

  const level = parseLevelRange(rest);
  rest = level.rest;

  // Strip a connective preamble between the subject noun and "from" ("…courses,
  // in any combination, chosen from …"). The `(?=from\b)` lookahead fires only
  // when a real list follows, so a bare "in any combination" still falls through
  // to null. See #117 (bucket A).
  rest = rest
    .replace(
      /^,?\s*(?:in any combination\s*,?\s*)?(?:chosen\s+)?(?=from\b)/i,
      "",
    )
    .trim();

  const fromSubjects = parseFromClause(rest, exclusions);
  if (fromSubjects.length > 0) subjectCodes = fromSubjects;

  // Faculty clause → that faculty's codes via the authoritative table, unioned
  // with explicit/`from:` codes so a compound "Faculty of Arts, or … codes" rule
  // keeps both halves. Uppercased to match the stored convention. See #117 (B).
  const facultySubjects = subjectsForFaculties(parseFacultyClause(rest)).map(
    (c) => c.toUpperCase(),
  );
  if (facultySubjects.length > 0)
    subjectCodes = [...new Set([...subjectCodes, ...facultySubjects])];

  // No enumerable codes (e.g. "Science courses" with no `from:`): drop rather
  // than fabricate. Conservative-but-lossy — the rule is then untracked.
  if (subjectCodes.length === 0) return null;

  return {
    kind: "subjectPool",
    selectCount: count,
    ...(needUnits !== undefined ? { needUnits } : {}),
    subjectCodes,
    ...(level.minLevel !== undefined ? { minLevel: level.minLevel } : {}),
    ...(level.maxLevel !== undefined ? { maxLevel: level.maxLevel } : {}),
    ...(exclusions.length > 0 ? { exclusions } : {}),
  };
}

/**
 * Parse a "Complete N …" subject-pool rule into a `subjectPool` node, or null if
 * no enumerable subject set is named. A unit amount keeps its real value in
 * `needUnits` (the audit scores by additive credit weights — a 1.0-unit course
 * counts as 1.0 toward the total); the ÷0.5 `selectCount` is only a display
 * approximation. Per the UW Undergraduate Calendar Glossary ("Credit"): "A
 * credit weight of 0.5 is normally assigned to a one-term course … Most courses
 * have credit weights of 0.5, but some have weights such as 0.25, 1.0, 2.0."
 */
export function parseSubjectPool(fullText: string): RuleNode | null {
  if (POOL_CAP_RE.test(fullText)) return null;
  const head = parseHead(fullText);
  if (!head) return null;
  const { amount, isUnits } = head;
  // ÷0.5 gives a display count; `needUnits` carries the real amount so the audit
  // gates on units, not the count.
  const selectCount = isUnits ? Math.max(1, Math.round(amount / 0.5)) : amount;
  return buildPool(head.rest, selectCount, isUnits ? amount : undefined);
}

/**
 * Parse a "Choose any …" pool with no "Complete N" head ("any CS course at the
 * 600-/700-level"): strip the framing, build a `selectCount: 1` pool. Fallback
 * when a "Choose any" rule extracted no literal codes. See #117 (bucket C).
 */
export function parseChooseAnyPool(fullText: string): RuleNode | null {
  const rest = fullText
    .replace(
      /^choose\s+any\s+(?:of\s+|course\s+from\s+)?(?:the\s+following:?\s*)?/i,
      "",
    )
    .replace(/^any\s+/i, "")
    .trim();
  return buildPool(rest, 1);
}
