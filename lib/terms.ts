import type { TermId } from "./types";

/**
 * UWFlow term IDs are `1<YY><season>` where YY is the last two digits of the
 * calendar year and the season digit is 1 = Winter, 5 = Spring, 9 = Fall.
 * This holds for every term we've fetched (1255 / 1259 / 1261 / 1265 / 1269)
 * and matches UW's documented Quest term-number scheme.
 */
export type TermSeason = "Winter" | "Spring" | "Fall";

export interface TermInfo {
  id: TermId;
  year: number;
  season: TermSeason;
  label: string;
}

const SEASON_DIGIT: Record<TermSeason, number> = {
  Winter: 1,
  Spring: 5,
  Fall: 9,
};

const SEASONS_IN_ORDER: TermSeason[] = ["Winter", "Spring", "Fall"];

export function makeTermId(year: number, season: TermSeason): TermId {
  if (year < 2000 || year > 2099) {
    throw new Error(`Year out of supported range (2000-2099): ${year}`);
  }
  return 1000 + (year % 100) * 10 + SEASON_DIGIT[season];
}

export function parseTermId(
  id: TermId,
): { year: number; season: TermSeason } | null {
  if (id < 1000 || id > 1999) return null;
  const seasonDigit = id % 10;
  const season =
    seasonDigit === 1
      ? "Winter"
      : seasonDigit === 5
        ? "Spring"
        : seasonDigit === 9
          ? "Fall"
          : null;
  if (!season) return null;
  const yearLow = Math.floor((id - 1000) / 10);
  return { year: 2000 + yearLow, season };
}

function buildTermInfo(year: number, season: TermSeason): TermInfo {
  return {
    id: makeTermId(year, season),
    year,
    season,
    label: `${season} ${year}`,
  };
}

export function termInfo(id: TermId): TermInfo | null {
  const parsed = parseTermId(id);
  if (!parsed) return null;
  return buildTermInfo(parsed.year, parsed.season);
}

export function termLabel(id: TermId): string {
  return termInfo(id)?.label ?? `Term ${id}`;
}

/** The term immediately following the given term in the academic calendar. */
export function nextTerm(info: TermInfo): TermInfo {
  if (info.season === "Fall") {
    return buildTermInfo(info.year + 1, "Winter");
  }
  const idx = SEASONS_IN_ORDER.indexOf(info.season);
  return buildTermInfo(info.year, SEASONS_IN_ORDER[idx + 1]);
}

/** Inclusive sequence of `count` consecutive terms starting at `start`. */
export function sequenceTermsFrom(start: TermInfo, count: number): TermInfo[] {
  const out: TermInfo[] = [];
  let cur = start;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = nextTerm(cur);
  }
  return out;
}

/**
 * Pre-generated table of terms used by /browse and snapshot lookups. Spans
 * 2020 through 2030 inclusive — large enough to cover any in-flight student
 * plan without being absurd. Generated, not hand-edited.
 */
export const KNOWN_TERMS: TermInfo[] = (() => {
  const out: TermInfo[] = [];
  for (let year = 2020; year <= 2030; year++) {
    for (const season of SEASONS_IN_ORDER) {
      out.push(buildTermInfo(year, season));
    }
  }
  return out;
})();

/** Term the browse/course routes are pinned to until a term picker exists. */
export const PINNED_TERM: TermId = 1261;

/**
 * Parse the human label produced by the transcript parser
 * (e.g. "Fall 2023", "Winter 2024") back into a calendar TermId. Returns
 * `null` for shapes we don't recognize — including "Transfer Credit" and
 * any free-form text the parser couldn't classify (the caller decides
 * whether those land in the synthetic pre-arrival slot or are dropped).
 *
 * Tolerates case differences and surrounding whitespace.
 */
export function termLabelToTermId(label: string): TermId | null {
  const m = label.trim().match(/^(Winter|Spring|Fall)\s+(\d{4})$/i);
  if (!m) return null;
  const season = (m[1].charAt(0).toUpperCase() +
    m[1].slice(1).toLowerCase()) as TermSeason;
  const year = parseInt(m[2], 10);
  if (year < 2000 || year > 2099) return null;
  return makeTermId(year, season);
}
