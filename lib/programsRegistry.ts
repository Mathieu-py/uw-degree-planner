import programsData from "../data/programs.json";
import { memoizedReferencedCodes } from "./programReferenced";
import type { Program, ProgramOption, Specialization } from "./programs";
import { validatePrograms } from "./programs";

// The validated slug→Program registry — SERVER-SIDE ONLY. It imports the ~2 MB
// data/programs.json, so it must never enter a client bundle: the browser
// uses @/lib/programsMeta (small index) + on-demand /api/programs/<slug> detail.
// Only server components, the detail route handler, server actions, the scraper,
// and tests import this. Parses at import to fail fast on malformed data.
// Null prototype: slugs arrive from URLs (/api/programs/<slug>) and stored
// plans, so lookups for keys like "constructor" must miss instead of returning
// Object.prototype members (truthy, then unserializable → 500).
export const PROGRAMS: Record<string, Program> = Object.assign(
  Object.create(null),
  validatePrograms(programsData),
);

/**
 * The `(id, name, kind, faculty)` digest of every program, sorted by name.
 * Passed to the client as props so the picker works without shipping trees.
 */
export function getProgramOptions(): ProgramOption[] {
  return Object.entries(PROGRAMS)
    .map(([id, p]) => ({
      id,
      name: p.name,
      kind: p.kind,
      ...(p.faculty ? { faculty: p.faculty } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A flat `id → name` lookup, passed to the client for labelling plan cards. */
export function programNameMap(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PROGRAMS).map(([id, p]) => [id, p.name]),
  );
}

export function getSpecialization(
  programId: string,
  specializationSlug: string,
): Specialization | null {
  const program = PROGRAMS[programId];
  return (
    program?.specializations?.find((s) => s.slug === specializationSlug) ?? null
  );
}

/**
 * Every course code a program (+ optional specialization) references, over the
 * full server registry. The browser computes the same sets from loaded detail
 * (see `@/lib/programDetail`) via the same shared implementation; this is the
 * server/test path (variant placement, unit tests).
 * Empty for an unknown/absent id — pinned, since the registry is immutable.
 */
export const programReferencedCodes = memoizedReferencedCodes(
  (id) => PROGRAMS[id],
  { cacheMisses: true },
);
