import { type TermId, termInfo } from "@/lib/terms";

/**
 * Single source of truth for the query contract the course detail page reads to
 * know where the user arrived from and where "Add to plan" should land.
 *
 * - `catalog`  — from a catalog row; the detail page opens the generic TermPicker.
 * - `plan`     — from a placed timeline chip; the course is already in the plan,
 *                so the detail page hides its Add button. Carries `planId`.
 * - `picker`   — from the in-planner slot picker; the course is NOT yet placed.
 *                Carries `planId` + `term` so the detail page can offer a
 *                one-click "Add to {term}" instead of re-asking for the term.
 *
 * Build with {@link buildCourseOrigin}, read with {@link parseCourseOrigin}.
 */
export type CourseOriginFrom = "catalog" | "plan" | "picker";

export interface CourseOrigin {
  from?: CourseOriginFrom;
  /** The plan the user came from (server plans only; local plans have no id). */
  planId?: string;
  /** Target term for a one-click add (picker entry). Calendar TermId, e.g. 1261. */
  term?: TermId;
}

const FROM_VALUES: readonly CourseOriginFrom[] = ["catalog", "plan", "picker"];

/**
 * Serialize an origin to a query string ("" when empty). Omits absent parts, so
 * `{ from: "catalog" }` → "?from=catalog" and `{}` → "". Kept symmetric with
 * {@link parseCourseOrigin}.
 */
export function buildCourseOrigin(o: CourseOrigin): string {
  const params = new URLSearchParams();
  if (o.from) params.set("from", o.from);
  if (o.planId) params.set("planId", o.planId);
  if (o.term != null) params.set("term", String(o.term));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Parse the detail page's raw `searchParams` into the typed contract. Unknown
 * `from` values and terms that don't match the calendar scheme are dropped to
 * `undefined` rather than trusted — a stray `?term=abc` can't leak through.
 */
export function parseCourseOrigin(raw: {
  from?: string;
  planId?: string;
  term?: string;
}): CourseOrigin {
  const from = FROM_VALUES.includes(raw.from as CourseOriginFrom)
    ? (raw.from as CourseOriginFrom)
    : undefined;
  let term: TermId | undefined;
  if (raw.term) {
    const n = Number(raw.term);
    if (Number.isFinite(n) && termInfo(n) !== null) term = n;
  }
  return { from, planId: raw.planId || undefined, term };
}
