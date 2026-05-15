/**
 * FilterState ↔ URL codec. Empty querystring decodes to DEFAULT_FILTER_STATE
 * (full catalog); encoding omits any field at its default so shared URLs
 * stay short and "no params" round-trips cleanly. Keys are abbreviated (exc,
 * lv, done, minU, …) so a typical filtered view fits on one line.
 *
 * Invariant: prefix arrays are uppercase and course codes are lowercase at
 * every state boundary (decode normalises, UI controls add normalised). The
 * encoder trusts this and does not re-normalise.
 */

import type { FilterState } from "./types";

export const BROWSE_QS_STORAGE_KEY = "uwfinder.browseQs";

// URL keys owned by FilterState. Used by mergeFilterStateIntoParams to
// overwrite filter slots without disturbing sort params (s, d).
const FILTER_PARAM_KEYS = [
  "exc", "inc", "lv", "seats", "done", "up", "minU", "minE",
] as const;

export const DEFAULT_FILTER_STATE: FilterState = {
  excludePrefixes: [],
  includePrefixes: [],
  levels: [],
  hasSeatsAvailable: false,
  completedCourses: [],
  hideUnmetPrereqs: false,
  minUseful: null,
  minEasy: null,
};

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }
  const v = params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return [...new Set(parts)];
}

// Levels accepted from the URL. Mirrors the four buttons in FilterPanel; any
// other integer (e.g. ?lv=500) is dropped so a hand-edited URL can't smuggle
// in a bucket the UI has no way to clear.
const SUPPORTED_LEVELS = new Set([100, 200, 300, 400]);

// Ratings are stored as 0..1. A URL with minU=2 would silently filter out
// every course; clamping keeps the threshold inside the slider's range so the
// UI and the data stay in sync.
function parseRatingOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n >= 1) return 1;
  return n;
}

function parseBool(raw: string | undefined): boolean {
  return raw === "1";
}

export function decodeFilterState(params: RawParams): FilterState {
  const excludePrefixes = splitList(read(params, "exc")).map((s) => s.toUpperCase());
  const includePrefixes = splitList(read(params, "inc")).map((s) => s.toUpperCase());
  const levels = [
    ...new Set(
      splitList(read(params, "lv"))
        .filter((s) => /^\d+$/.test(s))
        .map((s) => parseInt(s, 10))
        .filter((n) => SUPPORTED_LEVELS.has(n)),
    ),
  ];
  const completedCourses = splitList(read(params, "done")).map((s) => s.toLowerCase());

  return {
    excludePrefixes,
    includePrefixes,
    levels,
    hasSeatsAvailable: parseBool(read(params, "seats")),
    completedCourses,
    hideUnmetPrereqs: parseBool(read(params, "up")),
    minUseful: parseRatingOrNull(read(params, "minU")),
    minEasy: parseRatingOrNull(read(params, "minE")),
  };
}

/**
 * Overwrite the filter slots of an existing querystring with `state`,
 * leaving non-filter keys (currently the sort params `s` and `d`) untouched.
 * Use this when committing filter changes from the UI so a user's chosen
 * sort order survives a filter toggle.
 */
export function mergeFilterStateIntoParams(
  current: URLSearchParams,
  state: FilterState,
): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const key of FILTER_PARAM_KEYS) out.delete(key);
  for (const [k, v] of encodeFilterState(state)) out.set(k, v);
  return out;
}

export function encodeFilterState(state: FilterState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.excludePrefixes.length > 0) {
    out.set("exc", state.excludePrefixes.join(","));
  }
  if (state.includePrefixes.length > 0) {
    out.set("inc", state.includePrefixes.join(","));
  }
  if (state.levels.length > 0) {
    out.set("lv", state.levels.join(","));
  }
  if (state.hasSeatsAvailable) out.set("seats", "1");
  if (state.completedCourses.length > 0) {
    out.set("done", state.completedCourses.join(","));
  }
  if (state.hideUnmetPrereqs) out.set("up", "1");
  if (state.minUseful != null) out.set("minU", String(state.minUseful));
  if (state.minEasy != null) out.set("minE", String(state.minEasy));
  return out;
}
