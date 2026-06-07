/**
 * Scrapes the UWaterloo undergraduate calendar (Kuali backend) and writes
 * data/programs.json with one entry per undergraduate Major.
 *
 * Run manually:
 *   pnpm scrape-programs
 *
 * Re-run when the calendar updates (typically once per academic year).
 *
 * Data source: Kuali Curriculum Management API
 *   https://uwaterloocm.kuali.co/api/v1/catalog/public/catalogs/   (list)
 *   https://uwaterloocm.kuali.co/api/v1/catalog/programs/{catalogId}
 *   https://uwaterloocm.kuali.co/api/v1/catalog/program/{catalogId}/{pid}
 *
 * The catalog id is auto-discovered at runtime by fetching the catalogs list
 * and picking the currently-active "Undergraduate Studies Academic Calendar"
 * entry. If discovery fails (network, schema drift), we fall back to the
 * hardcoded constant below so the script still produces output.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { countNoun } from "../lib/format";
import {
  type CatalogProvenance,
  type DegreeRequirements,
  type Program,
  type Specialization,
  validatePrograms,
} from "../lib/programs";
import { applyRuleOverrides } from "./scrape-programs.overrides";
import {
  buildConflictCounts,
  buildProgramSlug,
  buildSpecializationSlug,
  type DegreeParseResult,
  parseDegreeRequirements,
  parseElectives,
  parseProgramRequirements,
  parseSpecializationsList,
  parseUnitPlan,
  reconcileUnitsAndElectives,
} from "./scrape-programs.parser";

const FALLBACK_CATALOG_ID = "67e557ed6ed2fe2bd3a38956";
const API_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";
const VIEW_BASE =
  "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs";
const FETCH_DELAY_MS = 200;

interface CatalogEntry {
  id?: string;
  _id?: string;
  startDate?: string;
  endDate?: string;
  title?: string;
  status?: string;
}

interface ProgramListEntry {
  pid: string;
  code: string;
  title: string;
  undergraduateCredentialType?: { name?: string };
  fieldOfStudy?: { name?: string };
}

export interface ProgramDetail extends ProgramListEntry {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  graduationRequirements?: string;
  courseListsNew?: string;
  specializationsList?: string;
}

export interface SpecializationRef {
  id: string;
  name: string;
}

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Iterate `items` sequentially with a polite delay. Each iteration prints
 * `[i/N] <label>... ` plus the caller's result or `ERROR: <message>`. State
 * recording is the caller's job via `onResult` / `onError`. Shared by Phase A
 * and Phase B.
 */
async function fetchEachPaced<T, R>(opts: {
  items: readonly T[];
  label: (item: T) => string;
  fetcher: (item: T) => Promise<R>;
  onResult: (result: R, item: T) => string;
  onError: (item: T, message: string) => void;
}): Promise<void> {
  const { items, label, fetcher, onResult, onError } = opts;
  const total = items.length;
  for (let i = 0; i < total; i++) {
    const item = items[i];
    process.stdout.write(`[${i + 1}/${total}] ${label(item)}... `);
    try {
      const r = await fetcher(item);
      console.log(onResult(r, item));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(item, msg);
      console.log(`ERROR: ${msg}`);
    }
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }
}

function reportList(label: string, items: readonly string[]): void {
  if (items.length === 0) return;
  console.error(`\n${items.length} ${label}:`);
  for (const s of items) console.error(`  ${s}`);
}

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
 * The discovered catalog's id + provenance (title, academic-year span), stamped
 * onto every program so the data names which Undergraduate Calendar it's from.
 */
export type CatalogInfo = CatalogProvenance;

/** Academic-year span from a catalog's start/end dates, e.g. "2025-2026". */
function catalogYear(entry: CatalogEntry): string | undefined {
  const start = entry.startDate?.slice(0, 4);
  const end = entry.endDate?.slice(0, 4);
  if (start && end) return `${start}-${end}`;
  return start ?? undefined;
}

/**
 * Auto-discover the catalog: fetch the public catalogs list, keep currently
 * active undergraduate calendars (startDate <= today < endDate), pick the most
 * recent, return id + provenance. Falls back to FALLBACK_CATALOG_ID on failure.
 * Tolerates bare-array and `{catalogs:[...]}` shapes, and `id`/`_id`.
 */
export async function discoverCatalog(
  now: Date = new Date(),
): Promise<CatalogInfo> {
  try {
    const payload = await fetchJson<unknown>(`${API_BASE}/public/catalogs/`);
    const raw = Array.isArray(payload)
      ? payload
      : ((payload as { catalogs?: unknown[] } | null)?.catalogs ?? []);
    const list = raw as CatalogEntry[];

    const today = now.toISOString().slice(0, 10);
    const candidates = list
      .filter((c) => (c.id ?? c._id) != null)
      .filter((c) => /undergraduate/i.test(c.title ?? ""))
      .filter((c) => {
        const start = c.startDate;
        const end = c.endDate;
        if (!start) return false;
        return start <= today && (!end || today < end);
      })
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

    const picked = candidates[0];
    const id = picked?.id ?? picked?._id;
    if (!id) throw new Error("no active undergraduate catalog found");

    if (id !== FALLBACK_CATALOG_ID) {
      console.warn(
        `Using auto-discovered catalogId ${id} (${picked?.title}); ` +
          `hardcoded fallback was ${FALLBACK_CATALOG_ID}`,
      );
    }
    return {
      id,
      ...(picked?.title ? { title: picked.title } : {}),
      ...(picked ? { year: catalogYear(picked) } : {}),
    };
  } catch (err) {
    console.warn(
      `Catalog auto-discovery failed (${(err as Error).message}); ` +
        `using hardcoded ${FALLBACK_CATALOG_ID}`,
    );
    return { id: FALLBACK_CATALOG_ID };
  }
}

/**
 * Back-compat wrapper returning only the catalog id. Retained for the
 * discovery tests and any caller that doesn't need provenance.
 */
export async function discoverCatalogId(
  now: Date = new Date(),
): Promise<string> {
  return (await discoverCatalog(now)).id;
}

interface PhaseAResult {
  programs: Record<string, Program>;
  specRefsByParent: Map<string, SpecializationRef[]>;
  /** Each program's referenced "Bachelor of X degree-level requirements" pid. */
  degreeRefBySlug: Map<string, { pid: string; name: string }>;
  withData: number;
  skippedNoData: string[];
  failed: string[];
  warnings: string[];
}

/**
 * Phase A — fetch every major, parse its rules + electives, collect its
 * specialization references. Defers spec fetches to Phase B so we can dedup
 * across parents (153 unique ids vs 283 refs in the current calendar).
 */
async function runPhaseA(
  catalogId: string,
  majors: readonly ProgramListEntry[],
  conflictCounts: ReadonlyMap<string, number>,
  today: string,
  catalog: CatalogProvenance,
): Promise<PhaseAResult> {
  const programs: Record<string, Program> = {};
  const specRefsByParent = new Map<string, SpecializationRef[]>();
  const degreeRefBySlug = new Map<string, { pid: string; name: string }>();
  const skippedNoData: string[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];
  let withData = 0;

  await fetchEachPaced({
    items: majors,
    label: (p) => buildProgramSlug(p.code, conflictCounts),
    fetcher: (p) =>
      fetchJson<ProgramDetail>(
        `${API_BASE}/program/${catalogId}/${encodeURIComponent(p.pid)}`,
      ),
    onResult: (detail, p) => {
      const slug = buildProgramSlug(p.code, conflictCounts);
      const result = parseProgramRequirements(detail, slug);
      warnings.push(...result.warnings);
      if (result.kind === "empty") {
        skippedNoData.push(slug);
        return "skipped (no data)";
      }
      const electivesResult = parseElectives(detail, slug);
      warnings.push(...electivesResult.warnings);

      // Unit accounting from grad-req prose, reconciled against the elective
      // lists so a requirement isn't counted twice.
      const planResult = parseUnitPlan(
        detail.graduationRequirements ?? "",
        slug,
      );
      warnings.push(...planResult.warnings);
      const reconciled = reconcileUnitsAndElectives(
        planResult.unitPlan,
        electivesResult.electives,
      );
      if (planResult.degreeRef) degreeRefBySlug.set(slug, planResult.degreeRef);

      const electivesField =
        reconciled.electives.length > 0
          ? { electives: reconciled.electives }
          : {};
      const unitPlanField = reconciled.unitPlan
        ? { unitPlan: reconciled.unitPlan }
        : {};
      const informationalField =
        planResult.informational.length > 0
          ? { informational: planResult.informational }
          : {};
      // Verbatim owed requirements we couldn't structure (unscoped subject
      // pools, unrecognized "Complete …" prose). Surfaced to the student so the
      // audit can't read complete while real requirements were dropped.
      const unverified = [...new Set(result.unverified)];
      const unverifiedField =
        unverified.length > 0 ? { unverifiedRequirements: unverified } : {};
      const base = {
        name: p.title,
        asOf: today,
        source: `${VIEW_BASE}/${encodeURIComponent(p.pid)}`,
        catalog,
      };
      programs[slug] =
        result.kind === "engineering"
          ? {
              kind: "engineering",
              ...base,
              terms: result.terms,
              ...electivesField,
              ...unitPlanField,
              ...informationalField,
              ...unverifiedField,
            }
          : {
              kind: "flexible",
              ...base,
              rules: applyRuleOverrides(slug, result.rules),
              ...electivesField,
              ...unitPlanField,
              ...informationalField,
              ...unverifiedField,
            };
      const specRefs = parseSpecializationsList(detail.specializationsList);
      if (specRefs.length > 0) specRefsByParent.set(slug, specRefs);
      withData++;
      const specSuffix =
        specRefs.length > 0
          ? `, ${countNoun(specRefs.length, "spec ref")}`
          : "";
      return `ok (${result.kind}${specSuffix})`;
    },
    onError: (p) => {
      failed.push(buildProgramSlug(p.code, conflictCounts));
    },
  });

  return {
    programs,
    specRefsByParent,
    degreeRefBySlug,
    withData,
    skippedNoData,
    failed,
    warnings,
  };
}

/**
 * Fetch each unique degree-level page once and parse it. Programs reference
 * these by pid; the same "Bachelor of Science degree-level requirements" is
 * shared by every Science major, so we dedup before fetching.
 */
async function runPhaseDegrees(
  catalogId: string,
  degreeRefBySlug: ReadonlyMap<string, { pid: string; name: string }>,
): Promise<Map<string, DegreeParseResult>> {
  const byPid = new Map<string, DegreeParseResult>();
  const pids = [...new Set([...degreeRefBySlug.values()].map((r) => r.pid))];
  if (pids.length === 0) return byPid;
  console.log(`\nFetching ${pids.length} degree-level requirement pages...`);
  await fetchEachPaced({
    items: pids,
    label: (pid) => `degree ${pid}`,
    fetcher: (pid) =>
      fetchJson<Record<string, string>>(
        `${API_BASE}/program/${catalogId}/${encodeURIComponent(pid)}`,
      ),
    onResult: (detail, pid) => {
      const parsed = parseDegreeRequirements(
        detail,
        pid,
        `${VIEW_BASE}/${encodeURIComponent(pid)}`,
      );
      byPid.set(pid, parsed);
      const b = parsed.degree.constraints?.length ?? 0;
      return `ok (${b} ${countNoun(b, "breadth constraint")})`;
    },
    onError: () => {},
  });
  return byPid;
}

/**
 * Attach the shared degree-level requirements to each referencing program:
 * set `degreeRequirements` and propagate the degree-page total into a program
 * that doesn't state its own.
 */
function attachDegreeRequirements(
  programs: Record<string, Program>,
  degreeRefBySlug: ReadonlyMap<string, { pid: string; name: string }>,
  degreesByPid: ReadonlyMap<string, DegreeParseResult>,
): number {
  let attached = 0;
  for (const [slug, ref] of degreeRefBySlug) {
    const program = programs[slug];
    const parsed = degreesByPid.get(ref.pid);
    if (!program || !parsed) continue;
    const degree: DegreeRequirements = parsed.degree;
    program.degreeRequirements = degree;

    // Propagate the degree-page total to a program that doesn't state its own
    // (e.g. Math majors whose total lives only on the degree page). Pick the
    // total matching the program's degree type — three-year (`3g-`), four-year
    // (`4g-`), and honours can each differ (15.0 vs 20.0 vs 20.0).
    const degreeTotal = /^3g-/.test(slug)
      ? (parsed.generalTotal ?? parsed.honoursTotal)
      : /^4g-/.test(slug)
        ? (parsed.fourYearTotal ?? parsed.generalTotal ?? parsed.honoursTotal)
        : parsed.honoursTotal;
    // The degree-level total is a faculty minimum; adopt it as the program's
    // total only when the program doesn't already state its own.
    if (degreeTotal != null && program.unitPlan?.totalUnits == null) {
      program.unitPlan = {
        ...(program.unitPlan ?? {}),
        totalUnits: degreeTotal,
      };
    }
    attached++;
  }
  return attached;
}

interface PhaseBResult {
  specById: Map<string, Specialization>;
  failedSpecs: string[];
  warnings: string[];
  uniqueSpecIds: readonly string[];
}

/**
 * Phase B — fetch every unique specialization id at most once. The endpoint
 * differs from parents: `/program/byId/{cid}/{id}` where `{id}` is the
 * 24-char hex from the parent's `specializationsList` anchor.
 */
async function runPhaseB(
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

/**
 * Sort programs by slug and write the JSON output. Returns the absolute
 * path of the written file.
 */
async function writeOutput(programs: Record<string, Program>): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(programs).sort(([a], [b]) => a.localeCompare(b)),
  );
  // Fail fast on a malformed shape rather than committing a programs.json the
  // app would reject at load (it parses the same schema via validatePrograms).
  validatePrograms(sorted);
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "programs.json");
  const tmpPath = `${outPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(sorted, null, 2), "utf-8");
  await rename(tmpPath, outPath);
  return outPath;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const catalog = await discoverCatalog();
  const catalogId = catalog.id;
  console.log(
    `Catalog ${catalogId}${catalog.year ? ` (${catalog.year})` : ""}${catalog.title ? ` — ${catalog.title}` : ""}`,
  );

  process.stdout.write("Fetching program list... ");
  const list = await fetchJson<ProgramListEntry[]>(
    `${API_BASE}/programs/${catalogId}?q=`,
  );
  const majors = list.filter(
    (p) => p.undergraduateCredentialType?.name === "Major",
  );
  console.log(`${list.length} entries (${majors.length} Majors)`);

  const conflictCounts = buildConflictCounts(majors.map((p) => p.code));

  const phaseA = await runPhaseA(
    catalogId,
    majors,
    conflictCounts,
    today,
    catalog,
  );
  const phaseB = await runPhaseB(catalogId, phaseA.specRefsByParent);
  const { parentsAttached, specsAttached } = attachSpecsToParents(
    phaseA.programs,
    phaseA.specRefsByParent,
    phaseB.specById,
  );

  const degreesByPid = await runPhaseDegrees(catalogId, phaseA.degreeRefBySlug);
  const degreesAttached = attachDegreeRequirements(
    phaseA.programs,
    phaseA.degreeRefBySlug,
    degreesByPid,
  );

  const outPath = await writeOutput(phaseA.programs);

  console.log(
    `Degree-level requirements: ${degreesByPid.size} pages fetched, attached to ${degreesAttached} programs`,
  );

  console.log(
    `\nWrote ${path.relative(process.cwd(), outPath)}: ${phaseA.withData} programs (${phaseA.skippedNoData.length} skipped for having no parseable data, ${phaseA.failed.length} failed) of ${majors.length} majors`,
  );
  console.log(
    `Specializations: ${phaseB.specById.size} unique fetched / ${phaseB.uniqueSpecIds.length} expected (${phaseB.failedSpecs.length} failed), attached ${specsAttached} times across ${parentsAttached} parents`,
  );

  reportList(
    "programs skipped (none of requiredCoursesTermByTerm / requirements / courseRequirementsNoUnits had content)",
    phaseA.skippedNoData,
  );
  reportList("programs failed during fetch/parse", phaseA.failed);
  reportList("specs failed during fetch/parse", phaseB.failedSpecs);
  reportList("unrecognized-rule warnings", [
    ...phaseA.warnings,
    ...phaseB.warnings,
  ]);
}

// Run main() only when invoked directly (not when imported by tests).
const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
