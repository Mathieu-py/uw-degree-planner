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

/**
 * Build a kebab-case slug for a `Specialization` from its `code` field
 * (e.g. `"HIST-Global Interactions Specialization"` →
 * `"hist-global-interactions"`).
 *
 * Mirrors `buildProgramSlug` minus the credential-prefix stripping: spec
 * codes start with a faculty/program prefix (HIST, CEC, SYDE, CS, ENGL, …)
 * which is part of the spec's identity and must be retained. The trailing
 * `-specialization` suffix is redundant after slugification and is removed
 * for readability.
 */
export function buildSpecializationSlug(code: string): string {
  return rawSlug(code).replace(/-specialization$/, "");
}

/**
 * Extract specialization references from a parent program's
 * `specializationsList` HTML. Each anchor looks like
 * `<a href="#/programs/view/{id}">{name}</a>`.
 *
 * The `id` is the 24-char hex identifier the parent uses to reference the
 * spec — the same value the `/program/byId/{catalogId}/{id}` endpoint
 * accepts. The spec's own `pid` field is a different (short-alpha) value
 * and is NOT what we want here.
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
