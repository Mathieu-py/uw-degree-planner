import type { TermId } from "@/lib/terms";
import type { PlanSlot, Stream } from "../types";

/**
 * Lightweight row for plan-list UIs. Mirrors `listPlans`'s columns — no
 * slots/courses, so listing dozens is cheap.
 */
export interface PlanSummary {
  id: string;
  name: string;
  programIds: string[];
  specializationIds: Record<string, string>;
  stream: Stream | null;
  startTermId: TermId | null;
  shareToken: string | null;
  updatedAt: string;
}

/**
 * The full plan from `loadServerPlan`. Like `LocalPlan` but server-owned:
 * carries `id` and `name`. No `schemaVersion`; `updatedAt` is server-managed.
 */
export interface ServerPlan {
  id: string;
  name: string;
  programIds: string[];
  specializationIds: Record<string, string>;
  /** Per-program acked unverified requirements (see LocalPlan). */
  acknowledgedRequirements: Record<string, string[]>;
  stream: Stream | null;
  startTermId: TermId | null;
  slots: PlanSlot[];
  updatedAt: string;
}

/**
 * Payload for `savePlanState` and (optionally) `createPlan`. Omits
 * server-managed fields (`id`, `name`, `updatedAt`) so callers can't rename a
 * plan through save.
 */
export interface PlanSnapshot {
  programIds: string[];
  specializationIds: Record<string, string>;
  acknowledgedRequirements: Record<string, string[]>;
  stream: Stream | null;
  startTermId: TermId | null;
  slots: PlanSlot[];
}
