import * as cheerio from "cheerio";

const CREDENTIAL_PREFIX_RE = /^(h|jh|3g|4g)-/;

function rawSlug(code: string): string {
  return code
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug for a program `code` (e.g. "H-Systems Design Engineering" →
 * "systems-design-engineering"). The credential prefix (H, JH, 3G, 4G) is
 * stripped, but retained when it would disambiguate a collision.
 * `conflictCounts` maps each *stripped* slug to its total program count.
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

/**
 * Slug for a `Specialization` `code` (e.g. "HIST-Global Interactions
 * Specialization" → "hist-global-interactions"). Unlike programs, the
 * faculty/program prefix (HIST, SYDE, CS, …) is part of the spec's identity
 * and kept; only the redundant `-specialization` suffix is dropped.
 */
export function buildSpecializationSlug(code: string): string {
  return rawSlug(code).replace(/-specialization$/, "");
}

/**
 * Extract specialization refs from a parent's `specializationsList` HTML
 * (anchors `<a href="#/programs/view/{id}">{name}</a>`). The `id` is the
 * 24-char hex the `/program/byId/{catalogId}/{id}` endpoint accepts — not
 * the spec's own short-alpha `pid`.
 */
const SPEC_HREF_PREFIX = "#/programs/view/";
export function parseSpecializationsList(
  html: string | undefined,
): Array<{ id: string; name: string }> {
  if (!html) return [];
  const $ = cheerio.load(html);
  return $(`a[href^="${SPEC_HREF_PREFIX}"]`)
    .toArray()
    .map((el) => ({
      // biome-ignore lint/style/noNonNullAssertion: selector guarantees href starts with the prefix
      id: $(el).attr("href")!.slice(SPEC_HREF_PREFIX.length),
      name: $(el).text().trim(),
    }));
}
