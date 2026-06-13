/**
 * Course seating from UW Open Data — the registrar's authoritative live
 * enrolment, replacing UWFlow's second-hand `sections`. Joined by code in
 * `build-catalog.ts`. No working bulk endpoint, so fetched per offered course:
 * `/Courses/{term}` lists offerings (with primary component), then
 * `/ClassSchedules/{term}/{subject}/{catalogNumber}` per course.
 */

import type { CourseSection } from "../../lib/courses/types";

const BASE = "https://openapi.data.uwaterloo.ca/v3";
// Open Data rate-limits by burst, not total: sequential calls are fine, but a
// dozen concurrent ones trip 429s. Stay low and back off on 429.
const CONCURRENCY = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OpenDataCourse {
  courseId: string;
  subjectCode: string;
  catalogNumber: string;
  /** The course's enrolment component (e.g. "LEC", "LAB", "SEM"). */
  courseComponentCode: string | null;
}

interface OpenDataSchedule {
  classNumber: number;
  courseComponent: string | null;
  maxEnrollmentCapacity: number | null;
  enrolledStudents: number | null;
}

/** Lowercased, space-free course code from an Open Data course/schedule pair. */
function codeOf(subjectCode: string, catalogNumber: string): string {
  return `${subjectCode}${catalogNumber}`.replace(/\s+/g, "").toLowerCase();
}

/**
 * Map a course's Open Data schedules to snapshot {@link CourseSection}s. Keeps
 * only the primary enrolment component so tutorial/test slots don't inflate the
 * seat count; falls back to all sections if none match (missing
 * `courseComponentCode`). Schedules with no numeric capacity are dropped.
 */
export function toSections(
  schedules: OpenDataSchedule[],
  primaryComponent: string | null,
): CourseSection[] {
  const primary = primaryComponent
    ? schedules.filter((s) => s.courseComponent === primaryComponent)
    : [];
  const chosen = primary.length > 0 ? primary : schedules;
  const out: CourseSection[] = [];
  for (const s of chosen) {
    if (s.maxEnrollmentCapacity == null) continue; // no capacity data
    const cap = Number(s.maxEnrollmentCapacity);
    const total = Number(s.enrolledStudents);
    if (!Number.isFinite(cap)) continue;
    out.push({
      id: Number(s.classNumber),
      enrollment_total: Number.isFinite(total) ? total : 0,
      enrollment_capacity: cap,
    });
  }
  return out;
}

function apiKey(): string {
  const key = process.env.UW_OPENDATA_KEY;
  if (!key) {
    throw new Error(
      "UW_OPENDATA_KEY is not set (needed for seating). Add it to .env.local.",
    );
  }
  return key;
}

/**
 * Seating for a term, keyed by lowercased code. Courses with no schedule (not
 * offered, or fetch failed) are absent → caller defaults them to no sections.
 */
export async function fetchSeating(
  termId: number,
): Promise<Record<string, CourseSection[]>> {
  const headers = { "x-api-key": apiKey(), accept: "application/json" };

  // GET with retry: 429 backs off and retries; allowed 404 → null; other errors
  // retry then throw.
  const getJson = async <T>(
    url: string,
    allow404 = false,
  ): Promise<T | null> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (allow404 && res.status === 404) return null;
        if (res.status === 429) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        if (attempt === 7) throw err;
        await sleep(300 * (attempt + 1));
      }
    }
    throw new Error("unreachable");
  };

  // Fetch only courses with a schedule this term (bulk endpoint returns their
  // courseIds) — ~2.2k of ~7.9k offered, skipping thousands of pointless 404s.
  const courses =
    (await getJson<OpenDataCourse[]>(`${BASE}/Courses/${termId}`)) ?? [];
  const byCourseId = new Map(courses.map((c) => [c.courseId, c]));
  const scheduledIds =
    (await getJson<string[]>(`${BASE}/ClassSchedules/${termId}`)) ?? [];
  const targets = scheduledIds
    .map((id) => byCourseId.get(id))
    .filter((c): c is OpenDataCourse => c !== undefined);

  const seating: Record<string, CourseSection[]> = {};
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= targets.length) return;
      const c = targets[i];
      try {
        const schedules = await getJson<OpenDataSchedule[]>(
          `${BASE}/ClassSchedules/${termId}/${encodeURIComponent(
            c.subjectCode,
          )}/${encodeURIComponent(c.catalogNumber)}`,
          true,
        );
        if (!schedules || schedules.length === 0) continue;
        const sections = toSections(schedules, c.courseComponentCode);
        if (sections.length > 0) {
          seating[codeOf(c.subjectCode, c.catalogNumber)] = sections;
        }
      } catch (err) {
        // Allowed 404s return null above, so anything caught here is a
        // persistent non-404 failure (retries exhausted). The course still
        // loads without seating (shown as no sections), but log it so a
        // systemic outage doesn't pass silently.
        failures++;
        console.error(
          `Seating fetch failed for ${codeOf(c.subjectCode, c.catalogNumber)}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker),
  );
  if (failures > 0) {
    console.warn(`${failures} of ${targets.length} seating fetches failed`);
  }
  return seating;
}
