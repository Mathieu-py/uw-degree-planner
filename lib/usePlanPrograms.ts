"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { programDetail } from "./programDetail";
import type { ProgramIdentity } from "./programs";
import { programIdentities } from "./programsMeta";

// Retry cadence while a program's detail hasn't loaded (network blip, transient
// 5xx). Doubles up to the cap so an idle tab doesn't hammer the API.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

const EMPTY_CODES: ReadonlySet<string> = new Set();

/**
 * Load detail for the given plan's program ids; true once all are cached.
 * `loaded` is derived from the cache every render — never latched — and the
 * component subscribes to the detail store, so a fill from any surface
 * (another component's fetch, an SSR prime) re-renders this one with correct
 * reads. Failed fetches cache nothing: consumers keep their loading state
 * while the effect retries with backoff.
 */
export function useProgramsDetail(
  programIds: readonly (string | null | undefined)[] | null | undefined,
): boolean {
  const ids = useMemo(
    () => (programIds ?? []).filter((s): s is string => !!s),
    [programIds],
  );
  const key = ids.join(",");
  useSyncExternalStore(
    programDetail.subscribe,
    programDetail.version,
    programDetail.version,
  );
  const loaded = programDetail.areLoaded(ids);
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
  return loaded;
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
  const loaded = useProgramsDetail(plan?.programIds);
  const programs = useMemo(
    () => programIdentities(plan?.programIds, plan?.specializationIds),
    [plan?.programIds, plan?.specializationIds],
  );
  const programReferenced = useMemo(() => {
    // `loaded` gates the recompute: until detail arrives the union is empty;
    // the store subscription re-renders and flips it true once detail lands.
    if (!loaded) return EMPTY_CODES;
    return programDetail.planReferencedCodes(
      plan?.programIds,
      plan?.specializationIds,
    );
  }, [plan?.programIds, plan?.specializationIds, loaded]);
  return { programs, programReferenced };
}
