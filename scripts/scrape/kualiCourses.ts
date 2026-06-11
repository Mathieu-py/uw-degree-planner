/**
 * Fetches authoritative per-course data from UW's Kuali Curriculum Management
 * catalog — the data UWFlow doesn't expose: unit weights, cross-listings
 * (course equivalence), and the structured requisite rule trees. The catalog
 * fetch pipeline (`fetch-uwflow.ts`) joins this onto the UWFlow snapshot by code.
 *
 * Kuali HTML → AST parsing lives in `./kualiRequisites`; this module only does
 * the fetching and assembles the per-course record.
 */

import type { PrereqNode } from "../../lib/prereqs/parse";
import { discoverCatalogId } from "../scrape-programs";
import { parseKualiAntireqCodes, parseKualiRequisite } from "./kualiRequisites";

const KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";
const CONCURRENCY = 12;

/** Authoritative per-course data Kuali supplies that UWFlow lacks. */
export interface KualiCourseData {
  /** Unit weight: 0.5 standard, 0.25 lab, 1.0+ full-year. Undefined if unknown. */
  units?: number;
  /**
   * Cross-listed equivalents — the same course offered under another code
   * (Kuali's structured `crossListedCourses`). Authoritative source for course
   * equivalence (GitHub #21). Lowercased codes; omitted when there are none.
   */
  crossListed?: string[];
  /**
   * Antirequisite course codes from Kuali's structured `antirequisites` rule
   * tree — the authoritative replacement for the regex over UWFlow's free-text
   * antireqs. Lowercased; omitted when there are none.
   */
  antireqCodes?: string[];
  /** Prerequisite AST from Kuali's `prerequisites` rule tree; omitted if empty. */
  prereqAst?: PrereqNode;
  /** Corequisite AST from Kuali's `corequisites` rule tree; omitted if empty. */
  coreqAst?: PrereqNode;
}

/** Normalize a Kuali course code ("AMATH 242" → "amath242"); null on empty. */
function normalizeKualiCode(raw: string | undefined | null): string | null {
  const code = raw?.replace(/\s+/g, "").toLowerCase();
  return code && code.length > 0 ? code : null;
}

interface KualiCourseDetail {
  credits?: { value?: string } | null;
  crossListedCourses?: Array<{ __catalogCourseId?: string }> | null;
  antirequisites?: string | null;
  prerequisites?: string | null;
  corequisites?: string | null;
}

/** Assemble one course's record from its Kuali detail (null fields → omitted). */
function buildRecord(
  code: string,
  detail: KualiCourseDetail,
): KualiCourseData | null {
  const record: KualiCourseData = {};
  const value = Number(detail.credits?.value);
  if (Number.isFinite(value)) record.units = value;

  const crossListed = (detail.crossListedCourses ?? [])
    .map((x) => normalizeKualiCode(x.__catalogCourseId))
    .filter((c): c is string => c !== null && c !== code);
  if (crossListed.length > 0) record.crossListed = [...new Set(crossListed)];

  const antireqCodes = parseKualiAntireqCodes(detail.antirequisites).filter(
    (a) => a !== code,
  );
  if (antireqCodes.length > 0) record.antireqCodes = antireqCodes;

  const prereqAst = parseKualiRequisite(detail.prerequisites);
  if (prereqAst) record.prereqAst = prereqAst;
  const coreqAst = parseKualiRequisite(detail.corequisites);
  if (coreqAst) record.coreqAst = coreqAst;

  return Object.keys(record).length > 0 ? record : null;
}

/**
 * Fetch Kuali course data keyed by lowercased course code: one list call for
 * codes+pids, then a bounded-concurrency detail call per course. Courses whose
 * detail fetch fails are skipped (they load from UWFlow without enrichment).
 */
export async function fetchKualiData(): Promise<
  Record<string, KualiCourseData>
> {
  const getJson = async <T>(url: string): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    throw new Error("unreachable");
  };

  const catalogId = await discoverCatalogId();
  const list = await getJson<
    Array<{ __catalogCourseId?: string; pid: string }>
  >(`${KUALI_BASE}/courses/${catalogId}`);

  const data: Record<string, KualiCourseData> = {};
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      const entry = list[i];
      const code = normalizeKualiCode(entry.__catalogCourseId);
      if (!code) continue;
      try {
        const detail = await getJson<KualiCourseDetail>(
          `${KUALI_BASE}/course/${catalogId}/${encodeURIComponent(entry.pid)}`,
        );
        const record = buildRecord(code, detail);
        if (record) data[code] = record;
      } catch {
        // skip; the course loads without Kuali enrichment (audit still counts it)
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker),
  );
  return data;
}
