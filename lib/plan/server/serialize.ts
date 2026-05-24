import type { PlanSlot, SlotCourse, SlotPosition, Stream } from "../types";
import type { PlanSnapshot, PlanSummary, ServerPlan } from "./types";

/**
 * Row shape returned by `select * from plans` via supabase-js. Field names
 * are the raw Postgres column names (snake_case). The selectors below pluck
 * them into camelCase for the rest of the app.
 */
export interface PlanRow {
  id: string;
  name: string;
  program_id: string | null;
  specialization_id: string | null;
  system_of_study: Stream | null;
  start_term_id: number | null;
  program_scrape_version: string | null;
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
 * Project a `plans` row into the lightweight summary we expose to UI lists.
 * No slot data, so the listPlans query stays a single table read.
 */
export function planRowToSummary(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    name: row.name,
    programId: row.program_id,
    specializationId: row.specialization_id,
    stream: row.system_of_study,
    startTermId: row.start_term_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Assemble a `ServerPlan` from the three joined queries. Slot/course order
 * is taken from the `ordinal` column; ties broken by `id` for determinism.
 * The caller is responsible for fetching only rows that belong to `plan` —
 * this function does no filtering of its own.
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
    // Explicit null check: only DB nulls should drop the field. An empty
    // string is a valid (if semantically odd) grade and must round-trip,
    // since the save RPC's `nullif(..., '')` is the only place that should
    // normalize empties to null — the read path stays faithful to the row.
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
    programId: plan.program_id,
    specializationId: plan.specialization_id,
    stream: plan.system_of_study,
    startTermId: plan.start_term_id,
    programScrapeVersion: plan.program_scrape_version,
    slots,
    updatedAt: plan.updated_at,
  };
}

/**
 * Convert a `ServerPlan` (or `LocalPlan`-shaped value) into the snapshot
 * payload accepted by `save_plan_state`. We don't ship the server-managed
 * fields (id, name, updatedAt) — those are owned by the plans row itself.
 */
export function toSnapshot(plan: {
  programId: string | null;
  specializationId: string | null;
  stream: Stream | null;
  startTermId: number | null;
  programScrapeVersion?: string | null;
  slots: PlanSlot[];
}): PlanSnapshot {
  return {
    programId: plan.programId,
    specializationId: plan.specializationId,
    stream: plan.stream,
    startTermId: plan.startTermId,
    programScrapeVersion: plan.programScrapeVersion ?? null,
    slots: plan.slots,
  };
}
