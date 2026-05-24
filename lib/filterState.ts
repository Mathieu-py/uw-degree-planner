/**
 * URL codec for the two halves of catalog state: PureFilters (filter chips)
 * and StudentPassage (program seed). Empty querystring decodes to defaults;
 * encoding omits any field at its default so shared URLs stay short and "no
 * params" round-trips cleanly. Keys are abbreviated (exc, lv, minU, …) so a
 * typical filtered view fits on one line.
 *
 * `completedCourses` belongs to StudentPassage but is profile data (persisted
 * in localStorage by CourseBrowser) and intentionally not URL-encoded — a
 * shared link reflects the sender's view, not their profile. The decoder for
 * StudentPassage therefore always returns an empty list; the encoder ignores
 * it. localStorage is the source of truth.
 *
 * Each merger deletes only its own key set, so a commit to one half can
 * never lose a concurrent commit to the other half (or sort params s, d, p).
 *
 * Invariant: prefix arrays are uppercase at every state boundary (decode
 * normalises, UI controls add normalised). The encoder trusts this.
 */

import {
  isKnownProgram,
  isKnownSpecialization,
  isTermLetter,
} from "./programs";
import type { PureFilters, StudentPassage } from "./types";

export const BROWSE_QS_STORAGE_KEY = "uwfinder.browseQs";

const PURE_FILTER_PARAM_KEYS = [
  "exc",
  "lv",
  "seats",
  "up",
  "minU",
  "minE",
] as const;
const PASSAGE_PARAM_KEYS = ["prog", "term", "spec", "cgs", "sys"] as const;

export const DEFAULT_PURE_FILTERS: PureFilters = {
  excludePrefixes: [],
  levels: [],
  hasSeatsAvailable: false,
  hideUnmetPrereqs: false,
  minUseful: null,
  minEasy: null,
};

export const DEFAULT_STUDENT_PASSAGE: StudentPassage = {
  programId: null,
  currentTerm: null,
  completedCourses: [],
  specializationId: null,
  choiceGroupSelections: {},
  systemOfStudy: null,
};

type RawParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

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
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

export function decodePureFilters(params: RawParams): PureFilters {
  const excludePrefixes = [
    ...new Set(splitList(read(params, "exc")).map((s) => s.toUpperCase())),
  ];
  const levels = [
    ...new Set(
      splitList(read(params, "lv"))
        .filter((s) => /^\d+$/.test(s))
        .map((s) => parseInt(s, 10))
        .filter((n) => SUPPORTED_LEVELS.has(n)),
    ),
  ];
  return {
    excludePrefixes,
    levels,
    hasSeatsAvailable: parseBool(read(params, "seats")),
    hideUnmetPrereqs: parseBool(read(params, "up")),
    minUseful: parseRatingOrNull(read(params, "minU")),
    minEasy: parseRatingOrNull(read(params, "minE")),
  };
}

export function decodeStudentPassage(params: RawParams): StudentPassage {
  const rawProg = read(params, "prog")?.toLowerCase();
  const programId = rawProg && isKnownProgram(rawProg) ? rawProg : null;

  const rawTerm = read(params, "term")?.toUpperCase();
  const currentTerm = isTermLetter(rawTerm) ? rawTerm : null;

  // Spec is only meaningful in the context of a valid program; an orphan
  // ?spec=foo without a matching ?prog= decodes to null. Validation against
  // the parent's specializations[] catches stale/typo slugs.
  const rawSpec = read(params, "spec")?.toLowerCase();
  const specializationId =
    rawSpec && programId && isKnownSpecialization(programId, rawSpec)
      ? rawSpec
      : null;

  const choiceGroupSelections = parseChoiceGroupSelections(read(params, "cgs"));

  const rawSys = read(params, "sys");
  const systemOfStudy: "coop" | "regular" | null =
    rawSys === "coop" || rawSys === "regular" ? rawSys : null;

  return {
    programId,
    currentTerm,
    completedCourses: [],
    specializationId,
    choiceGroupSelections,
    systemOfStudy,
  };
}

// Defensive JSON parse mirroring loadCompletedCourses: a hand-crafted ?cgs=
// with the wrong shape silently degrades to {} rather than throwing. Course
// codes are lowercased to match the catalog's canonical form.
function parseChoiceGroupSelections(
  raw: string | undefined,
): Record<string, string[]> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    const codes = value
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toLowerCase());
    if (codes.length > 0) out[key] = codes;
  }
  return out;
}

export function encodePureFilters(state: PureFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (state.excludePrefixes.length > 0) {
    out.set("exc", state.excludePrefixes.join(","));
  }
  if (state.levels.length > 0) {
    out.set("lv", state.levels.join(","));
  }
  if (state.hasSeatsAvailable) out.set("seats", "1");
  if (state.hideUnmetPrereqs) out.set("up", "1");
  if (state.minUseful != null) out.set("minU", String(state.minUseful));
  if (state.minEasy != null) out.set("minE", String(state.minEasy));
  return out;
}

export function encodeStudentPassage(state: StudentPassage): URLSearchParams {
  const out = new URLSearchParams();
  if (state.programId) out.set("prog", state.programId);
  if (state.currentTerm) out.set("term", state.currentTerm);
  if (state.specializationId) out.set("spec", state.specializationId);
  if (Object.keys(state.choiceGroupSelections).length > 0) {
    out.set("cgs", JSON.stringify(state.choiceGroupSelections));
  }
  if (state.systemOfStudy) out.set("sys", state.systemOfStudy);
  return out;
}

/**
 * Overwrite the pure-filter slots of an existing querystring, leaving every
 * other key (passage params, sort params s/d, page p) untouched.
 */
export function mergePureFiltersIntoParams(
  current: URLSearchParams,
  state: PureFilters,
): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const key of PURE_FILTER_PARAM_KEYS) out.delete(key);
  for (const [k, v] of encodePureFilters(state)) out.set(k, v);
  return out;
}

/**
 * Overwrite the passage slots of an existing querystring, leaving every other
 * key (pure-filter params, sort params s/d, page p) untouched.
 */
export function mergeStudentPassageIntoParams(
  current: URLSearchParams,
  state: StudentPassage,
): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const key of PASSAGE_PARAM_KEYS) out.delete(key);
  for (const [k, v] of encodeStudentPassage(state)) out.set(k, v);
  return out;
}
