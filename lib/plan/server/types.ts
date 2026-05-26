import type { TermId } from "../../types";
import type { PlanSlot, Stream } from "../types";

/**
 * Lightweight row for plan-list UIs (header switcher). Mirrors the columns
 * we select in `listPlans` — no slots/courses, so it's cheap to list dozens.
 */
export interface PlanSummary {
  id: string;
  name: string;
  programId: string | null;
  specializationId: string | null;
  stream: Stream | null;
  startTermId: TermId | null;
  shareToken: string | null;
  updatedAt: string;
}

/**
 * The full plan as returned by `loadServerPlan`. Same shape as a `LocalPlan`
 * but server-owned: carries the server `id`, the user-given `name`, and the
 * `program_scrape_version` we'll use in Phase 2+ to warn on choice-group
 * remap. Does NOT carry `schemaVersion` (server has no equivalent) or
 * `updatedAt` from `LocalPlan` (it has its own server-managed `updatedAt`).
 */
export interface ServerPlan {
  id: string;
  name: string;
  programId: string | null;
  specializationId: string | null;
  stream: Stream | null;
  startTermId: TermId | null;
  programScrapeVersion: string | null;
  slots: PlanSlot[];
  updatedAt: string;
}

/**
 * Payload accepted by `savePlanState` and (optionally) `createPlan`. The
 * snapshot doesn't carry server-managed fields (`id`, `name`, `updatedAt`)
 * so callers can't accidentally try to rename a plan through save.
 */
export interface PlanSnapshot {
  programId: string | null;
  specializationId: string | null;
  stream: Stream | null;
  startTermId: TermId | null;
  programScrapeVersion: string | null;
  slots: PlanSlot[];
}

/**
 * Uniform result shape for every server action. Avoids forcing the planner
 * shell to try/catch around every call — the UI can pattern-match on `ok`
 * and surface `error` in a banner. Programmer errors (missing env, bad
 * argument types) still throw.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
