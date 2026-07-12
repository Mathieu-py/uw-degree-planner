"use server";

/**
 * Server actions for the manual-onboarding variant picker (#84). Both the rule
 * trees (PROGRAMS) and the catalog (loadTerm) are server-only — deliberately
 * kept out of the `/plan/new` client bundle (#31) — so the onboarding client
 * reaches them through these thin wrappers rather than importing programs.json.
 */

import { loadTerm } from "@/lib/courses/data";
import { logError } from "@/lib/log";
import {
  resolveVariantPlacements,
  type VariantPlacement,
  type VariantPlacementInput,
} from "@/lib/plan/variantPlacement";
import { PROGRAMS } from "@/lib/programs";
import {
  enumerateVariantGroups,
  type VariantGroup,
} from "@/lib/requirements/variantGroups";
import { KNOWN_TERMS, PINNED_TERM } from "@/lib/terms";

/** Pickable variant groups for the selected program(s); flattened, double-degree-safe. */
export async function fetchVariantGroups(
  programIds: string[],
): Promise<VariantGroup[]> {
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
    logError("placeVariantSelections failed:", err);
    return [];
  }
}
