/**
 * Kuali catalog discovery and the subject-code map. The catalog id is
 * auto-discovered at runtime (the active "Undergraduate Studies Academic
 * Calendar"); everything downstream — the program scraper and the per-course
 * fetch in `./kualiCourses` — hangs off the id this module resolves.
 */
import type { CatalogProvenance } from "../../../lib/programs";
import { fetchJson } from "../util/fetch";

const FALLBACK_CATALOG_ID = "67e557ed6ed2fe2bd3a38956";
export const API_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";

interface CatalogEntry {
  id?: string;
  _id?: string;
  startDate?: string;
  endDate?: string;
  title?: string;
  status?: string;
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

/**
 * Strip a trailing subject-code parenthetical from a Kuali subject description:
 * "Applied Mathematics (AMATH)" → "Applied Mathematics". Returns the trimmed
 * description unchanged when there's no parenthetical.
 */
export function stripSubjectCodeSuffix(description: string): string {
  return description.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

interface CourseListEntry {
  subjectCode?: { name?: string; description?: string };
}

/**
 * Build a `subject description (lowercased) → subject code` map from the Kuali
 * course list — the same endpoint the catalog uses for unit weights. Each course
 * carries `subjectCode: {name:"AMATH", description:"Applied Mathematics (AMATH)"}`;
 * stripping the `(CODE)` suffix yields a description that matches a program's
 * `fieldOfStudy.name`, letting us stamp each program with its official code.
 */
export async function fetchSubjectCodeMap(
  catalogId: string,
): Promise<Map<string, string>> {
  const courses = await fetchJson<CourseListEntry[]>(
    `${API_BASE}/courses/${catalogId}`,
  );
  const byDescription = new Map<string, string>();
  for (const c of courses) {
    const name = c.subjectCode?.name;
    const description = c.subjectCode?.description;
    if (!name || !description) continue;
    const key = stripSubjectCodeSuffix(description).toLowerCase();
    if (key) byDescription.set(key, name);
  }
  return byDescription;
}
