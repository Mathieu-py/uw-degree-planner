/**
 * FilterState ↔ URL codec. Empty querystring decodes to DEFAULT_FILTER_STATE
 * (full catalog); encoding omits any field at its default so shared URLs
 * stay short and "no params" round-trips cleanly. Keys are abbreviated (exc,
 * lv, done, minU, rat, …) so a typical filtered view fits on one line.
 *
 * Invariant: prefix arrays are uppercase and course codes are lowercase at
 * every state boundary (decode normalises, UI controls add normalised). The
 * encoder trusts this and does not re-normalise.
 */

import type { FilterState } from "./types";

export const FILTER_STORAGE_KEY = "uwfinder.filterUrl";

export const DEFAULT_FILTER_STATE: FilterState = {
  excludePrefixes: [],
  includePrefixes: [],
  levels: [],
  hasSeatsAvailable: false,
  completedCourses: [],
  hideUnmetPrereqs: false,
  ratingAndThreshold: null,
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

function parseFloatOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n)),
    ),
  ];
  const completedCourses = splitList(read(params, "done")).map((s) => s.toLowerCase());

  const ratRaw = read(params, "rat");
  let ratingAndThreshold: FilterState["ratingAndThreshold"] = null;
  if (ratRaw) {
    const [easy, useful] = ratRaw.split(",").map(Number);
    if (Number.isFinite(easy) && Number.isFinite(useful)) {
      ratingAndThreshold = { easy, useful };
    }
  }

  return {
    excludePrefixes,
    includePrefixes,
    levels,
    hasSeatsAvailable: parseBool(read(params, "seats")),
    completedCourses,
    hideUnmetPrereqs: parseBool(read(params, "up")),
    ratingAndThreshold,
    minUseful: parseFloatOrNull(read(params, "minU")),
    minEasy: parseFloatOrNull(read(params, "minE")),
  };
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
  if (state.ratingAndThreshold) {
    out.set("rat", `${state.ratingAndThreshold.easy},${state.ratingAndThreshold.useful}`);
  }
  if (state.minUseful != null) out.set("minU", String(state.minUseful));
  if (state.minEasy != null) out.set("minE", String(state.minEasy));
  return out;
}
