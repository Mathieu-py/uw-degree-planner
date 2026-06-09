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
 * carries `id`, `name`, and `programScrapeVersion` (Phase 2+ choice-group
 * remap warnings). No `schemaVersion`; `updatedAt` is server-managed.
 */
export interface ServerPlan {
  id: string;
  name: string;
  programIds: string[];
  specializationIds: Record<string, string>;
  stream: Stream | null;
  startTermId: TermId | null;
  programScrapeVersion: string | null;
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
  stream: Stream | null;
  startTermId: TermId | null;
  programScrapeVersion: string | null;
  slots: PlanSlot[];
}

/**
 * Uniform result shape for every server action, so the UI pattern-matches on
 * `ok` instead of try/catch and surfaces `error` in a banner. Programmer
 * errors (missing env, bad argument types) still throw.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
