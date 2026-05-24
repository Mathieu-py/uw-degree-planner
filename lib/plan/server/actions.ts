"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assembleServerPlan,
  type PlanCourseRow,
  type PlanRow,
  type PlanSlotRow,
  planRowToSummary,
} from "./serialize";
import type {
  ActionResult,
  PlanSnapshot,
  PlanSummary,
  ServerPlan,
} from "./types";

const PLAN_COLUMNS =
  "id, name, program_id, specialization_id, system_of_study, start_term_id, program_scrape_version, updated_at";

const SLOT_COLUMNS = "id, plan_id, term_id, position, is_coop, ordinal";

const COURSE_COLUMNS = "id, slot_id, course_code, grade, ordinal";

/**
 * Resolve the current user, returning `null` for unauthenticated callers.
 * Centralizing the auth check keeps the actions below uniform: every action
 * returns `not_authenticated` rather than throwing when the session is gone
 * (which happens routinely as refresh tokens expire mid-session).
 */
async function requireUser(): Promise<
  | {
      ok: true;
      userId: string;
      client: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    }
  | { ok: false; error: "not_authenticated" }
> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: data.user.id, client };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listPlans(): Promise<ActionResult<PlanSummary[]>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.client
    .from("plans")
    .select(PLAN_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as PlanRow[]).map(planRowToSummary) };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  name: string;
  /**
   * Optional initial state. When provided, the new plan is seeded in a single
   * round trip via `save_plan_state`. This is how the Phase 2 anon→auth
   * handoff will upload the user's localStorage plan as their first plan.
   */
  seed?: PlanSnapshot;
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_required" };

  const { data, error } = await auth.client
    .from("plans")
    .insert({ owner_id: auth.userId, name })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert_failed" };
  }

  if (input.seed) {
    const seedResult = await savePlanStateWithClient(
      auth.client,
      data.id,
      input.seed,
    );
    if (!seedResult.ok) {
      // Roll back the empty plan we just created so the user doesn't end up
      // with an empty orphan. Best-effort — if the rollback itself fails we
      // surface the original seed error rather than masking it.
      await auth.client.from("plans").delete().eq("id", data.id);
      return seedResult;
    }
  }

  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// Load (full join)
// ---------------------------------------------------------------------------

export async function loadServerPlan(
  planId: string,
): Promise<ActionResult<ServerPlan | null>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: planData, error: planError } = await auth.client
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  if (planError) return { ok: false, error: planError.message };
  if (!planData) return { ok: true, data: null };

  const { data: slotData, error: slotError } = await auth.client
    .from("plan_slots")
    .select(SLOT_COLUMNS)
    .eq("plan_id", planId);

  if (slotError) return { ok: false, error: slotError.message };

  const slotIds = (slotData as PlanSlotRow[]).map((s) => s.id);
  let courses: PlanCourseRow[] = [];
  if (slotIds.length > 0) {
    const { data: courseData, error: courseError } = await auth.client
      .from("plan_courses")
      .select(COURSE_COLUMNS)
      .in("slot_id", slotIds);
    if (courseError) return { ok: false, error: courseError.message };
    courses = courseData as PlanCourseRow[];
  }

  const plan = assembleServerPlan(
    planData as PlanRow,
    slotData as PlanSlotRow[],
    courses,
  );
  return { ok: true, data: plan };
}

// ---------------------------------------------------------------------------
// Save (full snapshot replace via RPC)
// ---------------------------------------------------------------------------

export async function savePlanState(
  planId: string,
  snapshot: PlanSnapshot,
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  return savePlanStateWithClient(auth.client, planId, snapshot);
}

async function savePlanStateWithClient(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planId: string,
  snapshot: PlanSnapshot,
): Promise<ActionResult<void>> {
  const { error } = await client.rpc("save_plan_state", {
    p_plan_id: planId,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renamePlan(
  planId: string,
  name: string,
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "name_required" };

  // `.select('id')` forces PostgREST to return the updated rows so we can
  // detect "0 rows updated" (plan didn't exist OR wasn't owned — RLS hides
  // both behind the same response).
  const { data, error } = await auth.client
    .from("plans")
    .update({ name: trimmed })
    .eq("id", planId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "not_found_or_unauthorized" };
  }
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deletePlan(planId: string): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Same trick as renamePlan: ask for the deleted rows back so we can tell
  // success from "RLS hid the row from this user". Cascade clears slots and
  // courses via the foreign-key on-delete-cascade in 0001_initial.sql.
  const { data, error } = await auth.client
    .from("plans")
    .delete()
    .eq("id", planId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "not_found_or_unauthorized" };
  }
  return { ok: true, data: undefined };
}
