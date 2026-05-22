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
 *   https://uwaterloocm.kuali.co/api/v1/catalog/programs/{catalogId}
 *   https://uwaterloocm.kuali.co/api/v1/catalog/program/{catalogId}/{pid}
 *
 * The catalogId is the immutable id of the currently-published calendar
 * (the SPA loads it from /api/v1/catalog/public/catalogs/{id} on boot).
 * If the catalog is republished, update CATALOG_ID below — find the new
 * id by visiting the calendar in a browser with devtools open and reading
 * the request to /api/v1/catalog/programs/{...}.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Program } from "../lib/programs";
import {
  buildConflictCounts,
  buildProgramSlug,
  parseRequiredCoursesTermByTerm,
} from "./scrape-programs.parser";

const CATALOG_ID = "67e557ed6ed2fe2bd3a38956";
const API_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";
const VIEW_BASE =
  "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs";
const FETCH_DELAY_MS = 200;

interface ProgramListEntry {
  pid: string;
  code: string;
  title: string;
  undergraduateCredentialType?: { name?: string };
  fieldOfStudy?: { name?: string };
}

interface ProgramDetail extends ProgramListEntry {
  requiredCoursesTermByTerm?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

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
  let withTerms = 0;
  let withoutTerms = 0;
  const skippedNoTerms: string[] = [];

  for (let i = 0; i < majors.length; i++) {
    const p = majors[i];
    const slug = buildProgramSlug(p.code, conflictCounts);
    const idx = `[${i + 1}/${majors.length}]`;
    process.stdout.write(`${idx} ${slug}... `);
    try {
      const detail = await fetchJson<ProgramDetail>(
        `${API_BASE}/program/${CATALOG_ID}/${p.pid}`,
      );
      const { terms, warnings } = parseRequiredCoursesTermByTerm(
        detail.requiredCoursesTermByTerm ?? "",
        slug,
      );
      allWarnings.push(...warnings);
      const hasAny = Object.values(terms).some((arr) => arr.length > 0);
      if (hasAny) withTerms++;
      else {
        withoutTerms++;
        skippedNoTerms.push(slug);
      }

      out[slug] = {
        name: p.title,
        asOf: today,
        source: `${VIEW_BASE}/${p.pid}`,
        terms,
      };
      console.log(hasAny ? "ok" : "(no term data)");
    } catch (e) {
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
    `\nWrote ${path.relative(process.cwd(), outPath)}: ${Object.keys(sorted).length} programs (${withTerms} with term data, ${withoutTerms} empty)`,
  );

  if (skippedNoTerms.length > 0) {
    console.error(
      `\n${skippedNoTerms.length} programs have no term-by-term data ` +
        `(emitted with empty term arrays; these are typically Math/Arts ` +
        `programs that use a flexible flat course-requirement structure):`,
    );
    for (const s of skippedNoTerms) console.error(`  ${s}`);
  }

  if (allWarnings.length > 0) {
    console.error(`\n${allWarnings.length} OR-group warnings:`);
    for (const w of allWarnings) console.error(`  ${w}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
