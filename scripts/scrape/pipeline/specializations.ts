/**
 * Specialization handling: dedup spec references across parents, build each
 * `Specialization` from its Kuali detail (slug-collision resolution included),
 * fetch every unique spec once (Phase B), and attach specs back to parents.
 */
import type { Program, Specialization } from "../../../lib/programs";
import {
  buildSpecializationSlug,
  parseElectives,
  parseProgramRequirements,
} from "../programs-parser";
import { API_BASE } from "../sources/kualiCatalog";
import { fetchJson } from "../util/fetch";
import {
  fetchEachPaced,
  type PhaseBResult,
  type ProgramDetail,
  type SpecializationRef,
  VIEW_BASE,
} from "./shared";

/**
 * Dedup the spec ids referenced across all parents (153 unique vs 283 refs), so
 * Phase B fetches each id once and attaches it to every referencing parent.
 */
export function collectUniqueSpecIds(
  refsByParent: ReadonlyMap<string, readonly SpecializationRef[]>,
): string[] {
  const ids = new Set<string>();
  for (const refs of refsByParent.values()) {
    for (const r of refs) ids.add(r.id);
  }
  return [...ids];
}

/**
 * Pick a spec slug, avoiding collisions with prior specs. Idempotent: if `id`
 * already owns `baseSlug`, returns it unchanged; otherwise appends `-2`, `-3`, …
 * and warns. Does NOT mutate `takenSlugs` — callers `.set` after a successful
 * build, so a parse failure doesn't reserve a slot.
 */
export function resolveSpecSlug(
  baseSlug: string,
  id: string,
  takenSlugs: ReadonlyMap<string, string>,
): { slug: string; warning?: string } {
  const prior = takenSlugs.get(baseSlug);
  if (prior === undefined || prior === id) return { slug: baseSlug };
  let n = 2;
  while (takenSlugs.has(`${baseSlug}-${n}`)) n++;
  const dupSlug = `${baseSlug}-${n}`;
  return {
    slug: dupSlug,
    warning: `[spec:${baseSlug}] slug collision with id ${prior}; using ${dupSlug} for id ${id}`,
  };
}

/**
 * Build a `Specialization` from a Kuali detail: resolve slug collisions (mutates
 * `takenSlugs`), parse rules + electives, and warn if Kuali ever ships an
 * engineering-shaped spec.
 */
export function buildSpecialization(
  detail: ProgramDetail,
  id: string,
  takenSlugs: Map<string, string>,
  viewBase: string,
): { spec: Specialization; warnings: string[] } {
  const code = detail.code ?? "";
  const name = detail.title ?? code;
  const baseSlug = buildSpecializationSlug(code);
  const { slug, warning: collisionWarning } = resolveSpecSlug(
    baseSlug,
    id,
    takenSlugs,
  );

  const warnings: string[] = [];
  if (collisionWarning) warnings.push(collisionWarning);

  // Like the runPhaseA call site: parseProgramRequirements uses module-level
  // state reset per call, so it must stay synchronous and non-interleaved.
  // buildSpecialization is invoked once per spec, sequentially.
  const result = parseProgramRequirements(detail, `spec:${slug}`);
  if (result.kind === "engineering") {
    // Specs are expected to be flexible-shaped; surface an engineering-shaped
    // one loudly rather than silently truncating to the flexible path.
    warnings.push(
      `[spec:${slug}] unexpected kind:"engineering" — using empty rule tree as a placeholder`,
    );
  }
  const rules = result.kind === "flexible" ? result.rules : undefined;
  if (result.kind === "flexible") warnings.push(...result.warnings);
  // result.unverified / result.freeElectives are intentionally NOT surfaced:
  // Specialization has no `unverifiedRequirements` field and the audit gates only
  // on the PROGRAM's (buildProgramAudit). Spec-level owed requirements are
  // unsupported by design — see issue #123.

  const electivesResult = parseElectives(detail, `spec:${slug}`);
  warnings.push(...electivesResult.warnings);

  const spec: Specialization = {
    slug,
    name,
    kualiId: id,
    source: `${viewBase}/view/${encodeURIComponent(id)}`,
    ...(rules !== undefined ? { rules } : {}),
    ...(electivesResult.electives.length > 0
      ? { electives: electivesResult.electives }
      : {}),
  };
  takenSlugs.set(slug, id);

  return { spec, warnings };
}

/**
 * Attach each parent's specs in `specializationsList` order, mutating
 * `programs[parentSlug].specializations`. Missing specs and absent parents are
 * skipped. The same `Specialization` instance is shared by reference across
 * every referencing parent, so consumers must treat spec objects as immutable.
 */
export function attachSpecsToParents(
  programs: Record<string, Program>,
  refsByParent: ReadonlyMap<string, readonly SpecializationRef[]>,
  specsById: ReadonlyMap<string, Specialization>,
): { parentsAttached: number; specsAttached: number } {
  let parentsAttached = 0;
  let specsAttached = 0;
  for (const [parentSlug, refs] of refsByParent.entries()) {
    const program = programs[parentSlug];
    if (!program) continue;
    const specs = refs
      .map((r) => specsById.get(r.id))
      .filter((s): s is Specialization => s !== undefined);
    if (specs.length === 0) continue;
    program.specializations = specs;
    parentsAttached++;
    specsAttached += specs.length;
  }
  return { parentsAttached, specsAttached };
}

/**
 * Phase B — fetch every unique specialization id at most once. The endpoint
 * differs from parents: `/program/byId/{cid}/{id}` where `{id}` is the
 * 24-char hex from the parent's `specializationsList` anchor.
 */
export async function runPhaseB(
  catalogId: string,
  specRefsByParent: ReadonlyMap<string, readonly SpecializationRef[]>,
): Promise<PhaseBResult> {
  const specById = new Map<string, Specialization>();
  const specSlugTaken = new Map<string, string>();
  const failedSpecs: string[] = [];
  const warnings: string[] = [];
  const uniqueSpecIds = collectUniqueSpecIds(specRefsByParent);

  console.log(`\nFetching ${uniqueSpecIds.length} unique specializations...`);

  await fetchEachPaced({
    items: uniqueSpecIds,
    label: (id) => `spec ${id}`,
    fetcher: (id) =>
      fetchJson<ProgramDetail>(
        `${API_BASE}/program/byId/${catalogId}/${encodeURIComponent(id)}`,
      ),
    onResult: (detail, id) => {
      const { spec, warnings: w } = buildSpecialization(
        detail,
        id,
        specSlugTaken,
        VIEW_BASE,
      );
      warnings.push(...w);
      specById.set(id, spec);
      return `ok (${spec.slug})`;
    },
    onError: (id) => {
      failedSpecs.push(id);
    },
  });

  return { specById, failedSpecs, warnings, uniqueSpecIds };
}
