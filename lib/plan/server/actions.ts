"use server";

import { randomBytes } from "node:crypto";
import { loadTerm } from "@/lib/courses/data";
import { logError } from "@/lib/log";
import { reseedSlotIds } from "@/lib/plan/mutateSlots";
import {
  resolveVariantPlacements,
  type VariantPlacement,
  type VariantPlacementInput,
} from "@/lib/plan/variantPlacement";
import { PROGRAMS } from "@/lib/programs/registry";
import {
  enumerateVariantGroups,
  type VariantGroup,
} from "@/lib/requirements/variantGroups";
import {
  type ActionResult,
  mapDbError,
  requireAffectedRow,
  withUser,
} from "@/lib/server/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { KNOWN_TERMS, PINNED_TERM } from "@/lib/terms";
import {
  assembleServerPlan,
  mapSharedPlanJson,
  type PlanCourseRow,
  type PlanRow,
  type PlanSlotRow,
  planRowToSummary,
  toSnapshot,
} from "./serialize";
import type { PlanSnapshot, PlanSummary, ServerPlan } from "./types";
import { MAX_PLAN_NAME_LEN, MAX_PROGRAM_IDS, snapshotError } from "./validate";

const PLAN_COLUMNS =
  "id, name, program_ids, specialization_ids, system_of_study, start_term_id, program_scrape_version, share_token, updated_at";

const SLOT_COLUMNS = "id, plan_id, term_id, position, is_coop, ordinal";

const COURSE_COLUMNS = "id, slot_id, course_code, outcome, ordinal";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listPlans(): Promise<ActionResult<PlanSummary[]>> {
  return withUser(async ({ client }) => {
    const { data, error } = await client
      .from("plans")
      .select(PLAN_COLUMNS)
      .order("updated_at", { ascending: false });

    if (error) return { ok: false, error: mapDbError(error, "listPlans") };
    return { ok: true, data: (data as PlanRow[]).map(planRowToSummary) };
  });
}

/**
 * The ids of the caller's plans that already contain `courseCode`, so the
 * catalog add flow can grey them out. No join to `plans`: RLS policies
 * (`plan_courses_owner_all`, `plan_slots_owner_all`) scope the
 * `plan_slots!inner(plan_id)` embed to the caller's rows. Codes are lowercase.
 */
export async function plansContainingCourse(
  courseCode: string,
): Promise<ActionResult<string[]>> {
  return withUser(async ({ client }) => {
    const code = courseCode.trim().toLowerCase();
    if (!code || code.length > 32) return { ok: true, data: [] };

    const { data, error } = await client
      .from("plan_courses")
      .select("plan_slots!inner(plan_id)")
      .eq("course_code", code);

    if (error) {
      return { ok: false, error: mapDbError(error, "plansContainingCourse") };
    }

    // PostgREST types a to-one embed as an object but can surface an array;
    // accept both so a relationship-shape change can't silently drop ids.
    const ids = new Set<string>();
    for (const row of (data ?? []) as Array<{
      plan_slots: { plan_id: string } | { plan_id: string }[] | null;
    }>) {
      const ps = row.plan_slots;
      if (Array.isArray(ps)) for (const x of ps) ids.add(x.plan_id);
      else if (ps) ids.add(ps.plan_id);
    }
    return { ok: true, data: [...ids] };
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  name: string;
  /**
   * Optional initial state, seeded in one round trip via `save_plan_state`.
   * How the Phase 2 anon→auth handoff uploads the localStorage plan.
   */
  seed?: PlanSnapshot;
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<ActionResult<{ id: string }>> {
  return withUser(async ({ client, userId }) => {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "name_required" };
    if (name.length > MAX_PLAN_NAME_LEN) {
      return { ok: false, error: "name_too_long" };
    }

    const { data, error } = await client
      .from("plans")
      .insert({ owner_id: userId, name })
      .select("id")
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error ? mapDbError(error, "createPlan") : "insert_failed",
      };
    }

    if (input.seed) {
      const seedResult = await savePlanStateWithClient(
        client,
        data.id,
        input.seed,
      );
      if (!seedResult.ok) {
        // Roll back the empty plan so the user isn't left with an orphan.
        // Best-effort; we surface the original seed error, not any rollback one.
        await client.from("plans").delete().eq("id", data.id);
        return seedResult;
      }
    }

    return { ok: true, data: { id: data.id } };
  });
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export async function duplicatePlan(
  planId: string,
  nameOverride?: string,
): Promise<ActionResult<{ id: string }>> {
  const loaded = await loadServerPlan(planId);
  if (!loaded.ok) return loaded;
  if (!loaded.data) return { ok: false, error: "not_found" };

  const source = loaded.data;
  // Clamp instead of erroring so duplicating a max-length name can't fail.
  const name = (nameOverride ?? `${source.name} (copy)`)
    .trim()
    .slice(0, MAX_PLAN_NAME_LEN);
  // Fresh slot ids or the seed PK-conflicts with the source (see reseedSlotIds).
  return createPlan({ name, seed: reseedSlotIds(toSnapshot(source)) });
}

// ---------------------------------------------------------------------------
// Load (full join)
// ---------------------------------------------------------------------------

export async function loadServerPlan(
  planId: string,
): Promise<ActionResult<ServerPlan | null>> {
  return withUser(async ({ client }) => {
    const { data: planData, error: planError } = await client
      .from("plans")
      .select(PLAN_COLUMNS)
      .eq("id", planId)
      .maybeSingle();

    if (planError) {
      return { ok: false, error: mapDbError(planError, "loadServerPlan.plan") };
    }
    if (!planData) return { ok: true, data: null };

    const { data: slotData, error: slotError } = await client
      .from("plan_slots")
      .select(SLOT_COLUMNS)
      .eq("plan_id", planId);

    if (slotError) {
      return {
        ok: false,
        error: mapDbError(slotError, "loadServerPlan.slots"),
      };
    }

    const slotIds = (slotData as PlanSlotRow[]).map((s) => s.id);
    let courses: PlanCourseRow[] = [];
    if (slotIds.length > 0) {
      const { data: courseData, error: courseError } = await client
        .from("plan_courses")
        .select(COURSE_COLUMNS)
        .in("slot_id", slotIds);
      if (courseError) {
        return {
          ok: false,
          error: mapDbError(courseError, "loadServerPlan.courses"),
        };
      }
      courses = courseData as PlanCourseRow[];
    }

    const plan = assembleServerPlan(
      planData as PlanRow,
      slotData as PlanSlotRow[],
      courses,
    );
    return { ok: true, data: plan };
  });
}

// ---------------------------------------------------------------------------
// Save (full snapshot replace via RPC)
// ---------------------------------------------------------------------------

export async function savePlanState(
  planId: string,
  snapshot: PlanSnapshot,
): Promise<ActionResult<void>> {
  return withUser(({ client }) =>
    savePlanStateWithClient(client, planId, snapshot),
  );
}

async function savePlanStateWithClient(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planId: string,
  snapshot: PlanSnapshot,
): Promise<ActionResult<void>> {
  const invalid = snapshotError(snapshot);
  if (invalid) return { ok: false, error: invalid };

  const { error } = await client.rpc("save_plan_state", {
    p_plan_id: planId,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: mapDbError(error, "savePlanState") };
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renamePlan(
  planId: string,
  name: string,
): Promise<ActionResult<void>> {
  return withUser(async ({ client }) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "name_required" };
    if (trimmed.length > MAX_PLAN_NAME_LEN) {
      return { ok: false, error: "name_too_long" };
    }

    // `.select('id')` returns the updated rows so requireAffectedRow can tell
    // success from "RLS hid the row".
    const { data, error } = await client
      .from("plans")
      .update({ name: trimmed })
      .eq("id", planId)
      .select("id");

    if (error) return { ok: false, error: mapDbError(error, "renamePlan") };
    const missing = requireAffectedRow(data);
    if (missing) return missing;
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Share toggle
// ---------------------------------------------------------------------------

/**
 * Mint or revoke a plan's public share token. Returns the new token (null when
 * disabling). `share_token` is 128-bit random, so a UNIQUE collision is
 * astronomically unlikely; we retry once before surfacing the error.
 */
export async function setPlanShare(
  planId: string,
  enable: boolean,
): Promise<ActionResult<{ shareToken: string | null }>> {
  // Explicit T: the two ok branches return `null` and `string` tokens, which
  // inference won't widen to `string | null` on its own.
  return withUser<{ shareToken: string | null }>(async ({ client }) => {
    if (!enable) {
      const { data, error } = await client
        .from("plans")
        .update({ share_token: null })
        .eq("id", planId)
        .select("id");
      if (error) {
        return { ok: false, error: mapDbError(error, "setPlanShare.disable") };
      }
      const missing = requireAffectedRow(data);
      if (missing) return missing;
      return { ok: true, data: { shareToken: null } };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = randomBytes(16).toString("base64url");
      const { data, error } = await client
        .from("plans")
        .update({ share_token: token })
        .eq("id", planId)
        .select("id");
      if (error) {
        // Postgres unique_violation; retry once before bubbling up.
        if (error.code === "23505" && attempt === 0) continue;
        return { ok: false, error: mapDbError(error, "setPlanShare.enable") };
      }
      const missing = requireAffectedRow(data);
      if (missing) return missing;
      return { ok: true, data: { shareToken: token } };
    }
    return { ok: false, error: "share_token_collision" };
  });
}

// ---------------------------------------------------------------------------
// Shared plan read (anon-callable via SECURITY DEFINER RPC)
// ---------------------------------------------------------------------------

/**
 * Load a plan by its public share token via the `get_shared_plan` RPC
 * (SECURITY DEFINER, granted to anon + authenticated, so no session needed).
 * Returns null when the token is unknown.
 */
export async function loadSharedPlan(
  token: string,
): Promise<ActionResult<ServerPlan | null>> {
  if (!token) return { ok: true, data: null };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_shared_plan", { token });
  if (error) return { ok: false, error: mapDbError(error, "loadSharedPlan") };
  return { ok: true, data: mapSharedPlanJson(data) };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deletePlan(planId: string): Promise<ActionResult<void>> {
  return withUser(async ({ client }) => {
    // FK on-delete-cascade (0001_initial.sql) clears slots and courses.
    const { data, error } = await client
      .from("plans")
      .delete()
      .eq("id", planId)
      .select("id");

    if (error) return { ok: false, error: mapDbError(error, "deletePlan") };
    const missing = requireAffectedRow(data);
    if (missing) return missing;
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Onboarding variant picker
// ---------------------------------------------------------------------------
//
// Thin wrappers for the manual-onboarding picker. The rule trees (PROGRAMS) and
// catalog (loadTerm) are server-only — kept out of the /plan/new client bundle —
// so the onboarding client reaches them through these instead of importing them.

/** Pickable variant groups for the selected program(s); flattened, double-degree-safe. */
export async function fetchVariantGroups(
  programIds: string[],
): Promise<VariantGroup[]> {
  // Public endpoint: degrade to empty like placeVariantSelections below.
  if (programIds.length > MAX_PROGRAM_IDS) return [];
  const out: VariantGroup[] = [];
  for (const id of programIds) {
    const program = PROGRAMS[id];
    if (program) out.push(...enumerateVariantGroups(program, id));
  }
  return out;
}

// Bound the work one request can trigger; a real onboarding picks a few dozen.
const MAX_VARIANT_SELECTIONS = 200;

/** Timeline positions for the student's picks, prereq-aware (catalog server-side). */
export async function placeVariantSelections(
  input: VariantPlacementInput,
): Promise<VariantPlacement[]> {
  // Public endpoint: validate at the boundary and degrade to no placements
  // (never 500) — the picker is optional.
  if (!KNOWN_TERMS.some((t) => t.id === input.startTermId)) return [];
  if (input.selections.length > MAX_VARIANT_SELECTIONS) return [];

  try {
    const catalog = await loadTerm(PINNED_TERM);
    return resolveVariantPlacements(input, catalog);
  } catch (err) {
    logError("placeVariantSelections failed:", err, {
      op: "variant.place",
      category: "server",
    });
    return [];
  }
}
