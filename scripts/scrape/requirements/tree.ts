// The rule-tree walker: turns a Kuali requirement <section> into a RuleNode tree
// by walking its <ul> hierarchy (DOM-nested wrappers and sibling-implied meta
// parents both handled) and classifying each leaf <li> against the patterns in
// `./patterns`. Parse state (named lists, warnings, unverified, dropped free
// electives) rides in the `ParseContext` argument.
import type * as cheerio from "cheerio";
import type { RuleNode } from "../../../lib/programs";
import { unitsToCount, wordToNumber } from "../util/counts";
import {
  anchorCourseCodes,
  cleanText,
  RULE_RESULT_SELECTOR,
} from "../util/dom";
import {
  CODE_RANGE_RE_G,
  normalizeCourseCode,
  TEXT_CODE_RE,
} from "../util/normalize";
import type { ParseContext } from "./context";
import {
  namesUncapturedSource,
  requiredCount,
  resolveNamedList,
} from "./namedLists";
import {
  CHOOSE_ANY_RE,
  COMPLETE_ALL_GRADED_RE,
  COMPLETE_ALL_RE,
  COMPLETE_N_FROM_CHOICES_RE,
  COMPLETE_N_OF_RE,
  COMPLETE_N_UNITS_FROM_LIST_RE,
  COMPLETE_NO_MORE_THAN_RE,
  COMPLETE_OF_RE,
  DEFERRED_PROSE_RE,
  EXCLUDED_RE,
  FREE_ELECTIVE_RE,
  KEEP_UNVERIFIED_RE,
  LEAD_COUNT_RE,
  MAX_PREFIX_LEN,
} from "./patterns";
import { EXCLUSION_LIST_RE, excludedCodes, expandRanges } from "./ranges";
import { parseChooseAnyPool, parseSubjectPool } from "./subjectPool";

/**
 * Build a rule tree from a `<section>`, walking its top-level `<ul>`
 * hierarchically. Two parent-child shapes both produce a tree:
 *   - DOM-nested: `<li><span>Complete all…</span><ul>…children…</ul></li>`
 *   - Sibling-implied: a leaf `<li>` with meta-prose ("Complete N courses from
 *     the following choices:") consumes subsequent same-level siblings.
 */
export function parseSectionTree(
  ctx: ParseContext,
  $: cheerio.CheerioAPI,
  $section: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
): RuleNode & { kind: "all" } {
  const topUl = $section
    .children()
    .find("ul")
    .filter((_, ul) => $(ul).children("li").length > 0)
    .first();
  if (topUl.length === 0) return { kind: "all", children: [] };
  const children = walkUl(ctx, $, topUl, contextLabel);
  return { kind: "all", children };
}

/**
 * Walk a `<ul>` and produce one RuleNode per logical child. Handles both
 * DOM-nested wrappers and sibling-implied meta-parent rules.
 */
function walkUl(
  ctx: ParseContext,
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
): RuleNode[] {
  const { unverified } = ctx;
  const items = collectLiSiblings($, $ul);
  const out: RuleNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = parseLi(ctx, $, items[i], contextLabel);
    if (parsed === null) continue;
    if (parsed.kind === "metaParent") {
      // Consume subsequent siblings as children until end of ul or another
      // metaParent. Skipped (null) siblings are just noise; non-null siblings
      // become children.
      const children: RuleNode[] = [];
      let j = i + 1;
      while (j < items.length) {
        const next = parseLi(ctx, $, items[j], contextLabel);
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
        sibling = parseLi(ctx, $, items[j], contextLabel);
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
  ctx: ParseContext,
  $: cheerio.CheerioAPI,
  $li: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
): ParsedLi | null {
  const { warnings, unverified, droppedFreeElectives } = ctx;
  // DOM-nested wrapper: <li>(no data-test) with a <span> + nested <ul>.
  const dataTest = $li.attr("data-test");
  if (!dataTest) {
    const $directChildren = $li.children();
    const $span = $directChildren.filter("span").first();
    const $childUl = $directChildren.filter("ul").first();
    if ($childUl.length === 0) return null;
    const wrapperText = cleanText($span.text());
    const children = walkUl(ctx, $, $childUl, contextLabel);
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
    const listCourses = resolveNamedList(ctx, fullText);
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
