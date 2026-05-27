import { z } from "zod";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/storage";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "./types";

export const PLAN_STORAGE_KEY = "uwfinder.plan.v1";
/** Sibling key where unreadable plans get parked so we can build a migrator. */
export const PLAN_BROKEN_BACKUP_KEY = `${PLAN_STORAGE_KEY}.broken`;

const StreamSchema = z.enum(["regular", "stream4", "stream8"]);

const SlotPositionSchema = z.enum([
  "1A",
  "1B",
  "2A",
  "2B",
  "3A",
  "3B",
  "4A",
  "4B",
  "coop1",
  "coop2",
  "coop3",
  "coop4",
  "coop5",
  "coop6",
  "pre",
]);

const SlotCourseSchema = z.object({
  code: z.string(),
  grade: z.string().optional(),
});

const PlanSlotSchema = z.object({
  id: z.string(),
  termId: z.number().nullable(),
  position: SlotPositionSchema,
  isCoop: z.boolean(),
  courses: z.array(SlotCourseSchema),
});

const LocalPlanSchema = z.object({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  programId: z.string().nullable(),
  specializationId: z.string().nullable(),
  stream: StreamSchema,
  startTermId: z.number().nullable(),
  slots: z.array(PlanSlotSchema),
  updatedAt: z.string(),
});

/**
 * Read a `LocalPlan` from localStorage. Returns `null` when nothing is stored
 * OR when the stored value can't be parsed (malformed JSON, shape drift,
 * wrong `schemaVersion`). On any parse/validation failure the raw blob is
 * stashed under `<key>.broken` (overwriting any previous backup) so future
 * code can build a migrator without the user having already lost their data.
 */
export function loadPlan(): LocalPlan | null {
  const raw = safeGetItem(PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return LocalPlanSchema.parse(parsed);
  } catch (err) {
    safeSetItem(PLAN_BROKEN_BACKUP_KEY, raw);
    console.warn(
      "loadPlan: stored plan failed to parse; raw backup written to localStorage key",
      PLAN_BROKEN_BACKUP_KEY,
      err,
    );
    return null;
  }
}

/**
 * Persist a `LocalPlan`. Returns `true` on a successful write, `false` when
 * localStorage is unavailable or rejected the write (quota, private mode).
 * `schemaVersion` and `updatedAt` are always re-stamped, and per-slot
 * duplicate courses are removed (keeping the first occurrence) so a stale
 * caller can't push a shape that crashes React's key uniqueness check —
 * callers don't need to set or normalize any of these.
 */
export function savePlan(plan: LocalPlan): boolean {
  const stamped: LocalPlan = {
    ...plan,
    schemaVersion: PLAN_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    slots: plan.slots.map(dedupSlotCourses),
  };
  return safeSetItem(PLAN_STORAGE_KEY, JSON.stringify(stamped));
}

function dedupSlotCourses(slot: LocalPlan["slots"][number]) {
  const seen = new Set<string>();
  const courses: typeof slot.courses = [];
  for (const c of slot.courses) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    courses.push(c);
  }
  return courses.length === slot.courses.length ? slot : { ...slot, courses };
}

export function clearPlan(): void {
  safeRemoveItem(PLAN_STORAGE_KEY);
}

/**
 * Build an empty plan shell. The caller decides what slots to attach (via
 * `buildEmptySlots` from sequence.ts) and what program/stream to apply —
 * this helper just gets the metadata fields right.
 */
export function emptyPlan(): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: null,
    specializationId: null,
    stream: "regular",
    startTermId: null,
    slots: [],
    updatedAt: new Date().toISOString(),
  };
}
