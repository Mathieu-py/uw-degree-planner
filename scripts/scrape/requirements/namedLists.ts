// Named-list resolution: joins a rule that references course lists by name
// ("from the Technical Electives lists", "List A, B, C, or D") to the union of
// those lists' course codes, and indexes titled <section>s into the context's
// list map. Also the leading-count helpers a list rule needs.
import type * as cheerio from "cheerio";
import { normalizeListName } from "../program/electives";
import { unitsToCount, wordToNumber } from "../util/counts";
import {
  anchorCourseCodes,
  cleanText,
  SECTION_HEADING_SELECTOR,
} from "../util/dom";
import type { ParseContext } from "./context";

// "List A, B, C, or D" / "List 1" — captures the enumeration after "List".
const LIST_ENUM_RE =
  /\blist\s+([A-Za-z0-9](?:\s*,\s*(?:or\s+)?[A-Za-z0-9]|\s+or\s+[A-Za-z0-9])*)/i;
// Every explicit "List N"/"List A" a rule names — catches repeated references
// ("from List 1 or List 2") that LIST_ENUM_RE mis-splits at the second "List". R2.
export const LIST_REF_RE_G = /\bList\s+([A-Za-z0-9]+)\b/gi;
// "from the Technical Electives lists" / "from the Approved Courses list".
const NAMED_LIST_RE = /\bfrom\s+(?:the\s+)?([^.;:]+?)\s+lists?\b/i;
// The inverse phrasing Kuali also uses to point at a sibling titled section:
// "from the list of Approved Courses below". NAMED_LIST_RE reads "<Name> list"
// but not this "list of <Name>" shape; the trailing "below"/"above" anchors the
// name. indexSectionLists indexes those sections so the name resolves.
const LIST_OF_SECTION_RE =
  /\blist\s+of\s+([A-Za-z][A-Za-z ]*?)\s+(?:below|above)\b/i;
// Leading count: "Complete 1 additional course…", "four courses…", "Complete a
// total of 7…", "Complete a course…". Stops the count from being mistaken for a
// trailing "List 1". The article "a"/"an" counts as 1 (matches WORD_NUMBERS).
const LEADING_COUNT_RE =
  /\b(?:complete\s+(?:a\s+total\s+of\s+)?)?(\d+|an|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(?:courses?|of\b)/i;

/**
 * Resolve a rule referencing named lists ("from the Technical Electives lists",
 * "List A, B, C, or D", "from the list of Approved Courses below") to the union
 * of their course codes. Tries a "List X[, Y…]" enumeration, then a "<Name> list"
 * reference, then the "list of <Name>" inverse. Null when no known list matches —
 * the rule stays unverified (e.g. a list defined only in additionalConstraints
 * prose).
 */
export function resolveNamedList(
  ctx: ParseContext,
  fullText: string,
): string[] | null {
  const { namedLists } = ctx;
  if (namedLists.size === 0) return null;
  const keys: string[] = [];

  const enumMatch = LIST_ENUM_RE.exec(fullText);
  if (enumMatch)
    for (const tok of enumMatch[1].split(/[,\s]+|\bor\b/i))
      if (tok.trim()) keys.push(normalizeListName(`list ${tok.trim()}`));

  // Repeated "List N" references ("from List 1 or List 2") — the enumeration
  // above stops at the second "List", so pick up every explicit one here. R2.
  for (const m of fullText.matchAll(LIST_REF_RE_G))
    keys.push(normalizeListName(`list ${m[1]}`));

  const namedMatch = NAMED_LIST_RE.exec(fullText);
  if (namedMatch) keys.push(normalizeListName(namedMatch[1]));

  // "from the list of Approved Courses below" — a sibling titled section that
  // indexSectionLists added to namedLists (NAMED_LIST_RE only reads the inverse).
  const listOfMatch = LIST_OF_SECTION_RE.exec(fullText);
  if (listOfMatch) keys.push(normalizeListName(listOfMatch[1]));

  const courses = new Set<string>();
  for (const key of keys) {
    const exact = namedLists.get(key);
    if (exact) {
      for (const c of exact) courses.add(c);
      continue;
    }
    // Contains-match only when the rule's reference is MORE specific than a
    // heading ("Technical Electives for Option X" ⊇ "Technical Electives"). Not
    // the reverse: a short ref ("electives") must not sweep in every "… electives"
    // list. Length guard keeps single letters/digits ("List A") exact-only.
    for (const [name, list] of namedLists)
      if (name.length >= 3 && key.includes(name))
        for (const c of list) courses.add(c);
  }
  return courses.size > 0 ? [...courses].sort() : null;
}

/** Leading requirement count ("Complete 1 …", "four courses …"); null if none. */
function leadingCount(fullText: string): number | null {
  const m = LEADING_COUNT_RE.exec(fullText);
  if (!m) return null;
  return wordToNumber(m[1]) ?? null;
}

// A unit total ("1.0 additional unit", "3.0 units") → an approximate course count
// (÷ 0.5, as parseSubjectPool does). Lets a unit-stated named-list rule be a real
// gating pick instead of dropping to unverified; the unit audit re-weights later.
const UNIT_COUNT_RE = /\b(\d+(?:\.\d+)?)\s+(?:additional\s+)?units?\b/i;

// "Complete 2 Technical Electives from List 1" — a leading count that
// LEADING_COUNT_RE can't read (it needs "courses"/"of" right after the number)
// because a domain noun ("Technical Elective(s)") sits before "from List N". R1.
const LIST_COUNT_RE =
  /^Complete\s+(?:a\s+total\s+of\s+)?(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\b[^.:;]*?\bfrom\b[^.:;]*?\bList\b/i;

/** Course count if stated, else a unit total converted to one (units ÷ 0.5). */
export function requiredCount(fullText: string): number | null {
  const courses = leadingCount(fullText);
  if (courses !== null) return courses;
  const units = UNIT_COUNT_RE.exec(fullText);
  if (units) return unitsToCount(Number(units[1]));
  const list = LIST_COUNT_RE.exec(fullText);
  if (list) return wordToNumber(list[1]) ?? null;
  return null;
}

/**
 * True when the rule's option set extends BEYOND the named list — a subject-pool
 * half ("GER courses"), a faculty, or a self-reference to another list ("courses
 * above"). A pick over only the list would be dishonestly too strict, so the rule
 * stays unverified. Subject run is case-sensitive; the rest case-insensitive.
 */
export function namesUncapturedSource(text: string): boolean {
  return (
    /\bfacult/i.test(text) ||
    /[A-Z]{2,8}\s+courses\b/.test(text) ||
    /\b(?:courses|listed)\s+above\b/i.test(text)
  );
}

/**
 * Index each titled `<section>`'s linked courses into `namedLists`, keyed by the
 * normalized heading, so a rule can resolve a cross-reference to a SIBLING
 * section ("Complete 1 additional course from the list of Approved Courses
 * below" → the "Approved Courses List" section). Done up-front so a forward
 * "… below" reference resolves against a section parsed later. Merges with any
 * courseListsNew entry under the same key rather than overwriting it.
 */
export function indexSectionLists(
  ctx: ParseContext,
  $: cheerio.CheerioAPI,
  $sections: ReturnType<cheerio.CheerioAPI>,
): void {
  const { namedLists } = ctx;
  $sections.each((_, section) => {
    const $sec = $(section);
    const heading = cleanText(
      $sec.find(SECTION_HEADING_SELECTOR).first().text() ||
        $sec.find("h2").first().text(),
    );
    const key = heading ? normalizeListName(heading) : "";
    if (!key) return;
    const courses = [...new Set(anchorCourseCodes($, $sec))].sort();
    if (courses.length === 0) return;
    const existing = namedLists.get(key);
    namedLists.set(
      key,
      existing ? [...new Set([...existing, ...courses])].sort() : courses,
    );
  });
}
