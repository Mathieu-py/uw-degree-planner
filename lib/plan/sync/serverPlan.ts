import type { ServerPlan } from "../server/types";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../types";

/**
 * In-flight save state for the loaded server plan, shown via `SaveStatusBadge`.
 * Synchronous local-storage saves don't use this (they use `SaveFailedBanner`).
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Project a `ServerPlan` into the `LocalPlan` shape the planner consumes. Drops
 * server identity (`id`, `name`, `programScrapeVersion`), stamps the schema
 * version, and defaults a null `stream` (legacy/empty plans) to "regular".
 */
export function serverPlanToLocal(plan: ServerPlan): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: plan.programIds,
    specializationIds: plan.specializationIds,
    acknowledgedRequirements: plan.acknowledgedRequirements,
    stream: plan.stream ?? "regular",
    startTermId: plan.startTermId,
    slots: plan.slots,
    updatedAt: plan.updatedAt,
  };
}
