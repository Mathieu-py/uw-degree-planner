import type { RuleNode } from "../../lib/programs";
import { WORD_NUMBERS } from "./counts";
import { extractSubjectCodes } from "./normalize";

/**
 * A clause that genuinely narrows the pool ("excluding CS100", "exclusive of
 * BIOL225 and BIOL280", "except …"). Used to keep real exclusions out of the
 * noise — clarifying parentheticals ("0.5 unit", "see Additional Constraints",
 * "including any taken above") are NOT exclusions and are dropped.
 */
const EXCLUSION_RE = /^(?:exclud|exclusive\s+of|except)/i;

interface PoolHead {
  amount: number;
  isUnits: boolean;
  /** The text remaining after the "Complete N [units] [of|in]" lead-in. */
  rest: string;
}

/**
 * Match the "Complete N …" lead-in and optional unit keyword. The count may be a
 * digit, a word ("two"), or "a"/"an"; the unit keyword may be followed by
 * "of"/"in", a level, or the subject directly. Null when not a "Complete N" rule.
 */
function parseHead(fullText: string): PoolHead | null {
  const head = fullText.match(
    /^Complete\s+(?:at\s+least\s+|at\s+most\s+|a\s+(?:minimum|maximum)\s+of\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(units?\b\s*)?(?:of\s+|in\s+)?/i,
  );
  if (!head) return null;
  return {
    amount: WORD_NUMBERS[head[1].toLowerCase()] ?? Number(head[1]),
    isUnits: head[2] != null,
    rest: fullText.slice(head[0].length).trim(),
  };
}

/**
 * Pull parenthetical clauses out ("(excluding CS100)") so they don't confuse
 * level/from parsing, collecting only the ones that are genuine exclusions (see
 * {@link EXCLUSION_RE}). Then drop count-qualifier noise: a stray leading
 * "additional" and a per-course unit-size qualifier ("0.5-unit course").
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
      // "N units of additional ERS courses" → drop the stray "additional" so the
      // subject code that follows it is found (it sits after "units of", not before).
      .replace(/^additional\s+/i, "")
      // Drop a per-course unit-size qualifier ("0.5-unit course"); it's a count
      // requirement, not a unit total.
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
  // All-caps codes joined by "and/or", "and", "or", "," or an Oxford ", or".
  // Case-sensitive so prose words aren't mistaken for codes (they fall through
  // to "from:"). A descriptor adjective ("lecture", "lab") may sit before
  // "courses".
  const codesMatch = rest.match(
    /^([A-Z]{2,8}(?:\s*(?:,\s*(?:or|and)|and\/or|,|and|or)\s*[A-Z]{2,8})*)\s+(?:(?:lecture|laboratory|lab|elective|approved)\s+)*courses?\b/,
  );
  if (codesMatch) {
    const subjectCodes = extractSubjectCodes(codesMatch[1], "upper");
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
 * ("300-level" → floor), an explicit range ("300- or 400-level"), the slash
 * form ("600-/700-level"), a longer enumeration ("200-, 300-, or 400-level" →
 * min..max), or a single level "or above/higher" (floor). One number is a
 * floor; several span min..max.
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
    // Multiple bounded levels span a range; a single level (with or without
    // "or above") is a floor, so leave maxLevel open.
    if (nums.length > 1) out.maxLevel = Math.max(...nums);
  }
  return out;
}

/**
 * Parse an optional "from [the following subject codes|subjects][:] <list>[;
 * <exclusion>]" clause. Returns the subject codes it names (empty when absent)
 * and pushes any trailing `;`-led clause that is a genuine exclusion (see
 * {@link EXCLUSION_RE}) onto `exclusions`.
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
  for (const p of parts.slice(1)) if (EXCLUSION_RE.test(p)) exclusions.push(p);
  return fromSubjects;
}

/**
 * Build a `subjectPool` node from the text AFTER the count lead-in (the subject
 * descriptor + optional level + optional "from:" list). Shared by
 * {@link parseSubjectPool} (which derives `selectCount` from "Complete N") and
 * {@link parseChooseAnyPool} (count 1). Returns null when no enumerable subject
 * set survives.
 */
function buildPool(restIn: string, selectCount: number): RuleNode | null {
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

  // Strip a connective preamble between the subject noun and the "from" list —
  // the calendar writes "…courses, in any combination, chosen from the following
  // subject codes: …". The `(?=from\b)` lookahead fires the strip only when a
  // real "from" list follows, so a bare "in any combination" with no list still
  // falls through to null. Without this, parseFromClause never reaches the list
  // and the pool drops to unverified. See #117 (bucket A).
  rest = rest
    .replace(
      /^,?\s*(?:in any combination\s*,?\s*)?(?:chosen\s+)?(?=from\b)/i,
      "",
    )
    .trim();

  const fromSubjects = parseFromClause(rest, exclusions);
  if (fromSubjects.length > 0) subjectCodes = fromSubjects;

  // No enumerable subject codes (e.g. "Science courses…" with no `from:` list):
  // drop rather than fabricate a subject set. Conservative-but-lossy — the rule
  // is then untracked (no count ring).
  if (subjectCodes.length === 0) return null;

  return {
    kind: "subjectPool",
    selectCount,
    subjectCodes,
    ...(level.minLevel !== undefined ? { minLevel: level.minLevel } : {}),
    ...(level.maxLevel !== undefined ? { maxLevel: level.maxLevel } : {}),
    ...(exclusions.length > 0 ? { exclusions } : {}),
  };
}

/**
 * Parse a "Complete N …" subject-pool rule into a `subjectPool` node, or null if
 * the prose names no enumerable subject set. Handles the varied phrasings
 * ("…STAT courses at the 300-level", "…from: ACTSC, AMATH, …", "N units of …").
 * A unit amount is converted to an approximate course count (units / 0.5); the
 * unit audit re-weights by real catalog units, so the approximation only affects
 * the count fallback. Exclusions are kept verbatim and don't gate matching.
 */
export function parseSubjectPool(fullText: string): RuleNode | null {
  const head = parseHead(fullText);
  if (!head) return null;
  const { amount, isUnits } = head;
  // A unit-stated pool ("5.25 units of Science courses") has no per-course units
  // at parse time, so `selectCount` approximates the count assuming a 0.5-unit
  // course.
  const selectCount = isUnits ? Math.max(1, Math.round(amount / 0.5)) : amount;
  return buildPool(head.rest, selectCount);
}

/**
 * Parse a "Choose any …" pool phrase that has no "Complete N" lead-in, e.g.
 * "any CS course at the 600-/700-level". Strips the "Choose any … from the
 * following:" / leading "any" framing, then builds a `selectCount: 1` pool via
 * {@link buildPool}. Used as a fallback when a "Choose any" rule extracted no
 * literal course codes (the pool half of a list like "CS440-CS498, any CS
 * course at the 600- or 700-level"). See #117 (bucket C).
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
