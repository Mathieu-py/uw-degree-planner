import { memoizedReferencedCodes } from "./programReferenced";
import type { Program } from "./programs";

// Client-side per-program detail cache. Full detail (rule trees, electives, spec
// rules) is fetched on demand from /api/programs/<slug> so the ~2 MB registry
// never ships to the browser — only the 1–2 programs on the active plan
// are loaded. Server code keeps reading the monolith registry directly.
const cache = new Map<string, Program>();
// Authoritative 404s — the slug isn't in this build's registry. Distinct from
// transient failures (network/5xx), which stay unresolved and are retried.
const missing = new Set<string>();
const inflight = new Map<string, Promise<Program | null>>();

// Subscription surface (for useSyncExternalStore): version bumps whenever a
// program lands, so React surfaces re-render off fresh cache reads instead of
// latching their own loading flags.
let version = 0;
const listeners = new Set<() => void>();
function bump(): void {
  version++;
  for (const listener of listeners) listener();
}
export function subscribeProgramsDetail(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function programsDetailVersion(): number {
  return version;
}

async function loadProgramDetail(slug: string): Promise<Program | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  const existing = inflight.get(slug);
  if (existing) return existing;
  const req = fetch(`/api/programs/${encodeURIComponent(slug)}`)
    .then(async (r) => {
      if (r.ok) {
        const detail = (await r.json()) as Program;
        // A prime that landed mid-flight wins: it's this build's data by
        // construction, while the fetch may be a stale pre-deploy response.
        if (!cache.has(slug)) {
          cache.set(slug, detail);
          bump();
        }
        return detail;
      }
      // 404 is an answer — the id isn't in this build's registry — so record
      // it and settle: surfaces render "unknown program" instead of loading.
      if (r.status === 404 && !missing.has(slug)) {
        missing.add(slug);
        bump();
      }
      return null;
    })
    // Transient failures cache nothing (and don't bump): `areProgramsLoaded`
    // stays false, so callers keep their loading state — never a false
    // "unknown program" or blocked verdict. The hook retries with backoff.
    .catch(() => null)
    .finally(() => inflight.delete(slug));
  inflight.set(slug, req);
  return req;
}

export async function loadProgramsDetail(
  slugs: readonly (string | null | undefined)[],
): Promise<void> {
  const wanted = [...new Set(slugs.filter((s): s is string => !!s))];
  await Promise.all(wanted.map(loadProgramDetail));
}

// Prime the cache directly so reads resolve synchronously without a fetch:
// SSR seeding (SharedPlanView ships the plan's programs as props) and component
// tests (JSDOM has no /api route) both use this.
export function primeProgramsDetail(programs: Record<string, Program>): void {
  let changed = false;
  for (const slug of Object.keys(programs)) {
    missing.delete(slug);
    if (cache.get(slug) === programs[slug]) continue;
    cache.set(slug, programs[slug]);
    // The memoized referenced set was derived from the replaced object.
    loadedReferencedCodes.invalidate(slug);
    changed = true;
  }
  // Deferred: priming happens in render bodies, and notifying subscribers
  // mid-render would schedule updates on other components.
  if (changed) queueMicrotask(bump);
}

/** Sync read of an already-loaded program, or null if not yet fetched. */
export function getLoadedProgram(
  slug: string | null | undefined,
): Program | null {
  return (slug ? cache.get(slug) : undefined) ?? null;
}

/**
 * Every id resolved: cached, or authoritatively absent (404 → "unknown
 * program" UIs). Transient failures stay unresolved, so loading states
 * persist and the hook keeps retrying.
 */
export function areProgramsLoaded(
  slugs: readonly (string | null | undefined)[],
): boolean {
  return slugs.every((s) => !s || cache.has(s) || missing.has(s));
}

/**
 * Referenced codes for a loaded program (+ selected spec), from the client
 * cache. Misses aren't memoized: until detail is fetched they mean "not loaded
 * yet" and must recompute once it lands. Shares its implementation with the
 * server registry's `programReferencedCodes` so the two paths can't drift.
 */
const loadedReferencedCodes = memoizedReferencedCodes((id) => cache.get(id), {
  cacheMisses: false,
});

/** Union of referenced codes across a plan's programs, each with its own spec. */
export function loadedPlanReferencedCodes(
  programIds: readonly string[] | null | undefined,
  specializationIds?: Record<string, string>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const id of programIds ?? []) {
    for (const c of loadedReferencedCodes(id, specializationIds?.[id]))
      out.add(c);
  }
  return out;
}
