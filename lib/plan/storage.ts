import { safeGetItem, safeRemoveItem, safeSetItem } from "../storage";
import type {
  LocalPlan,
  PlanSlot,
  SlotCourse,
  SlotPosition,
  Stream,
} from "./types";
import { PLAN_SCHEMA_VERSION } from "./types";

/**
 * localStorage key for the current plan. Versioned in the key so that a
 * future schema bump doesn't silently overwrite or misread old data — the
 * old key remains intact for one-shot migration on first load.
 */
export const PLAN_STORAGE_KEY = "uwfinder.plan.v1";

const VALID_STREAMS: ReadonlySet<Stream> = new Set<Stream>([
  "regular",
  "stream4",
  "stream8",
]);

const VALID_POSITIONS: ReadonlySet<SlotPosition> = new Set<SlotPosition>([
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

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStream(v: unknown): v is Stream {
  return typeof v === "string" && VALID_STREAMS.has(v as Stream);
}

function isSlotCourse(v: unknown): v is SlotCourse {
  if (typeof v !== "object" || v === null) return false;
  const c = v as { code?: unknown; grade?: unknown };
  if (!isString(c.code)) return false;
  if (c.grade !== undefined && !isString(c.grade)) return false;
  return true;
}

function isPlanSlot(v: unknown): v is PlanSlot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<PlanSlot>;
  if (!isString(s.id)) return false;
  if (s.termId !== null && typeof s.termId !== "number") return false;
  if (!VALID_POSITIONS.has(s.position as SlotPosition)) return false;
  if (typeof s.isCoop !== "boolean") return false;
  if (!Array.isArray(s.courses)) return false;
  return s.courses.every(isSlotCourse);
}

function isLocalPlan(v: unknown): v is LocalPlan {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<LocalPlan>;
  if (p.version !== PLAN_SCHEMA_VERSION) return false;
  if (p.programId !== null && !isString(p.programId)) return false;
  if (p.specializationId !== null && !isString(p.specializationId))
    return false;
  if (!isStream(p.stream)) return false;
  if (p.startTermId !== null && typeof p.startTermId !== "number") return false;
  if (!Array.isArray(p.slots)) return false;
  if (!p.slots.every(isPlanSlot)) return false;
  if (!isString(p.updatedAt)) return false;
  return true;
}

export function loadPlan(): LocalPlan | null {
  const raw = safeGetItem(PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLocalPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePlan(plan: LocalPlan): void {
  const stamped: LocalPlan = { ...plan, updatedAt: new Date().toISOString() };
  safeSetItem(PLAN_STORAGE_KEY, JSON.stringify(stamped));
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
    version: PLAN_SCHEMA_VERSION,
    programId: null,
    specializationId: null,
    stream: "regular",
    startTermId: null,
    slots: [],
    updatedAt: new Date().toISOString(),
  };
}
