import { z } from "zod";
import { logWarn } from "@/lib/log";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/storage";
import {
  type LocalPlan,
  PLAN_SCHEMA_VERSION,
  SLOT_POSITIONS,
  STREAM_VALUES,
} from "./types";

// Stable namespace for the single persisted plan slot. The `.v1` is the
// storage-slot *name*, not the schema version — shape versioning lives in the
// `schemaVersion` field. Renaming this key would orphan every user's plan, so
// it stays put across schema bumps.
export const PLAN_STORAGE_KEY = "uwfinder.plan.v1";
/**
 * Sibling key where an unreadable / wrong-`schemaVersion` plan is parked before
 * the user starts fresh. Kept for debugging only — there is intentionally no
 * legacy migrator (old shapes are not upgraded).
 */
export const PLAN_BROKEN_BACKUP_KEY = `${PLAN_STORAGE_KEY}.broken`;

const StreamSchema = z.enum(STREAM_VALUES);

const SlotPositionSchema = z.enum(SLOT_POSITIONS);

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
  programIds: z.array(z.string()),
  specializationIds: z.record(z.string(), z.string()),
  stream: StreamSchema,
  startTermId: z.number().nullable(),
  slots: z.array(PlanSlotSchema),
  updatedAt: z.string(),
});

/**
 * Read a `LocalPlan` from localStorage. Returns `null` when nothing is stored
 * or the value can't be parsed (malformed JSON, shape drift, wrong
 * `schemaVersion`) — the caller then starts a fresh plan. The raw blob is
 * parked under `<key>.broken` for debugging; older shapes are intentionally
 * not migrated.
 */
export function loadPlan(): LocalPlan | null {
  const raw = safeGetItem(PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return LocalPlanSchema.parse(parsed);
  } catch (err) {
    safeSetItem(PLAN_BROKEN_BACKUP_KEY, raw);
    logWarn(
      "loadPlan: stored plan failed to parse; raw backup written to localStorage key",
      PLAN_BROKEN_BACKUP_KEY,
      err,
    );
    return null;
  }
}

/**
 * Persist a `LocalPlan`. Returns `true` on success, `false` when localStorage
 * is unavailable or rejected the write (quota, private mode). Always re-stamps
 * `schemaVersion`/`updatedAt` and drops per-slot duplicate courses (keeping the
 * first), so a stale caller can't crash React's key-uniqueness check.
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
 * Build an empty plan shell with the metadata fields set. Caller attaches slots
 * (via `buildEmptySlots`) and applies program/stream.
 */
export function emptyPlan(): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: [],
    specializationIds: {},
    stream: "regular",
    startTermId: null,
    slots: [],
    updatedAt: new Date().toISOString(),
  };
}
