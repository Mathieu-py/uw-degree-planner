/**
 * Throwaway diagnostic script for issue #28.
 *
 * Fetches the full Kuali response for 8 representative UW programs spanning
 * faculties, writes each raw response to scripts/diagnostic/raw/<slug>.json,
 * runs each through the current parser, and writes per-program parser output
 * to scripts/diagnostic/parsed/<slug>.json.
 *
 * Run:
 *   pnpm tsx scripts/diagnostic/dump-kuali.ts
 *
 * Output feeds scripts/diagnostic/findings.md (hand-written).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildConflictCounts,
  buildProgramSlug,
  parseRequiredCoursesTermByTerm,
} from "../scrape-programs.parser";

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

type ProgramDetail = ProgramListEntry & Record<string, unknown>;

interface Pick {
  label: string;
  candidateSlugs: string[];
  fallback?: (m: ProgramListEntry) => boolean;
}

const PICKS: Pick[] = [
  {
    label: "Engineering control (SYDE)",
    candidateSlugs: ["systems-design-engineering"],
  },
  {
    label: "Math",
    candidateSlugs: [
      "mathematical-physics",
      "h-mathematical-physics",
      "pure-mathematics",
      "h-pure-mathematics",
    ],
  },
  {
    label: "Computer Science (BCS variant)",
    candidateSlugs: ["h-computer-science-bcs", "computer-science-bcs"],
  },
  {
    label: "Arts with sub-plan choice (History)",
    candidateSlugs: ["h-history", "history"],
  },
  {
    label: "Science (Biology)",
    candidateSlugs: ["h-biology", "biology"],
  },
  {
    label: "AHS (Kinesiology)",
    candidateSlugs: ["h-kinesiology", "kinesiology"],
  },
  {
    label: "Environment (first honours non-engineering)",
    candidateSlugs: [],
    fallback: (m) => {
      const code = m.code.toLowerCase();
      if (!code.startsWith("h-")) return false;
      if (code.includes("engineering")) return false;
      const field = (m.fieldOfStudy?.name ?? "").toLowerCase();
      return field.includes("environment") || code.includes("environment");
    },
  },
  {
    label: "Joint Honours (first JH-)",
    candidateSlugs: [],
    fallback: (m) => m.code.toUpperCase().startsWith("JH-"),
  },
];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function main() {
  const diagDir = path.resolve(process.cwd(), "scripts", "diagnostic");
  const rawDir = path.join(diagDir, "raw");
  const parsedDir = path.join(diagDir, "parsed");
  await mkdir(rawDir, { recursive: true });
  await mkdir(parsedDir, { recursive: true });

  process.stdout.write("Fetching program list... ");
  const list = await fetchJson<ProgramListEntry[]>(
    `${API_BASE}/programs/${CATALOG_ID}?q=`,
  );
  const majors = list.filter(
    (p) => p.undergraduateCredentialType?.name === "Major",
  );
  console.log(`${list.length} entries (${majors.length} Majors)`);

  const conflictCounts = buildConflictCounts(majors.map((p) => p.code));
  const slugToMajor = new Map<string, ProgramListEntry>();
  for (const m of majors) {
    slugToMajor.set(buildProgramSlug(m.code, conflictCounts), m);
  }

  const sortedMajors = [...majors].sort((a, b) => a.code.localeCompare(b.code));
  const resolved: { pick: Pick; major: ProgramListEntry; slug: string }[] = [];
  const seen = new Set<string>();

  for (const pick of PICKS) {
    let found: ProgramListEntry | undefined;
    for (const s of pick.candidateSlugs) {
      const m = slugToMajor.get(s);
      if (m && !seen.has(m.pid)) {
        found = m;
        break;
      }
    }
    if (!found && pick.fallback) {
      found = sortedMajors.find((m) => !seen.has(m.pid) && pick.fallback!(m));
    }
    if (!found) {
      console.warn(`  WARN: no match for "${pick.label}" — skipping`);
      continue;
    }
    seen.add(found.pid);
    resolved.push({
      pick,
      major: found,
      slug: buildProgramSlug(found.code, conflictCounts),
    });
  }

  console.log(`\nResolved ${resolved.length}/${PICKS.length} picks:`);
  for (const { pick, major, slug } of resolved) {
    console.log(`  ${pick.label}: ${slug} (${major.code}) pid=${major.pid}`);
  }
  console.log("");

  const summary: {
    slug: string;
    pid: string;
    rttbBytes: number;
    nonEmptyTerms: number;
    warnings: number;
  }[] = [];

  for (let i = 0; i < resolved.length; i++) {
    const { major, slug } = resolved[i];
    const idx = `[${i + 1}/${resolved.length}]`;
    process.stdout.write(`${idx} ${slug}... `);
    try {
      const detail = await fetchJson<ProgramDetail>(
        `${API_BASE}/program/${CATALOG_ID}/${encodeURIComponent(major.pid)}`,
      );
      await writeFile(
        path.join(rawDir, `${slug}.json`),
        JSON.stringify(detail, null, 2),
        "utf-8",
      );

      const rttb =
        typeof detail.requiredCoursesTermByTerm === "string"
          ? detail.requiredCoursesTermByTerm
          : "";
      const { terms, warnings } = parseRequiredCoursesTermByTerm(rttb, slug);

      const fieldsPresent = {
        requiredCoursesTermByTerm: lengthOrFalse(rttb),
        courseRequirementsNoUnits: lengthOrFalse(detail.courseRequirementsNoUnits),
        requirements: lengthOrFalse(detail.requirements),
        courseListsNew: lengthOrFalse(detail.courseListsNew),
        specializationsList: lengthOrFalse(detail.specializationsList),
        graduationRequirements: lengthOrFalse(detail.graduationRequirements),
        additionalConstraints: lengthOrFalse(detail.additionalConstraints),
      };

      const calendarUrl = `${VIEW_BASE}/${encodeURIComponent(major.pid)}`;
      const nonEmptyTerms = Object.values(terms).filter(
        (arr) => arr.length > 0,
      ).length;

      const parsedOut = {
        slug,
        name: major.title,
        code: major.code,
        pid: major.pid,
        calendarUrl,
        fieldsPresent,
        parserOutput: { terms, warnings },
      };
      await writeFile(
        path.join(parsedDir, `${slug}.json`),
        JSON.stringify(parsedOut, null, 2),
        "utf-8",
      );

      summary.push({
        slug,
        pid: major.pid,
        rttbBytes: Buffer.byteLength(rttb, "utf-8"),
        nonEmptyTerms,
        warnings: warnings.length,
      });
      console.log(
        `ok (rttb=${Buffer.byteLength(rttb, "utf-8")}B, terms=${nonEmptyTerms}, warnings=${warnings.length})`,
      );
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}`);
    }
    if (i < resolved.length - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }

  console.log("\nSummary:");
  console.log("slug                                pid                       rttb-bytes  terms  warnings");
  for (const s of summary) {
    console.log(
      `${s.slug.padEnd(36)}  ${s.pid.padEnd(24)}  ${String(s.rttbBytes).padStart(10)}  ${String(s.nonEmptyTerms).padStart(5)}  ${String(s.warnings).padStart(8)}`,
    );
  }
}

function lengthOrFalse(v: unknown): number | false {
  return typeof v === "string" && v.trim().length > 0 ? v.length : false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
