import { z } from "zod";
import { SLOT_POSITIONS } from "../types";
import { MAX_COURSES_PER_SLOT, MAX_SLOTS } from "./serialize";
import type { PlanSnapshot } from "./types";

// Field caps applied before the `save_plan_state` RPC (migrations/0002). These
// guard against malformed/oversized authenticated payloads so the server
// returns a stable app-level error instead of letting a bad value fall through
// to a raw Postgres cast/constraint failure. All sit well above any real plan.
export const MAX_PROGRAM_IDS = 8;
const MAX_SPECIALIZATIONS = 16;
/** Slugs/ids (program id, specialization key + value). */
export const MAX_ID_LEN = 128;
const MAX_SCRAPE_VERSION_LEN = 64;
const MAX_COURSE_CODE_LEN = 32;
const MAX_GRADE_LEN = 16;

/**
 * Size-only caps, checked first so genuine resource-exhaustion payloads keep the
 * dedicated `snapshot_too_large` error (anything else is `invalid_snapshot`).
 */
const SnapshotSizeSchema = z.object({
  slots: z
    .array(
      z.object({
        courses: z.array(z.unknown()).max(MAX_COURSES_PER_SLOT),
      }),
    )
    .max(MAX_SLOTS),
});

const BoundedId = z.string().min(1).max(MAX_ID_LEN);

const SlotCourseSchema = z.object({
  code: z.string().min(1).max(MAX_COURSE_CODE_LEN),
  grade: z.string().max(MAX_GRADE_LEN).optional(),
});

const PlanSlotSchema = z.object({
  id: z.uuid(),
  termId: z.number().int().nullable(),
  position: z.enum(SLOT_POSITIONS),
  isCoop: z.boolean(),
  courses: z.array(SlotCourseSchema).max(MAX_COURSES_PER_SLOT),
});

/**
 * Full structural validation of a `PlanSnapshot` before it reaches the RPC.
 * Beyond the size caps it pins every field to a predictable shape: program ids
 * are a deduped, bounded string list; specializations are a bounded string map;
 * slot ids are UUIDs with unique values; enums (stream, position) are closed.
 */
const PlanSnapshotSchema = z
  .object({
    programIds: z
      .array(BoundedId)
      .max(MAX_PROGRAM_IDS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "duplicate programIds",
      }),
    specializationIds: z
      .record(BoundedId, BoundedId)
      .refine((m) => Object.keys(m).length <= MAX_SPECIALIZATIONS, {
        message: "too many specializations",
      }),
    stream: z.enum(["regular", "stream4", "stream8"]).nullable(),
    startTermId: z.number().int().nullable(),
    programScrapeVersion: z.string().max(MAX_SCRAPE_VERSION_LEN).nullable(),
    slots: z.array(PlanSlotSchema).max(MAX_SLOTS),
  })
  .refine(
    (snap) => {
      const ids = snap.slots.map((s) => s.id);
      return new Set(ids).size === ids.length;
    },
    { message: "duplicate slot ids" },
  );

/**
 * Validate a snapshot before `save_plan_state`. Returns null when valid, else a
 * stable app-level error string:
 * - `"snapshot_too_large"` — exceeds the slot/course size caps.
 * - `"invalid_snapshot"`   — any other shape violation (bad UUID, unknown
 *   stream/position, duplicate program/slot id, over-length string, …).
 *
 * Size is checked first so the size case keeps its distinct error string.
 */
export function snapshotError(snapshot: PlanSnapshot): string | null {
  if (!SnapshotSizeSchema.safeParse(snapshot).success) {
    return "snapshot_too_large";
  }
  return PlanSnapshotSchema.safeParse(snapshot).success
    ? null
    : "invalid_snapshot";
}
