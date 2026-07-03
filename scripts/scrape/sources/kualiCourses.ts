/**
 * Authoritative per-course data Kuali supplies that UWFlow lacks: unit weights,
 * cross-listings (course equivalence), and structured requisite rule trees.
 * Joined onto the snapshot by code in `build-catalog.ts`. HTML→AST parsing lives
 * in `./kualiRequisites`; this module only fetches and assembles the record.
 */

import type { PrereqNode } from "../../../lib/prereqs/parse";
import { withRetry } from "../util/fetch";
import { discoverCatalogId } from "./kualiCatalog";
import {
  parseKualiAntireqCodes,
  parseKualiRequisite,
  spliceCoreqReferences,
} from "./kualiRequisites";

const KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";
const CONCURRENCY = 12;

/** Authoritative per-course data Kuali supplies that UWFlow lacks. */
export interface KualiCourseData {
  /** Unit weight: 0.5 standard, 0.25 lab, 1.0+ full-year. Undefined if unknown. */
  units?: number;
  /**
   * Cross-listed equivalents (Kuali `crossListedCourses`) — authoritative source
   * for course equivalence (GitHub #21). Lowercased; omitted when none.
   */
  crossListed?: string[];
  /**
   * Antireq codes from Kuali's structured `antirequisites` tree — authoritative
   * replacement for the regex over UWFlow's prose. Lowercased. An EMPTY array is
   * meaningful (Kuali says zero antireqs → suppresses the prose fallback); the
   * field is omitted only when Kuali has antireq text we couldn't parse a code
   * from (prose fallback stays in effect).
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

  const antireqHtml = detail.antirequisites;
  const antireqCodes = parseKualiAntireqCodes(antireqHtml).filter(
    (a) => a !== code,
  );
  // Kuali is authoritative, so an EMPTY antirequisites field is an explicit []
  // (zero antireqs) — omitting it reads as "no coverage" and the runtime falls
  // back to UWFlow's stale prose. Exception: antireq text we parsed no code from
  // (unrecognized phrasing) → omit, so the prose fallback still applies.
  if (antireqCodes.length > 0 || !antireqHtml || antireqHtml.trim() === "") {
    record.antireqCodes = antireqCodes;
  }

  // Splice the parsed coreq tree into any "or (see corequisite)" pointer the
  // prereq carries, so the corequisite path is actually evaluated (ACTSC 231).
  const coreqAst = parseKualiRequisite(detail.corequisites);
  const { node: prereqAst, consumed } = spliceCoreqReferences(
    parseKualiRequisite(detail.prerequisites),
    coreqAst,
  );
  if (prereqAst) record.prereqAst = prereqAst;
  // A consumed coreq tree was reference material for the prereq pointer, not a
  // standalone requirement — keeping it would enforce it unconditionally (false
  // "Coreq missing" for students on the other prereq branch).
  if (coreqAst && !consumed) record.coreqAst = coreqAst;

  return Object.keys(record).length > 0 ? record : null;
}

/**
 * Kuali data keyed by lowercased code: one list call for codes+pids, then a
 * bounded-concurrency detail call per course (failed details skipped — they load
 * from UWFlow without enrichment).
 */
export async function fetchKualiData(): Promise<
  Record<string, KualiCourseData>
> {
  // A timed-out attempt throws TimeoutError, which withRetry retries like any
  // other failure — no separate abort handling needed.
  const getJson = <T>(url: string): Promise<T> =>
    withRetry(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    });

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
      } catch (err) {
        // The course still loads without Kuali enrichment (audit counts it).
        console.warn(
          `Kuali enrichment skipped for ${code}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker),
  );
  return data;
}
