import { z } from "zod";
import type { PlanSlot, SlotCourse, SlotPosition, Stream } from "../types";
import type { PlanSnapshot, PlanSummary, ServerPlan } from "./types";

// Caps before the unbounded `save_plan_state` RPC (migrations/0002), guarding
// against resource-exhaustion payloads. Well above any real plan.
export const MAX_SLOTS = 50;
export const MAX_COURSES_PER_SLOT = 100;

const SnapshotSizeSchema = z.object({
  slots: z
    .array(
      z.object({
        courses: z.array(z.unknown()).max(MAX_COURSES_PER_SLOT),
      }),
    )
    .max(MAX_SLOTS),
});

/**
 * Returns null if the snapshot is within the size caps, else an error string.
 * Only guards array sizes — per-field validation is left to the DB cast.
 */
export function snapshotSizeError(snapshot: PlanSnapshot): string | null {
  const result = SnapshotSizeSchema.safeParse(snapshot);
  return result.success ? null : "snapshot_too_large";
}

/**
 * Row shape from `select * from plans` (raw snake_case Postgres columns). The
 * selectors below pluck them into camelCase for the app.
 */
export interface PlanRow {
  id: string;
  name: string;
  program_ids: string[] | null;
  /** jsonb column — PostgREST returns it already parsed (do not JSON.parse). */
  specialization_ids: Record<string, string> | null;
  system_of_study: Stream | null;
  start_term_id: number | null;
  program_scrape_version: string | null;
  share_token: string | null;
  updated_at: string;
}

export interface PlanSlotRow {
  id: string;
  plan_id: string;
  term_id: number | null;
  position: SlotPosition;
  is_coop: boolean;
  ordinal: number;
}

export interface PlanCourseRow {
  id: string;
  slot_id: string;
  course_code: string;
  grade: string | null;
  ordinal: number;
}

/**
 * Project a `plans` row into the lightweight UI-list summary. No slot data, so
 * listPlans stays a single table read.
 */
export function planRowToSummary(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    name: row.name,
    programIds: row.program_ids ?? [],
    specializationIds: row.specialization_ids ?? {},
    stream: row.system_of_study,
    startTermId: row.start_term_id,
    shareToken: row.share_token,
    updatedAt: row.updated_at,
  };
}

/**
 * Assemble a `ServerPlan` from the three joined queries. Slot/course order is
 * by `ordinal`, ties broken by `id`. The caller must pass only rows belonging
 * to `plan` — this does no filtering.
 */
export function assembleServerPlan(
  plan: PlanRow,
  slotRows: PlanSlotRow[],
  courseRows: PlanCourseRow[],
): ServerPlan {
  const coursesBySlot = new Map<string, SlotCourse[]>();
  const sortedCourses = [...courseRows].sort(
    (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
  );
  for (const c of sortedCourses) {
    const bucket = coursesBySlot.get(c.slot_id);
    // Explicit null check: only DB nulls drop the field. An empty string is a
    // valid grade and must round-trip — the save RPC's `nullif(..., '')` is the
    // only place that normalizes empties to null; the read path stays faithful.
    const entry: SlotCourse =
      c.grade !== null
        ? { code: c.course_code, grade: c.grade }
        : { code: c.course_code };
    if (bucket) bucket.push(entry);
    else coursesBySlot.set(c.slot_id, [entry]);
  }

  const sortedSlots = [...slotRows].sort(
    (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
  );
  const slots: PlanSlot[] = sortedSlots.map((s) => ({
    id: s.id,
    termId: s.term_id,
    position: s.position,
    isCoop: s.is_coop,
    courses: coursesBySlot.get(s.id) ?? [],
  }));

  return {
    id: plan.id,
    name: plan.name,
    programIds: plan.program_ids ?? [],
    specializationIds: plan.specialization_ids ?? {},
    stream: plan.system_of_study,
    startTermId: plan.start_term_id,
    programScrapeVersion: plan.program_scrape_version,
    slots,
    updatedAt: plan.updated_at,
  };
}

/**
 * Map the `get_shared_plan(token)` RPC's JSONB payload into a `ServerPlan`. The
 * RPC pre-orders slots by `ordinal` and courses by `(ordinal, course_code)`
 * (migrations/0001_initial.sql:155-176), so no re-sort. Returns null on null
 * input (RPC's null-token path) so callers can pattern-match.
 */
export function mapSharedPlanJson(input: unknown): ServerPlan | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") {
    throw new Error("mapSharedPlanJson: expected object");
  }
  const j = input as Record<string, unknown>;

  const rawSlots = Array.isArray(j.slots) ? (j.slots as unknown[]) : [];
  const slots: PlanSlot[] = rawSlots.map((raw) => {
    const s = raw as Record<string, unknown>;
    const rawCourses = Array.isArray(s.courses) ? (s.courses as unknown[]) : [];
    const courses: SlotCourse[] = rawCourses.map((rc) => {
      const c = rc as Record<string, unknown>;
      const code = String(c.code);
      const grade = c.grade;
      return grade === null || grade === undefined
        ? { code }
        : { code, grade: String(grade) };
    });
    return {
      id: String(s.id),
      termId: (s.term_id ?? null) as number | null,
      position: s.position as PlanSlot["position"],
      isCoop: Boolean(s.is_coop),
      courses,
    };
  });

  return {
    id: String(j.id),
    name: String(j.name),
    programIds: Array.isArray(j.program_ids) ? j.program_ids.map(String) : [],
    specializationIds: (j.specialization_ids ?? {}) as Record<string, string>,
    stream: (j.system_of_study ?? null) as Stream | null,
    startTermId: (j.start_term_id ?? null) as number | null,
    programScrapeVersion: (j.program_scrape_version ?? null) as string | null,
    slots,
    updatedAt: String(j.updated_at),
  };
}

/**
 * Convert a `ServerPlan` (or `LocalPlan`-shaped value) into the snapshot
 * payload for `save_plan_state`. Omits server-managed fields (id, name,
 * updatedAt) owned by the plans row.
 */
export function toSnapshot(plan: {
  programIds: string[];
  specializationIds: Record<string, string>;
  stream: Stream | null;
  startTermId: number | null;
  programScrapeVersion?: string | null;
  slots: PlanSlot[];
}): PlanSnapshot {
  return {
    programIds: plan.programIds,
    specializationIds: plan.specializationIds,
    stream: plan.stream,
    startTermId: plan.startTermId,
    programScrapeVersion: plan.programScrapeVersion ?? null,
    slots: plan.slots,
  };
}
