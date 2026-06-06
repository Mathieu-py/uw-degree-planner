import type { RuleNode } from "../../lib/programs";

const WORD_AMOUNT: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

interface PoolHead {
  amount: number;
  isUnits: boolean;
  /** The text remaining after the "Complete N [units] [of|in]" lead-in. */
  rest: string;
}

/**
 * Match the "Complete N …" lead-in and the optional unit keyword. The count may
 * be a digit ("3"), a word ("two"), or the article "a"/"an"; the unit keyword
 * may be followed by "of" OR "in" ("0.5 unit IN additional CHEM courses"), by a
 * level ("1.0 unit AT the 300-level …"), or directly by the subject ("units
 * PSYCH courses"). Returns null when the text isn't a "Complete N" rule.
 */
function parseHead(fullText: string): PoolHead | null {
  const head = fullText.match(
    /^Complete\s+(?:at\s+least\s+|at\s+most\s+|a\s+(?:minimum|maximum)\s+of\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(units?\b\s*)?(?:of\s+|in\s+)?/i,
  );
  if (!head) return null;
  return {
    amount: WORD_AMOUNT[head[1].toLowerCase()] ?? Number(head[1]),
    isUnits: head[2] != null,
    rest: fullText.slice(head[0].length).trim(),
  };
}

/**
 * Pull parenthetical clauses out ("(excluding CS100, MATH103)", "(exclusive of
 * BIOL225 …)") so they don't confuse level/from parsing; collect them as
 * verbatim exclusion notes. Then drop count-qualifier noise: a stray leading
 * "additional", and a per-course unit-size qualifier ("0.5-unit course").
 */
function stripExclusionsAndQualifiers(
  rest: string,
  exclusions: string[],
): string {
  return (
    rest
      .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
        const t = inner.trim();
        if (t) exclusions.push(t);
        return " ";
      })
      .replace(/\s+/g, " ")
      .trim()
      // "N units of additional ERS courses" → drop the stray "additional" so the
      // subject code that follows it is found (it sits after "units of", not before).
      .replace(/^additional\s+/i, "")
      // "N additional 0.5-unit course(s) from …" / "a 0.5 unit math course …" → drop
      // the per-course unit size qualifier (hyphenated or spaced); it's a count
      // requirement (N courses), not a unit total.
      .replace(/^[\d.]+[\s-]unit\s+/i, "")
  );
}

interface SubjectMatch {
  subjectCodes: string[];
  /** Text remaining after the subject descriptor ("STAT courses", "courses", …). */
  rest: string;
}

/**
 * Parse the subject descriptor: "STAT courses" (one code) | "ENVS and/or ERS
 * courses" (several codes) | "math/Science courses" (a noun whose subjects come
 * from a later "from …" clause) | bare "courses". Subjects may instead arrive
 * via the "from:" clause, so an empty result here is not yet a failure.
 */
function parseSubjects(rest: string): SubjectMatch {
  // All-caps codes, optionally joined by "and/or", "and", "or", ",", or an
  // Oxford ", or" / ", and". Matched case-sensitively so prose words ("Science",
  // "additional") aren't mistaken for codes (those fall through to "from:"). A
  // descriptor adjective ("lecture", "lab", "elective", "approved") may sit
  // between the codes and "courses" ("BIOL lecture courses").
  const codesMatch = rest.match(
    /^([A-Z]{2,8}(?:\s*(?:,\s*(?:or|and)|and\/or|,|and|or)\s*[A-Z]{2,8})*)\s+(?:(?:lecture|laboratory|lab|elective|approved)\s+)*courses?\b/,
  );
  if (codesMatch) {
    const subjectCodes = (codesMatch[1].match(/[A-Z]{2,8}/g) ?? []).map((s) =>
      s.toUpperCase(),
    );
    return { subjectCodes, rest: rest.slice(codesMatch[0].length).trim() };
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
  // No "courses" noun at all ("1.0 unit at the 300-level from the following
  // subject codes: …") — don't bail; the subject set comes from the "from:"
  // clause. We only give up if NO subjects are found after level + from.
  return { subjectCodes: [], rest };
}

interface LevelRange {
  minLevel?: number;
  maxLevel?: number;
  rest: string;
}

/**
 * Parse an optional level constraint after "at the": a single level
 * ("300-level" → floor), an explicit range ("300- or 400-level"), a longer
 * enumeration ("200-, 300-, or 400-level" → min..max), or a single level "or
 * above/higher" (floor). One number is a floor; several span min..max.
 */
function parseLevelRange(rest: string): LevelRange {
  const levelMatch = rest.match(
    /^at the\s+([\d\s,\-or]+?)\s*-?\s*level(?:\s+or\s+(?:above|higher))?\b/i,
  );
  if (!levelMatch) return { rest };
  const nums = (levelMatch[1].match(/\d+/g) ?? []).map(Number);
  const out: LevelRange = { rest: rest.slice(levelMatch[0].length).trim() };
  if (nums.length > 0) {
    out.minLevel = Math.min(...nums);
    // Multiple bounded levels span a range; a single level (with or without
    // "or above") is a floor, so leave maxLevel open.
    if (nums.length > 1) out.maxLevel = Math.max(...nums);
  }
  return out;
}

/**
 * Parse an optional "from [the following subject codes|subjects][:] <list>[;
 * <exclusion>]" clause. Returns the subject codes it names (empty when absent)
 * and pushes any trailing `;`-led clauses onto `exclusions`.
 */
function parseFromClause(rest: string, exclusions: string[]): string[] {
  const fromMatch = rest.match(
    /^from(?:\s+the\s+following\s+subject\s+codes|\s+the\s+following\s+subjects)?:?\s*(.+)$/i,
  );
  if (!fromMatch) return [];
  const parts = fromMatch[1].split(";").map((p) => p.trim());
  const fromSubjects = parts[0]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Z]{2,8}$/.test(s));
  for (const p of parts.slice(1)) if (p.length > 0) exclusions.push(p);
  return fromSubjects;
}

/**
 * Parse a "Complete N …" subject-pool rule into a `subjectPool` node. Returns
 * null if the prose doesn't name an enumerable subject set. Handles:
 *   - "Complete 2 additional STAT courses at the 300-level"
 *   - "Complete 2 additional courses at the 300- or 400-level from: ACTSC, AMATH, CS, …"
 *   - "Complete 3 additional courses from: ACTSC, AMATH, CO, …"
 *   - "Complete 0.5 unit of BIOL courses at the 100- or 200-level (exclusive of BIOL225 …)"
 *   - "Complete 5.25 units of Science courses from the following subjects: BIOL, CHEM, …"
 *
 * A unit amount ("N units of …") is converted to an approximate course count
 * (units / 0.5) so the count-based audit has a threshold; the unit audit
 * re-weights satisfiers by their real catalog units, so the approximation only
 * affects the count-based fallback. Exclusion clauses (parenthetical or `;`-led)
 * are kept verbatim for display; they don't gate matching.
 */
export function parseSubjectPool(fullText: string): RuleNode | null {
  const head = parseHead(fullText);
  if (!head) return null;
  const { amount, isUnits } = head;

  const exclusions: string[] = [];
  let rest = stripExclusionsAndQualifiers(head.rest, exclusions);

  const subjects = parseSubjects(rest);
  let subjectCodes = subjects.subjectCodes;
  rest = subjects.rest;

  // "any level" / ", any level" carries no bound — strip it so it doesn't block
  // the "from:" clause that follows.
  rest = rest.replace(/^,?\s*(?:at\s+)?any\s+level\s*/i, "");

  const level = parseLevelRange(rest);
  rest = level.rest;

  const fromSubjects = parseFromClause(rest, exclusions);
  if (fromSubjects.length > 0) subjectCodes = fromSubjects;

  // No enumerable subject codes (a spelled-out noun like "Science courses at the
  // 300-level" with no `from: <CODES>` list) → we won't fabricate a subject set,
  // so the requirement is dropped from the rule tree rather than mis-scoped.
  // Conservative-but-lossy: such a rule is then untracked (no count ring).
  if (subjectCodes.length === 0) return null;

  // A unit-stated pool ("5.25 units of Science courses") has no per-course units
  // at parse time, so `selectCount` approximates the count assuming a 0.5-unit
  // course.
  const selectCount = isUnits ? Math.max(1, Math.round(amount / 0.5)) : amount;
  return {
    kind: "subjectPool",
    selectCount,
    subjectCodes,
    ...(level.minLevel !== undefined ? { minLevel: level.minLevel } : {}),
    ...(level.maxLevel !== undefined ? { maxLevel: level.maxLevel } : {}),
    ...(exclusions.length > 0 ? { exclusions } : {}),
  };
}
