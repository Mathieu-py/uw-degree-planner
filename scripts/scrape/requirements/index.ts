import * as cheerio from "cheerio";
import {
  isTermLetter,
  type RuleNode,
  TERM_LETTERS,
  type TermLetter,
} from "../../../lib/programs";
import { buildNamedListIndex } from "../program/electives";
import { cleanText, SECTION_HEADING_SELECTOR } from "../util/dom";
import type { ParseContext } from "./context";
import { indexSectionLists, LIST_REF_RE_G } from "./namedLists";
import { parseSectionTree } from "./tree";

// Re-exported for a ReDoS regression test on EXCLUSION_LIST_RE (see ./ranges).
export { excludedCodes } from "./ranges";

export interface ProgramDetailFields {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  /** Structured named lists ("Technical Electives List") joined by name. */
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
  // One context per program so a "from List N" rule joins to THIS program's
  // named lists and never leaks the previous program's. The context is created
  // and consumed within this synchronous call, so parses of different programs
  // are fully isolated (the old module-level globals required serialization).
  const ctx: ParseContext = {
    namedLists: buildNamedListIndex(detail.courseListsNew),
    droppedFreeElectives: [],
    warnings: [],
    unverified: [],
  };

  const engHtml = detail.requiredCoursesTermByTerm?.trim();
  const reqHtml = detail.requirements?.trim();
  const noUnitsHtml = detail.courseRequirementsNoUnits?.trim();
  const result: ParseResult = engHtml
    ? parseEngineering(ctx, engHtml, programLabel)
    : reqHtml
      ? parseFlexible(ctx, reqHtml, programLabel)
      : noUnitsHtml
        ? parseFlexible(ctx, noUnitsHtml, programLabel)
        : { kind: "empty", warnings: [], unverified: [] };

  if (ctx.droppedFreeElectives.length > 0)
    result.freeElectives = [...ctx.droppedFreeElectives];
  return result;
}

function parseEngineering(
  ctx: ParseContext,
  html: string,
  programLabel: string,
): ParseResult {
  const terms = emptyTermsTree();
  const $ = cheerio.load(html);

  $("section").each((_, section) => {
    const $section = $(section);
    const header = cleanText($section.find(SECTION_HEADING_SELECTOR).text());
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const root = parseSectionTree(
      ctx,
      $,
      $section,
      `${programLabel} ${termLetter}`,
    );
    if (root.children.length > 0) {
      terms[termLetter] = root;
    }
  });

  return {
    kind: "engineering",
    terms,
    warnings: ctx.warnings,
    unverified: ctx.unverified,
  };
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

function parseFlexible(
  ctx: ParseContext,
  html: string,
  programLabel: string,
): ParseResult {
  const $ = cheerio.load(html);

  // Index the titled sections' courses before parsing rules, so a rule pointing
  // at a sibling section by name ("… from the list of Approved Courses below")
  // can join to it — even a forward reference to a section parsed later.
  indexSectionLists(ctx, $, $("section"));

  // Each <section> is a titled group ("Required Courses", "List 1", …). Collect
  // each section's parsed rules alongside its heading — only the first heading
  // carries Kuali's `grouping-label` testid, so fall back to the first <h2>.
  const sections: { heading: string; children: RuleNode[] }[] = [];
  $("section").each((_, section) => {
    const $sec = $(section);
    const root = parseSectionTree(ctx, $, $sec, programLabel);
    if (root.children.length === 0) return;
    const heading = cleanText(
      $sec.find(SECTION_HEADING_SELECTOR).first().text() ||
        $sec.find("h2").first().text(),
    );
    sections.push({ heading, children: root.children });
  });

  if (sections.length === 0) {
    return {
      kind: "empty",
      warnings: ctx.warnings,
      unverified: ctx.unverified,
    };
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
  const structuredUnverified = ctx.unverified.filter((text) => {
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
    warnings: ctx.warnings,
    unverified: structuredUnverified,
  };
}

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
}
