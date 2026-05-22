import * as cheerio from "cheerio";
import type { TermLetter } from "../lib/programs";
import { TERM_LETTERS } from "../lib/programs";

export interface ParseResult {
  terms: Record<TermLetter, string[]>;
  warnings: string[];
}

const emptyTerms = (): Record<TermLetter, string[]> =>
  Object.fromEntries(
    TERM_LETTERS.map((t) => [t, [] as string[]]),
  ) as Record<TermLetter, string[]>;

export function parseRequiredCoursesTermByTerm(
  html: string,
  programLabel = "(unknown)",
): ParseResult {
  const terms = emptyTerms();
  const warnings: string[] = [];
  if (!html.trim()) return { terms, warnings };

  const $ = cheerio.load(html);

  $("section").each((_, section) => {
    const header = $(section)
      .find('h2[data-testid="grouping-label"]')
      .text()
      .trim();
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const codes = new Set<string>();
    $(section)
      .find('div[data-test="ruleView-A-result"]')
      .each((_, rule) => {
        const fullText = $(rule).text();
        const colonIdx = fullText.indexOf(":");
        const prefix = fullText
          .slice(0, colonIdx >= 0 ? colonIdx : Math.min(fullText.length, 120))
          .replace(/\s+/g, " ")
          .trim();

        if (/^Complete all the following/i.test(prefix)) {
          $(rule)
            .find("a")
            .each((_, a) => {
              const code = normalizeCourseCode($(a).text());
              if (code) codes.add(code);
            });
        } else if (
          /^Complete \d+ of/i.test(prefix) ||
          /\bone of the following\b/i.test(prefix) ||
          /^Choose \d+/i.test(prefix)
        ) {
          warnings.push(
            `${programLabel} ${termLetter}: OR group skipped — "${prefix.trim()}"`,
          );
        }
      });

    if (codes.size > 0) terms[termLetter] = [...codes].sort();
  });

  return { terms, warnings };
}

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  if (m && (TERM_LETTERS as readonly string[]).includes(m[1]))
    return m[1] as TermLetter;
  return null;
}

export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

const CREDENTIAL_PREFIX_RE = /^(h|jh|3g|4g)-/;

function rawSlug(code: string): string {
  return code
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a kebab-case slug for a program's `code` field (e.g.
 * "H-Systems Design Engineering" → "systems-design-engineering").
 *
 * The credential prefix (H, JH, 3G, 4G) is stripped by default since
 * Honours is the common case and the prefix is noise. If multiple
 * programs would collapse to the same stripped slug, the prefix is
 * retained for disambiguation (e.g. "h-anthropology" vs "3g-anthropology").
 *
 * `conflictCounts` must map every program's *stripped* slug to the total
 * count of programs sharing it.
 */
export function buildProgramSlug(
  code: string,
  conflictCounts: ReadonlyMap<string, number>,
): string {
  const full = rawSlug(code);
  const stripped = full.replace(CREDENTIAL_PREFIX_RE, "");
  const collisions = conflictCounts.get(stripped) ?? 0;
  return collisions > 1 ? full : stripped;
}

export function buildConflictCounts(
  codes: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const stripped = rawSlug(c).replace(CREDENTIAL_PREFIX_RE, "");
    counts.set(stripped, (counts.get(stripped) ?? 0) + 1);
  }
  return counts;
}
