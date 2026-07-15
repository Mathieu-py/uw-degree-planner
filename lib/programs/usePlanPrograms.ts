"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { programDetail } from "./detail";
import type { Program, ProgramIdentity } from "./index";
import { programIdentities } from "./meta";

// Retry cadence while a program's detail hasn't loaded (network blip, transient
// 5xx). Doubles up to the cap so an idle tab doesn't hammer the API.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

const EMPTY_CODES: ReadonlySet<string> = new Set();

/**
 * `programs` is null until every id settles (an ungated read is a type error);
 * a null map VALUE is an authoritative 404.
 */
export type ProgramsDetail =
  | { loaded: false; programs: null }
  | { loaded: true; programs: ReadonlyMap<string, Program | null> };

const LOADING: ProgramsDetail = { loaded: false, programs: null };

/**
 * Load detail for the given program ids and return it resolved. Subscribed to
 * the store, never latched: a fill from any surface re-renders this one. While
 * loading, the stable `LOADING` constant; once loaded, a fresh map per store
 * bump so dependent memos re-derive when a prime replaces a program. Failed
 * fetches cache nothing; the effect retries with backoff.
 */
export function useProgramsDetail(
  programIds: readonly (string | null | undefined)[] | null | undefined,
): ProgramsDetail {
  const ids = useMemo(
    () => (programIds ?? []).filter((s): s is string => !!s),
    [programIds],
  );
  const key = ids.join(",");
  const version = useSyncExternalStore(
    programDetail.subscribe,
    programDetail.version,
    programDetail.version,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures `ids`; `version` keys the cache snapshot the memo reads.
  const detail = useMemo<ProgramsDetail>(() => {
    if (!programDetail.areLoaded(ids)) return LOADING;
    const programs = new Map<string, Program | null>();
    for (const id of ids) programs.set(id, programDetail.get(id));
    return { loaded: true, programs };
  }, [key, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures `ids`.
  useEffect(() => {
    if (programDetail.areLoaded(ids)) return;
    let alive = true;
    let delay = RETRY_BASE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      void programDetail.load(ids).then(() => {
        if (!alive || programDetail.areLoaded(ids)) return;
        timer = setTimeout(attempt, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      });
    };
    attempt();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key]);
  return detail;
}

// The plan's program identities (from the small index) + the union of referenced
// codes (from on-demand detail) — the `{ programs, programReferenced }` shape the
// eligibility gates need, sourced without the 2 MB registry. Mirrors the old
// server-side `programContext`.
export function usePlanProgramContext(
  plan:
    | { programIds?: string[]; specializationIds?: Record<string, string> }
    | null
    | undefined,
): { programs: ProgramIdentity[]; programReferenced: ReadonlySet<string> } {
  const detail = useProgramsDetail(plan?.programIds);
  const programs = useMemo(
    () => programIdentities(plan?.programIds, plan?.specializationIds),
    [plan?.programIds, plan?.specializationIds],
  );
  const programReferenced = useMemo(() => {
    // Empty until detail lands (refs only suppress); the `detail` dep is fresh
    // per store bump, so a prime replacing a program re-derives the union.
    if (!detail.loaded) return EMPTY_CODES;
    return programDetail.planReferencedCodes(
      plan?.programIds,
      plan?.specializationIds,
    );
  }, [plan?.programIds, plan?.specializationIds, detail]);
  return { programs, programReferenced };
}
