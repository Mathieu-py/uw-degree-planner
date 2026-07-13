import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateCoursesFile } from "../../../lib/courses/validation";

interface CatalogEntry {
  num: number;
  code: string;
}

export interface CatalogIndex {
  /** Subject prefix → its courses, so a code range can be expanded to real codes. */
  byPrefix: Map<string, CatalogEntry[]>;
}

const EMPTY: CatalogIndex = { byPrefix: new Map() };

let cached: CatalogIndex | null = null;

/** Split a stored code ("cs136", "emls101r") into subject prefix + number. */
function splitCode(code: string): CatalogEntry & { prefix: string } {
  const m = code.match(/^([a-z]+)(\d+)/);
  return m
    ? { prefix: m[1], num: Number(m[2]), code }
    : { prefix: code, num: Number.NaN, code };
}

/**
 * Load the newest committed course snapshot (`data/courses.<termId>.json`) as a
 * lookup for expanding code ranges against the authoritative catalog. Plain
 * `node:fs` (the scraper is a tsx script, no `server-only` loadTerm); memoized.
 * A missing/unreadable file degrades to empty, so a range expands to nothing
 * rather than crashing.
 */
export function loadCatalogCodes(): CatalogIndex {
  if (cached) return cached;
  try {
    const dataDir = path.resolve(process.cwd(), "data");
    const newest = readdirSync(dataDir)
      .map((f) => /^courses\.(\d+)\.json$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ file: m[0], term: Number(m[1]) }))
      .sort((a, b) => b.term - a.term)[0];
    if (!newest) {
      cached = EMPTY;
      return cached;
    }
    const raw = JSON.parse(
      readFileSync(path.join(dataDir, newest.file), "utf-8"),
    );
    const { courses } = validateCoursesFile(raw);

    const byPrefix = new Map<string, CatalogEntry[]>();
    for (const c of courses) {
      const code = c.code.toLowerCase();
      const { prefix, num } = splitCode(code);
      if (Number.isNaN(num)) continue;
      // A range means "any real, offered course in this band": index only
      // weighted courses (units present), excluding inactive/not-offered and WLU
      // cross-listed members a student can't take.
      if (c.units == null) continue;
      const bucket = byPrefix.get(prefix);
      if (bucket) bucket.push({ num, code });
      else byPrefix.set(prefix, [{ num, code }]);
    }
    cached = { byPrefix };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

/**
 * Expand a parsed range to the catalog codes whose subject is `prefix` and whose
 * number is in `[lo, hi]` inclusive. Only codes that exist in the snapshot (an
 * absent subject → nothing); suffix-letter codes ("cs497a") count when in band.
 */
export function catalogCodesInRange(range: {
  prefix: string;
  lo: number;
  hi: number;
}): string[] {
  const { byPrefix } = loadCatalogCodes();
  const bucket = byPrefix.get(range.prefix) ?? [];
  return bucket
    .filter((e) => e.num >= range.lo && e.num <= range.hi)
    .map((e) => e.code);
}

/** Test-only: reset the memoized catalog (e.g. between unit tests). */
export function __resetCatalogCache(): void {
  cached = null;
}
