import * as cheerio from "cheerio";
import {
  isTermLetter,
  type RuleNode,
  TERM_LETTERS,
  type TermLetter,
} from "../../lib/programs";
import { catalogCodesInRange } from "./catalog";
import { unitsToCount, wordToNumber } from "./counts";
import {
  anchorCourseCodes,
  cleanText,
  RULE_RESULT_SELECTOR,
  SECTION_HEADING_SELECTOR,
} from "./dom";
import { buildNamedListIndex, normalizeListName } from "./electives";
import {
  CODE_RANGE_RE_G,
  normalizeCourseCode,
  parseCodeRange,
  TEXT_CODE_RE,
} from "./normalize";
import { parseChooseAnyPool, parseSubjectPool } from "./subjectPool";

export interface ProgramDetailFields {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  /** Structured named lists ("Technical Electives List") joined by name (#117 D). */
  courseListsNew?: string;
}

/** Free electives dropped from the rule tree (redundant with the unit headline's
 *  free remainder). The assembler re-surfaces these as unverified for programs
 *  that lack a totalUnits denominator. See FREE_ELECTIVE_RE. */
type FreeElectives = { freeElectives?: string[] };

export type ParseResult = (
  | {
      kind: "engineering";
      terms: Record<TermLetter, RuleNode>;
      warnings: string[];
      /** Verbatim owed-requirement statements we couldn't structure into a rule. */
      unverified: string[];
    }
  | {
      kind: "flexible";
      rules: RuleNode;
      warnings: string[];
      unverified: string[];
    }
  | { kind: "empty"; warnings: string[]; unverified: string[] }
) &
  FreeElectives;

const emptyTermsTree = (): Record<TermLetter, RuleNode> =>
  Object.fromEntries(
    TERM_LETTERS.map((t) => [t, { kind: "all", children: [] } as RuleNode]),
  ) as Record<TermLetter, RuleNode>;

const COMPLETE_ALL_RE = /^Complete all (the|of the) following/i;
const COMPLETE_N_OF_RE = /^Complete (\d+) of (the )?following/i;
const CHOOSE_ANY_RE = /^Choose any (?:of|course from) the following/i;
const COMPLETE_NO_MORE_THAN_RE =
  /^Complete no more than (\d+) from (the )?following/i;
const COMPLETE_N_FROM_CHOICES_RE =
  /^Complete (\d+) courses? from the following choices/i;
const EXCLUDED_RE =
  /^The following cannot be used towards (?:this )?(?:academic )?plan/i;
// Prose that fits no rule shape (notes, preambles, unit-bound electives handled
// by parseElectives). "Choose" is omitted so Kuali drift on it surfaces as a warning.
const DEFERRED_PROSE_RE =
  /^(?:Complete|The following|Note|If\b|Subject concentration)/i;

// A grade-gated wrapper ("Complete the following courses with a minimum cumulative
// Economics average of 70.0%") is a sibling of the actual "Complete all: <courses>"
// rule — the courses are captured there, and we drop grade thresholds (no grading),
// so this leaf is a phantom. R4.
const COMPLETE_ALL_GRADED_RE =
  /^Complete the following courses with a minimum cumulative .* average of [\d.]+%/i;
// Count word dropped by Kuali ("Complete of the following: COMMST193 … ENGL193 …").
// The codes are inline; read it as a pick of 1. R4.
const COMPLETE_OF_RE = /^Complete of (?:the )?following/i;
// A unit quota over an inline "following list" ("Complete 2.5 units from the
// following list of courses") whose courses live in a sibling "Choose any" open
// pick. walkUl binds the count (units ÷ 0.5) onto that pick. R4.
const COMPLETE_N_UNITS_FROM_LIST_RE =
  /^Complete\s+(\d+(?:\.\d+)?)\s+units?\s+(?:of\s+courses\s+)?from the following list\b/i;

// Rules whose real constraint we can't encode faithfully — a course-type filter
// ("seminars", "field courses", "lecture or labs"), a cross-subject-diversity rule
// ("same/different/distinct subject(s)/discipline(s)/area(s)", with or without the
// word "code"), or a conditional ("associated labs if …"). Structuring these
// against subject+level alone would over-count, so short-circuit them to verbatim
// before any widening tries. R6.
const KEEP_UNVERIFIED_RE =
  /\bseminars?\b|\bfield\s+courses?\b|\blectures?\s+or\s+labs?\b|\b(?:same|different|distinct|separate)\s+(?:subject|discipline|area)s?\b|\bassociated\s+lab/i;

// Genuinely-open free electives with NO enumerable scope and no real constraint
// ("Complete 4 approved electives", "Complete 2 additional courses", "N units of
// elective courses", "additional units at any level"). Their VOLUME is already the
// free-unit remainder in the units headline (lib/audit/progress.ts), so surfacing
// them ALSO as "confirm with your advisor" rows is redundant and double-gates
// 100%. Drop them from the rule tree, but record each (droppedFreeElectives) so
// the assembler can re-surface it for a program with no totalUnits denominator —
// there the headline has no free remainder to gate it. A level floor or a
// subject/list scope keeps the rule OUT of here — those aren't tracked by units.
const FREE_ELECTIVE_RE =
  /\bapproved electives?\b|^Complete\s+[\d.]+\s+additional courses?\.?$|\bunits of (?:elective|additional) courses\b|\badditional units at any level\b/i;

// Fallback prefix slice for a colon-less rule: long enough for every ^-anchored
// rule regex, short enough to keep warnings readable.
const MAX_PREFIX_LEN = 200;

// This program's named course lists keyed by normalized heading — its
// `courseListsNew` plus (added in parseFlexible) its titled requirement sections.
// Joins a rule's "from List N" / "from the … list" reference to its courses.
// See #117 (bucket D).
//
// MODULE-LEVEL STATE — safe only because parseProgramRequirements resets then
// reads this within a single SYNCHRONOUS call (no await between reset and last
// use), so each program's parse is atomic under JS's single thread. Callers must
// keep the parse synchronous and non-interleaved (no Promise.all over programs);
// see the call-site notes in scrape-programs.ts.
let namedLists = new Map<string, string[]>();

// Free electives this program dropped from its rule tree — collected so the
// assembler can re-surface them for programs with no totalUnits denominator.
// Same synchronous-atomicity contract as `namedLists` above.
let droppedFreeElectives: string[] = [];

// "List A, B, C, or D" / "List 1" — captures the enumeration after "List".
const LIST_ENUM_RE =
  /\blist\s+([A-Za-z0-9](?:\s*,\s*(?:or\s+)?[A-Za-z0-9]|\s+or\s+[A-Za-z0-9])*)/i;
// Every explicit "List N"/"List A" a rule names — catches repeated references
// ("from List 1 or List 2") that LIST_ENUM_RE mis-splits at the second "List". R2.
const LIST_REF_RE_G = /\bList\s+([A-Za-z0-9]+)\b/gi;
// "from the Technical Electives lists" / "from the Approved Courses list".
const NAMED_LIST_RE = /\bfrom\s+(?:the\s+)?([^.;:]+?)\s+lists?\b/i;
// The inverse phrasing Kuali also uses to point at a sibling titled section:
// "from the list of Approved Courses below". NAMED_LIST_RE reads "<Name> list"
// but not this "list of <Name>" shape; the trailing "below"/"above" anchors the
// name. indexSectionLists indexes those sections so the name resolves. #117.
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
 * prose). See #117 (bucket D).
 */
function resolveNamedList(fullText: string): string[] | null {
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
function requiredCount(fullText: string): number | null {
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
function namesUncapturedSource(text: string): boolean {
  return (
    /\bfacult/i.test(text) ||
    /[A-Z]{2,8}\s+courses\b/.test(text) ||
    /\b(?:courses|listed)\s+above\b/i.test(text)
  );
}

// "Complete N …" where N leads the rule, even when a non-"course" word follows
// ("Complete 3 additional CS courses …" — LEADING_COUNT_RE needs "courses"/"of"
// right after the count, so it misses this shape).
const LEAD_COUNT_RE =
  /^Complete\s+(?:a\s+total\s+of\s+)?(\d+|an|a|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

// An exclusion clause consumes ONLY the codes/ranges that follow it — comma- or
// "and"-joined — and stops at the first non-code word, so a range re-introduced
// by prose ("… except CS350, and then CS440-CS489") survives while every
// comma-listed exclusion ("except CS350, CS440-CS489") is dropped. Never `.*$`:
// that swallowed valid trailing ranges. Matches inside parentheticals too.
const EXCLUSION_LIST_RE =
  /\b(?:excluding|except|exclusive\s+of)\b(?:\s*(?:,|and)?\s*[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?(?:\s*[-–—]\s*(?:[A-Za-z]{2,8}\s?)?\d{3,4}[A-Za-z]?)?)+/gi;

/** Every catalog code an exclusion clause names — its ranges expanded, then its
 *  bare literals — so they can be subtracted from an overlapping included band.
 *  Exported for a ReDoS regression test on EXCLUSION_LIST_RE. */
export function excludedCodes(text: string): Set<string> {
  const out = new Set<string>();
  for (const clause of text.match(EXCLUSION_LIST_RE) ?? []) {
    const noRanges = clause.replace(CODE_RANGE_RE_G, (m) => {
      const range = parseCodeRange(m);
      if (range) for (const c of catalogCodesInRange(range)) out.add(c);
      return " ";
    });
    for (const tok of noRanges.match(TEXT_CODE_RE) ?? []) {
      const code = normalizeCourseCode(tok);
      if (code) out.add(code);
    }
  }
  return out;
}

/**
 * Expand every INCLUDED course range in `text` ("CS340-CS398") to its offered
 * catalog codes, MINUS anything an exclusion clause names ("… excluding
 * CS450-CS460") — even when the excluded band sits inside an included one.
 * Parentheticals are notes/exclusions, never selectable. Empty when no range.
 */
function expandRanges(text: string): string[] {
  const excluded = excludedCodes(text);
  const included = text.replace(/\([^)]*\)/g, " "); // notes/exclusions
  const out = new Set<string>();
  for (const m of included.matchAll(CODE_RANGE_RE_G)) {
    const range = parseCodeRange(m[0]);
    if (range) for (const c of catalogCodesInRange(range)) out.add(c);
  }
  for (const c of excluded) out.delete(c);
  return [...out];
}

/**
 * Parse a Kuali program detail into a discriminated `ParseResult`.
 *
 * Field-selection precedence (first non-empty wins):
 *   1. `requiredCoursesTermByTerm` → engineering (per-term trees)
 *   2. `requirements`              → flexible (single tree)
 *   3. `courseRequirementsNoUnits` → flexible (single tree)
 *
 * 2 and 3 are HTML-equivalent — Kuali emits the same shape into one or the
 * other depending on whether unit counts are tracked.
 */
export function parseProgramRequirements(
  detail: ProgramDetailFields,
  programLabel = "(unknown)",
): ParseResult {
  // Reset per program so a "from List N" rule can be joined to THIS program's
  // named lists (and never leaks the previous program's).
  namedLists = buildNamedListIndex(detail.courseListsNew);
  droppedFreeElectives = [];

  const engHtml = detail.requiredCoursesTermByTerm?.trim();
  const reqHtml = detail.requirements?.trim();
  const noUnitsHtml = detail.courseRequirementsNoUnits?.trim();
  const result: ParseResult = engHtml
    ? parseEngineering(engHtml, programLabel)
    : reqHtml
      ? parseFlexible(reqHtml, programLabel)
      : noUnitsHtml
        ? parseFlexible(noUnitsHtml, programLabel)
        : { kind: "empty", warnings: [], unverified: [] };

  if (droppedFreeElectives.length > 0)
    result.freeElectives = [...droppedFreeElectives];
  return result;
}

function parseEngineering(html: string, programLabel: string): ParseResult {
  const terms = emptyTermsTree();
  const warnings: string[] = [];
  const unverified: string[] = [];
  const $ = cheerio.load(html);

  $("section").each((_, section) => {
    const $section = $(section);
    const header = cleanText($section.find(SECTION_HEADING_SELECTOR).text());
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const root = parseSectionTree(
      $,
      $section,
      `${programLabel} ${termLetter}`,
      warnings,
      unverified,
    );
    if (root.children.length > 0) {
      terms[termLetter] = root;
    }
  });

  return { kind: "engineering", terms, warnings, unverified };
}

/** True when a titled section already captures a selection count (a `pick`), so a
 *  leaf that merely points at it ("… from the options in List 1") is redundant. */
function hasPickNode(children: RuleNode[]): boolean {
  return children.some(
    (c) => c.kind === "pick" || (c.kind === "all" && hasPickNode(c.children)),
  );
}

// A leaf that only points at titled List sections defined elsewhere in the same
// program ("Complete N … from the options in List 1", "Complete the List 1 and
// List 2 requirements below"). The sections carry their own count, so the pointer
// is a phantom duplicate. A ";" clause means it adds an un-encodable constraint
// (e.g. "… in ≥2 subject codes") and must stay verbatim. R3.
const SECTION_POINTER_RE =
  /\bfrom\s+(?:the\s+)?options\s+in\s+List\b|\bList\b[^.;]*\brequirements?\s+below\b/i;

/**
 * Index each titled `<section>`'s linked courses into `namedLists`, keyed by the
 * normalized heading, so a rule can resolve a cross-reference to a SIBLING
 * section ("Complete 1 additional course from the list of Approved Courses
 * below" → the "Approved Courses List" section). Done up-front so a forward
 * "… below" reference resolves against a section parsed later. Merges with any
 * courseListsNew entry under the same key rather than overwriting it.
 */
function indexSectionLists(
  $: cheerio.CheerioAPI,
  $sections: ReturnType<cheerio.CheerioAPI>,
): void {
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

function parseFlexible(html: string, programLabel: string): ParseResult {
  const warnings: string[] = [];
  const unverified: string[] = [];
  const $ = cheerio.load(html);

  // Index the titled sections' courses before parsing rules, so a rule pointing
  // at a sibling section by name ("… from the list of Approved Courses below")
  // can join to it — even a forward reference to a section parsed later.
  indexSectionLists($, $("section"));

  // Each <section> is a titled group ("Required Courses", "List 1", …). Collect
  // each section's parsed rules alongside its heading — only the first heading
  // carries Kuali's `grouping-label` testid, so fall back to the first <h2>.
  const sections: { heading: string; children: RuleNode[] }[] = [];
  $("section").each((_, section) => {
    const $sec = $(section);
    const root = parseSectionTree($, $sec, programLabel, warnings, unverified);
    if (root.children.length === 0) return;
    const heading = cleanText(
      $sec.find(SECTION_HEADING_SELECTOR).first().text() ||
        $sec.find("h2").first().text(),
    );
    sections.push({ heading, children: root.children });
  });

  if (sections.length === 0) {
    return { kind: "empty", warnings, unverified };
  }

  // Drop phantom pointers to List sections captured above (R3). Only when every
  // named "List N" resolves to a section that already holds its own `pick`, so we
  // never silently drop a count that lives ONLY in the pointer.
  const pickedListKeys = new Set(
    sections
      .filter((s) => hasPickNode(s.children))
      .map((s) => s.heading.match(/^List\s+[A-Za-z0-9]+$/i)?.[0].toLowerCase())
      .filter((k): k is string => Boolean(k)),
  );
  const structuredUnverified = unverified.filter((text) => {
    if (!SECTION_POINTER_RE.test(text)) return true;
    const refs = [...text.matchAll(LIST_REF_RE_G)].map((m) =>
      `list ${m[1]}`.toLowerCase(),
    );
    return !(refs.length > 0 && refs.every((r) => pickedListKeys.has(r)));
  });

  // A single titled section flattens (the heading adds nothing). Several titled
  // sections each stay wrapped in a named `all`, so the audit shows the heading
  // ("List 1"/"List 2"/…) as a sub-group — describeRule surfaces an `all`'s
  // description, and the wrapper is count-inert (every child stays required).
  // This is what the "In List 1, …" / "from List 2 or List 3" constraints name.
  const multi = sections.length > 1;
  const allChildren: RuleNode[] = [];
  for (const { heading, children } of sections) {
    if (multi && heading)
      allChildren.push({ kind: "all", description: heading, children });
    else allChildren.push(...children);
  }

  return {
    kind: "flexible",
    rules: { kind: "all", children: allChildren },
    warnings,
    unverified: structuredUnverified,
  };
}

/**
 * Build a rule tree from a `<section>`, walking its top-level `<ul>`
 * hierarchically. Two parent-child shapes both produce a tree:
 *   - DOM-nested: `<li><span>Complete all…</span><ul>…children…</ul></li>`
 *   - Sibling-implied: a leaf `<li>` with meta-prose ("Complete N courses from
 *     the following choices:") consumes subsequent same-level siblings.
 */
function parseSectionTree(
  $: cheerio.CheerioAPI,
  $section: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
  unverified: string[],
): RuleNode & { kind: "all" } {
  const topUl = $section
    .children()
    .find("ul")
    .filter((_, ul) => $(ul).children("li").length > 0)
    .first();
  if (topUl.length === 0) return { kind: "all", children: [] };
  const children = walkUl($, topUl, contextLabel, warnings, unverified);
  return { kind: "all", children };
}

/**
 * Walk a `<ul>` and produce one RuleNode per logical child. Handles both
 * DOM-nested wrappers and sibling-implied meta-parent rules.
 */
function walkUl(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
  unverified: string[],
): RuleNode[] {
  const items = collectLiSiblings($, $ul);
  const out: RuleNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = parseLi($, items[i], contextLabel, warnings, unverified);
    if (parsed === null) continue;
    if (parsed.kind === "metaParent") {
      // Consume subsequent siblings as children until end of ul or another
      // metaParent. Skipped (null) siblings are just noise; non-null siblings
      // become children.
      const children: RuleNode[] = [];
      let j = i + 1;
      while (j < items.length) {
        const next = parseLi($, items[j], contextLabel, warnings, unverified);
        if (next !== null) {
          if (next.kind === "metaParent") break;
          if (next.kind === "node") children.push(next.node);
          // A unit-quota child ("Complete N units from the following list") can't
          // be bound to a sibling open pick here (only the outer loop does that),
          // so surface it verbatim rather than dropping it silently. R4.
          else if (next.kind === "unitQuota") unverified.push(next.text);
        }
        j++;
      }
      out.push({
        kind: "pick",
        ...(parsed.description !== undefined
          ? { description: parsed.description }
          : {}),
        selectMin: parsed.selectMin,
        selectMax: parsed.selectMax,
        children,
      });
      // Resume at the sibling that stopped us; the outer loop re-parses it.
      // Safe: parseLi only stops on a metaParent, whose branch has no side
      // effects.
      i = j - 1;
      continue;
    }
    if (parsed.kind === "unitQuota") {
      // Bind the quota onto the next sibling that is an OPEN pick ("Choose any of
      // the following: …" — the courses the quota refers to), turning an ungated
      // optional list into a real "pick N" gate. Kuali states the quota first, so
      // only look forward; no bindable pick ⇒ keep the quota verbatim. R4.
      let j = i + 1;
      let sibling: ParsedLi | null = null;
      while (j < items.length) {
        sibling = parseLi($, items[j], contextLabel, warnings, unverified);
        if (sibling !== null) break;
        j++;
      }
      if (sibling?.kind === "node" && isOpenPick(sibling.node)) {
        out.push({
          ...sibling.node,
          selectMin: parsed.count,
          selectMax: parsed.count,
        });
        i = j;
      } else {
        unverified.push(parsed.text);
        // Emit the peeked sibling as parsed so nothing is dropped; a metaParent
        // (or no sibling) is left for the outer loop, which re-parses it safely.
        if (sibling?.kind === "node") {
          out.push(sibling.node);
          i = j;
        } else {
          i = j - 1;
        }
      }
      continue;
    }
    out.push(parsed.node);
  }
  return out;
}

/** An unbounded `pick` ("Choose any of the following: …") — 0 required slots, so
 *  it doesn't gate until a quota binds `selectMin`/`selectMax` onto it. */
function isOpenPick(
  node: RuleNode,
): node is Extract<RuleNode, { kind: "pick" }> {
  return (
    node.kind === "pick" &&
    node.selectMin === undefined &&
    node.selectMax === undefined
  );
}

/**
 * Gather a `<ul>`'s logical `<li>` children. Kuali sometimes wraps subsets
 * of children in a `<div>` (for the `rules_groupHeader_37` spacer) — we look
 * one level into those `<div>`s.
 */
function collectLiSiblings(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
): ReturnType<cheerio.CheerioAPI>[] {
  const out: ReturnType<cheerio.CheerioAPI>[] = [];
  $ul.children().each((_, child) => {
    const $child = $(child);
    if (child.type === "tag" && child.name === "li") {
      out.push($child);
    } else if (child.type === "tag" && child.name === "div") {
      $child.children("li").each((_, li) => {
        out.push($(li));
      });
    }
  });
  return out;
}

type ParsedLi =
  | { kind: "node"; node: RuleNode }
  | {
      kind: "metaParent";
      description?: string;
      selectMin?: number;
      selectMax?: number;
    }
  // A unit quota ("Complete 2.5 units from the following list") whose courses are
  // in a sibling open pick; walkUl binds `count` onto that pick, else records the
  // text unverified. R4.
  | { kind: "unitQuota"; count: number; text: string };

/**
 * A recognized rule whose codes we couldn't extract is a silent loss (a bare
 * `return null` would let the audit read 100%). Record it as unverified and warn.
 */
function recordUnextracted(
  fullText: string,
  prefix: string,
  contextLabel: string,
  warnings: string[],
  unverified: string[],
): null {
  unverified.push(fullText);
  warnings.push(
    `${contextLabel}: recognized rule but extracted no course codes — "${prefix}"`,
  );
  return null;
}

function parseLi(
  $: cheerio.CheerioAPI,
  $li: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
  unverified: string[],
): ParsedLi | null {
  // DOM-nested wrapper: <li>(no data-test) with a <span> + nested <ul>.
  const dataTest = $li.attr("data-test");
  if (!dataTest) {
    const $directChildren = $li.children();
    const $span = $directChildren.filter("span").first();
    const $childUl = $directChildren.filter("ul").first();
    if ($childUl.length === 0) return null;
    const wrapperText = cleanText($span.text());
    const children = walkUl($, $childUl, contextLabel, warnings, unverified);
    if (children.length === 0) return null;
    const wrapper = wrapWithProse(wrapperText, children);
    return { kind: "node", node: wrapper };
  }

  // Leaf rule: <li data-test="ruleView-X"> with <div data-test="ruleView-X-result"> inside.
  const $result = $li.children(RULE_RESULT_SELECTOR).first();
  if ($result.length === 0) return null;

  const fullText = cleanText($result.text());
  const colonIdx = fullText.indexOf(":");
  const prefix =
    colonIdx >= 0
      ? fullText.slice(0, colonIdx).trim()
      : fullText.slice(0, MAX_PREFIX_LEN);

  const codes = collectCourseCodes($, $result);

  // Owed but un-encodable (type/diversity/conditional): keep verbatim before any
  // widening below can lossy-convert it (e.g. a "…from List 2 or List 3; ≥2
  // subject codes" rule must not become a plain pick over those lists). R6.
  if (codes.length === 0 && KEEP_UNVERIFIED_RE.test(fullText)) {
    unverified.push(fullText);
    return null;
  }

  // A rule referencing a `courseListsNew` list by name extracts no codes itself;
  // join the list's courses before the branches below record it unverified. See
  // #117 (bucket D).
  if (codes.length === 0) {
    const listCourses = resolveNamedList(fullText);
    const n = listCourses ? requiredCount(fullText) : null;
    // Only a real selection rule ("Complete/Choose … N") becomes a pick — prose
    // that merely MENTIONS a list ("In List 1, keep a 60% average") isn't one.
    const isSelection =
      n !== null || /^(?:Complete|Choose|Select|Take)\b/i.test(prefix);
    if (listCourses && isSelection) {
      // Not honestly structurable when the count is missing (an open pick has 0
      // required slots ⇒ optional ⇒ audit reads 100%) OR the list is only PART of
      // the options (a "GER courses or from the list" union — a list-only pick
      // would be too strict). Surface unverified so it still gates, truthfully.
      if (n === null || namesUncapturedSource(fullText)) {
        unverified.push(fullText);
        warnings.push(
          `${contextLabel}: named-list rule not fully structurable — "${prefix}"`,
        );
        return null;
      }
      return {
        kind: "node",
        node: {
          kind: "pick",
          selectMin: n,
          selectMax: n,
          children: [{ kind: "courses", courses: listCourses }],
        },
      };
    }
  }

  if (COMPLETE_ALL_RE.test(prefix)) {
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    return { kind: "node", node: { kind: "courses", courses: codes } };
  }

  const nOf = COMPLETE_N_OF_RE.exec(prefix);
  if (nOf) {
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    const n = Number(nOf[1]);
    return {
      kind: "node",
      node: {
        kind: "pick",
        selectMin: n,
        selectMax: n,
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  // "Complete of the following: …" — Kuali dropped the count word. Codes are
  // inline; read it as a pick of 1 (the observed case lists two equivalents). R4.
  if (COMPLETE_OF_RE.test(prefix) && codes.length > 0) {
    return {
      kind: "node",
      node: {
        kind: "pick",
        selectMin: 1,
        selectMax: 1,
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  if (CHOOSE_ANY_RE.test(prefix)) {
    if (codes.length === 0) {
      // No literal codes — try the pool half ("any CS course at the 600-/700-
      // level") before giving up. See #117 (bucket C).
      const pool = parseChooseAnyPool(fullText);
      if (pool) return { kind: "node", node: pool };
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    }
    return {
      kind: "node",
      node: {
        kind: "pick",
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  const noMoreThan = COMPLETE_NO_MORE_THAN_RE.exec(prefix);
  if (noMoreThan) {
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    return {
      kind: "node",
      node: {
        kind: "pick",
        selectMax: Number(noMoreThan[1]),
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  const metaParent = COMPLETE_N_FROM_CHOICES_RE.exec(prefix);
  if (metaParent) {
    const n = Number(metaParent[1]);
    return { kind: "metaParent", selectMin: n, selectMax: n };
  }

  if (EXCLUDED_RE.test(prefix)) {
    // An exclusion with no extractable codes excludes nothing, so it's not an
    // owed requirement (don't gate the audit on it) — but warn, since a parse
    // miss here means a course that SHOULD be barred might still be credited.
    if (codes.length === 0) {
      warnings.push(
        `${contextLabel}: exclusion rule but extracted no course codes — "${prefix}"`,
      );
      return null;
    }
    return {
      kind: "node",
      node: { kind: "excluded", courses: codes },
    };
  }

  // A rule whose selection list names course RANGES ("Complete 3 additional CS
  // courses chosen from CS340-CS398, CS440-CS489") is a pick over those courses,
  // NOT a subject pool: parseSubjectPool's "from:" handling strips each range to
  // a bogus subject ("CS340-CS398" → "CSCS"), yielding an unsatisfiable pool. A
  // digit-bearing range is unambiguous, so expand it to offered courses here,
  // before that fallback. Any colon-list "Complete N of …: <range>" already
  // matched an earlier branch. #117 follow-up.
  const leadCount = LEAD_COUNT_RE.exec(fullText);
  if (leadCount) {
    // A filter/diversity qualifier ("3 seminars from …") can't be honored by a
    // plain pick over the range — the range branch below would drop it and
    // over-credit. Keep unverified instead. R6 follow-up.
    if (KEEP_UNVERIFIED_RE.test(fullText)) {
      unverified.push(fullText);
      return null;
    }
    const rangeCodes = expandRanges(fullText);
    const n = wordToNumber(leadCount[1]);
    if (rangeCodes.length > 0 && n !== undefined) {
      const courses = [...new Set([...codes, ...rangeCodes])].sort();
      return {
        kind: "node",
        node: {
          kind: "pick",
          selectMin: n,
          selectMax: n,
          children: [{ kind: "courses", courses }],
        },
      };
    }
  }

  // Grade-gated wrapper ("Complete the following courses with a minimum
  // cumulative … average of X%"). Grades aren't tracked, so drop the threshold:
  // any inline codes become a plain requirement, else the courses are in a
  // sibling "Complete all: …" already captured and this leaf is a phantom. R4.
  if (COMPLETE_ALL_GRADED_RE.test(prefix)) {
    if (codes.length > 0)
      return { kind: "node", node: { kind: "courses", courses: codes } };
    return null;
  }

  // Unit quota over an inline "following list" whose courses are in a sibling
  // open pick (walkUl binds the count) or inline here (a pick over them). R4.
  const unitsFromList = COMPLETE_N_UNITS_FROM_LIST_RE.exec(fullText);
  if (unitsFromList) {
    const count = unitsToCount(Number(unitsFromList[1]));
    if (codes.length > 0)
      return {
        kind: "node",
        node: {
          kind: "pick",
          selectMin: count,
          selectMax: count,
          children: [{ kind: "courses", courses: codes }],
        },
      };
    return { kind: "unitQuota", count, text: fullText };
  }

  // Subject-pool prose. Try against the full text (the rule may have colons).
  const subjectPool = parseSubjectPool(fullText);
  if (subjectPool) return { kind: "node", node: subjectPool };

  // A genuinely-open free elective — drop it (the units headline tracks the room)
  // rather than add a redundant "confirm with your advisor" row. But a LIST /
  // "from the following" scope is a real requirement: fall through to unverified
  // so its scope isn't lost ("Complete 4 approved electives from List 2").
  if (
    FREE_ELECTIVE_RE.test(fullText) &&
    !/\bList\s+[A-Za-z0-9]|\bfrom the following\b/i.test(fullText)
  ) {
    // Redundant with the unit headline's free remainder — but only when the
    // program has a totalUnits denominator. Record it so the assembler can
    // re-surface it as unverified for programs that lack one (else the audit
    // could read 100% with the electives unaccounted). #117.
    droppedFreeElectives.push(fullText);
    return null;
  }

  // Unstructurable <li>. If it states an owed action ("Complete …" — an
  // unscoped subject pool, or unrecognized "Complete" prose), surface it
  // verbatim as UNVERIFIED so the audit doesn't read complete. Owed-but-
  // unstructured, not a parser miss, so no developer warning.
  if (/^Complete\b/i.test(prefix)) {
    unverified.push(fullText);
    return null;
  }

  // Non-action prose (Note/If/preambles) is noise, dropped silently — unless it
  // still names courses (a conditional "If you entered before F2020, complete
  // CS241 instead of CS241E"): surface that verbatim rather than lose the rule.
  if (DEFERRED_PROSE_RE.test(prefix)) {
    if (codes.length > 0) unverified.push(fullText);
    return null;
  }

  warnings.push(`${contextLabel}: unrecognized rule — "${prefix}"`);
  return null;
}

function collectCourseCodes(
  $: cheerio.CheerioAPI,
  $result: ReturnType<cheerio.CheerioAPI>,
): string[] {
  const anchored = anchorCourseCodes($, $result);
  const codes = new Set<string>(anchored);
  const text = $result.text();
  const colon = text.indexOf(":");
  const list = colon >= 0 ? text.slice(colon + 1) : "";
  if (list) {
    // Ranges ("CS440-CS498") are never hyperlinked, so expand them even when the
    // rule also has anchored literals — a plain-text range in a mixed list isn't
    // lost. expandRanges is exclusion-aware, so "(excluding CS450-CS460)" / "…,
    // except CS499" after the colon aren't counted. Real codes only. See #117 (C).
    for (const code of expandRanges(list)) codes.add(code);
    // Literal plain-text codes only as a fallback when nothing was hyperlinked
    // (Kuali "…W" codes, unlinked INDEV387), so prose codes don't leak into an
    // already-anchored rule. Drop excluded/range/parenthetical text first.
    if (anchored.length === 0) {
      const excluded = excludedCodes(list);
      const remainder = list
        .replace(/\([^)]*\)/g, " ")
        .replace(EXCLUSION_LIST_RE, " ")
        .replace(CODE_RANGE_RE_G, " ");
      for (const tok of remainder.match(TEXT_CODE_RE) ?? []) {
        const code = normalizeCourseCode(tok);
        if (code && !excluded.has(code)) codes.add(code);
      }
    }
  }
  return [...codes].sort();
}

/**
 * Wrap children by a DOM wrapper `<li>`'s prose. Only "Complete N of" is
 * structural; recognized "Complete all/N of …" text is dropped (describeRule
 * reconstructs it). Non-standard prose is preserved on the node.
 */
function wrapWithProse(wrapperText: string, children: RuleNode[]): RuleNode {
  const nOf = COMPLETE_N_OF_RE.exec(wrapperText);
  if (nOf) {
    const n = Number(nOf[1]);
    return {
      kind: "pick",
      selectMin: n,
      selectMax: n,
      children,
    };
  }
  // Keep non-standard wrapper prose verbatim — even on the single-child fast
  // path, where unwrapping would otherwise drop it.
  const isStandardAll = COMPLETE_ALL_RE.test(wrapperText);
  if (children.length === 1 && (!wrapperText || isStandardAll)) {
    return children[0];
  }
  return {
    kind: "all",
    ...(wrapperText && !isStandardAll ? { description: wrapperText } : {}),
    children,
  };
}

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
}
