import type { ServerPlan } from "../server/types";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../types";

/**
 * Project a `ServerPlan` into the `LocalPlan` shape consumed by the planner
 * components. Drops server-managed identity (`id`, `name`,
 * `programScrapeVersion`) and stamps the on-disk schema version. The server
 * may store `stream` as null (legacy / empty plans); the planner UI requires
 * a concrete stream so we default to "regular".
 */
export function serverPlanToLocal(plan: ServerPlan): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: plan.programId,
    specializationId: plan.specializationId,
    stream: plan.stream ?? "regular",
    startTermId: plan.startTermId,
    slots: plan.slots,
    updatedAt: plan.updatedAt,
  };
}
