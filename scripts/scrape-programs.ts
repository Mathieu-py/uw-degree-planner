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

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Program } from "../lib/programs";
import {
  buildConflictCounts,
  buildProgramSlug,
  parseElectives,
  parseProgramRequirements,
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

interface ProgramDetail extends ProgramListEntry {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  graduationRequirements?: string;
  courseListsNew?: string;
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
 * Auto-discovers the catalog id by fetching the public catalogs list,
 * filtering to undergraduate calendars that are currently active
 * (startDate <= today < endDate), and picking the most recent. Falls back
 * to FALLBACK_CATALOG_ID on any failure.
 *
 * Tolerates both bare-array and `{catalogs: [...]}` payload shapes, and
 * accepts `id` or `_id` field names.
 */
export async function discoverCatalogId(
  now: Date = new Date(),
): Promise<string> {
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
    return id;
  } catch (err) {
    console.warn(
      `Catalog auto-discovery failed (${(err as Error).message}); ` +
        `using hardcoded ${FALLBACK_CATALOG_ID}`,
    );
    return FALLBACK_CATALOG_ID;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const CATALOG_ID = await discoverCatalogId();

  process.stdout.write("Fetching program list... ");
  const list = await fetchJson<ProgramListEntry[]>(
    `${API_BASE}/programs/${CATALOG_ID}?q=`,
  );
  const majors = list.filter(
    (p) => p.undergraduateCredentialType?.name === "Major",
  );
  console.log(`${list.length} entries (${majors.length} Majors)`);

  const conflictCounts = buildConflictCounts(majors.map((p) => p.code));

  const out: Record<string, Program> = {};
  const allWarnings: string[] = [];
  let withData = 0;
  let withoutData = 0;
  let failedCount = 0;
  const skippedNoData: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < majors.length; i++) {
    const p = majors[i];
    const slug = buildProgramSlug(p.code, conflictCounts);
    const idx = `[${i + 1}/${majors.length}]`;
    process.stdout.write(`${idx} ${slug}... `);
    try {
      const detail = await fetchJson<ProgramDetail>(
        `${API_BASE}/program/${CATALOG_ID}/${encodeURIComponent(p.pid)}`,
      );
      const result = parseProgramRequirements(detail, slug);
      if (result.kind === "empty") {
        withoutData++;
        skippedNoData.push(slug);
        console.log("skipped (no data)");
      } else {
        allWarnings.push(...result.warnings);
        const electivesResult = parseElectives(detail, slug);
        allWarnings.push(...electivesResult.warnings);
        const electivesField =
          electivesResult.electives.length > 0
            ? { electives: electivesResult.electives }
            : {};
        const base = {
          name: p.title,
          asOf: today,
          source: `${VIEW_BASE}/${encodeURIComponent(p.pid)}`,
        };
        if (result.kind === "engineering") {
          const hasCG = Object.values(result.choiceGroupsByTerm).some(
            (arr) => arr.length > 0,
          );
          out[slug] = {
            kind: "engineering",
            ...base,
            terms: result.terms,
            ...(hasCG ? { choiceGroupsByTerm: result.choiceGroupsByTerm } : {}),
            ...electivesField,
          };
        } else {
          out[slug] = {
            kind: "flexible",
            ...base,
            requiredCourses: result.requiredCourses,
            ...(result.choiceGroups.length > 0
              ? { choiceGroups: result.choiceGroups }
              : {}),
            ...electivesField,
          };
        }
        withData++;
        console.log(`ok (${result.kind})`);
      }
    } catch (e) {
      failedCount++;
      failed.push(slug);
      console.log(`ERROR: ${(e as Error).message}`);
    }
    if (i < majors.length - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }

  const sorted: Record<string, Program> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];

  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "programs.json");
  await writeFile(outPath, JSON.stringify(sorted, null, 2), "utf-8");
  console.log(
    `\nWrote ${path.relative(process.cwd(), outPath)}: ${withData} programs (${withoutData} skipped for having no parseable data, ${failedCount} failed) of ${majors.length} majors`,
  );

  if (skippedNoData.length > 0) {
    console.error(
      `\n${skippedNoData.length} programs skipped (none of requiredCoursesTermByTerm / requirements / courseRequirementsNoUnits had content):`,
    );
    for (const s of skippedNoData) console.error(`  ${s}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} programs failed during fetch/parse:`);
    for (const s of failed) console.error(`  ${s}`);
  }

  if (allWarnings.length > 0) {
    console.error(`\n${allWarnings.length} unrecognized-rule warnings:`);
    for (const w of allWarnings) console.error(`  ${w}`);
  }
}

// Only run main() when invoked directly via `tsx scripts/scrape-programs.ts`,
// not when imported by tests. process.argv[1] is the entrypoint script path;
// import.meta.url is the file:// URL of the current module.
const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
