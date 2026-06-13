import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateCoursesFile } from "../../lib/courses/validation";

interface CatalogEntry {
  num: number;
  code: string;
}

export interface CatalogIndex {
  /** Every catalog code (lowercase, e.g. "cs136"). */
  codes: Set<string>;
  /** subject prefix → its courses, so a code RANGE can be expanded to real codes. */
  byPrefix: Map<string, CatalogEntry[]>;
}

const EMPTY: CatalogIndex = { codes: new Set(), byPrefix: new Map() };

let cached: CatalogIndex | null = null;

/** Split a stored code ("cs136", "emls101r") into subject prefix + number. */
function splitCode(code: string): CatalogEntry & { prefix: string } {
  const m = code.match(/^([a-z]+)(\d+)/);
  return m
    ? { prefix: m[1], num: Number(m[2]), code }
    : { prefix: code, num: Number.NaN, code };
}

/**
 * Load the committed course snapshot (`data/courses.<termId>.json`, newest term)
 * as a lookup for expanding code RANGES against the AUTHORITATIVE catalog —
 * never synthesizing codes that don't exist. Read with plain `node:fs` because
 * the scraper is a `tsx` script and can't use the `server-only` `loadTerm`.
 * Memoized (read once per run). A missing/unreadable file degrades to empty
 * structures, so a range simply expands to nothing (stays unverified) rather
 * than crashing the scrape. See #117 (bucket C).
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

    const codes = new Set<string>();
    const byPrefix = new Map<string, CatalogEntry[]>();
    for (const c of courses) {
      const code = c.code.toLowerCase();
      codes.add(code);
      const { prefix, num } = splitCode(code);
      if (Number.isNaN(num)) continue;
      const bucket = byPrefix.get(prefix);
      if (bucket) bucket.push({ num, code });
      else byPrefix.set(prefix, [{ num, code }]);
    }
    cached = { codes, byPrefix };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

/**
 * Expand a parsed code range to the catalog codes whose subject is `prefix` and
 * whose number falls in `[lo, hi]` inclusive (the calendar states subject bands
 * inclusively). Returns only codes that EXIST in the snapshot — a range whose
 * subject is absent (cross-listed/WLU) expands to nothing. Suffix-letter codes
 * (e.g. "cs497a") are kept when their number is in band.
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
