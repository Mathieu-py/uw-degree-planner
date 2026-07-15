import type { Program } from "./index";
import { memoizedReferencedCodes } from "./referenced";

// Client-side per-program detail store. Full detail (rule trees, electives,
// spec rules) is fetched on demand from /api/programs/<slug> so the ~2 MB
// registry never ships to the browser — only the 1–2 programs on the active
// plan are loaded. Server code keeps reading the monolith registry directly.
export interface ProgramDetailStore {
  /** Fetch (deduped) every id not yet resolved; resolves when all settle. */
  load(slugs: readonly (string | null | undefined)[]): Promise<void>;
  /**
   * Insert programs directly so reads resolve synchronously without a fetch:
   * SSR seeding (SharedPlanView ships the plan's programs as props) and
   * component tests (JSDOM has no /api route) both use this.
   */
  prime(programs: Record<string, Program>): void;
  /** Sync read of an already-loaded program, or null if not yet fetched. */
  get(slug: string | null | undefined): Program | null;
  /**
   * Every id resolved: cached, or authoritatively absent (404 → "unknown
   * program" UIs). Transient failures stay unresolved, so loading states
   * persist and the hook keeps retrying.
   */
  areLoaded(slugs: readonly (string | null | undefined)[]): boolean;
  /** Subscription surface for useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  /** Bumps whenever a program lands — the snapshot for useSyncExternalStore. */
  version(): number;
  /** Union of referenced codes across a plan's programs, each with its own spec. */
  planReferencedCodes(
    programIds: readonly string[] | null | undefined,
    specializationIds?: Record<string, string>,
  ): ReadonlySet<string>;
}

/**
 * Build a store around a fetcher (injectable for tests). The app shares the
 * {@link programDetail} singleton below.
 */
export function createProgramDetailStore(
  fetchDetail: (slug: string) => Promise<Response> = (slug) =>
    fetch(`/api/programs/${encodeURIComponent(slug)}`),
): ProgramDetailStore {
  const cache = new Map<string, Program>();
  // Authoritative 404s — the slug isn't in this build's registry. Distinct from
  // transient failures (network/5xx), which stay unresolved and are retried.
  const missing = new Set<string>();
  const inflight = new Map<string, Promise<Program | null>>();

  let version = 0;
  const listeners = new Set<() => void>();
  function bump(): void {
    version++;
    for (const listener of listeners) listener();
  }

  // Misses aren't memoized: until detail is fetched they mean "not loaded yet"
  // and must recompute once it lands. Shares its implementation with the server
  // registry's `programReferencedCodes` so the two paths can't drift.
  const referencedCodes = memoizedReferencedCodes((id) => cache.get(id), {
    cacheMisses: false,
  });

  function loadOne(slug: string): Promise<Program | null> {
    const cached = cache.get(slug);
    if (cached) return Promise.resolve(cached);
    // A recorded 404 is settled — don't refetch it on every load() call.
    if (missing.has(slug)) return Promise.resolve(null);
    const existing = inflight.get(slug);
    if (existing) return existing;
    const req = fetchDetail(slug)
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
        // Unless a prime landed mid-flight: primed data outranks a stale 404.
        if (r.status === 404 && !missing.has(slug) && !cache.has(slug)) {
          missing.add(slug);
          bump();
        }
        return null;
      })
      // Transient failures cache nothing (and don't bump): `areLoaded` stays
      // false, so callers keep their loading state — never a false
      // "unknown program" or blocked verdict. The hook retries with backoff.
      .catch(() => null)
      .finally(() => inflight.delete(slug));
    inflight.set(slug, req);
    return req;
  }

  return {
    async load(slugs) {
      const wanted = [...new Set(slugs.filter((s): s is string => !!s))];
      await Promise.all(wanted.map(loadOne));
    },
    prime(programs) {
      let changed = false;
      for (const slug of Object.keys(programs)) {
        missing.delete(slug);
        if (cache.get(slug) === programs[slug]) continue;
        cache.set(slug, programs[slug]);
        // The memoized referenced set was derived from the replaced object.
        referencedCodes.invalidate(slug);
        changed = true;
      }
      // Deferred: priming happens in render bodies, and notifying subscribers
      // mid-render would schedule updates on other components.
      if (changed) queueMicrotask(bump);
    },
    get(slug) {
      return (slug ? cache.get(slug) : undefined) ?? null;
    },
    areLoaded(slugs) {
      return slugs.every((s) => !s || cache.has(s) || missing.has(s));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version() {
      return version;
    },
    planReferencedCodes(programIds, specializationIds) {
      const out = new Set<string>();
      for (const id of programIds ?? []) {
        for (const c of referencedCodes(id, specializationIds?.[id]))
          out.add(c);
      }
      return out;
    },
  };
}

/** The app-wide store — every surface shares one cache and one subscription. */
export const programDetail = createProgramDetailStore();
