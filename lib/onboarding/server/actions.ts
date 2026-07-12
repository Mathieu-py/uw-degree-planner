"use server";

/**
 * Server actions for the manual-onboarding variant picker (#84). Both the rule
 * trees (PROGRAMS) and the catalog (loadTerm) are server-only — deliberately
 * kept out of the `/plan/new` client bundle (#31) — so the onboarding client
 * reaches them through these thin wrappers rather than importing programs.json.
 */

import { loadTerm } from "@/lib/courses/data";
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
import { PINNED_TERM } from "@/lib/terms";

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

/** Timeline positions for the student's picks, prereq-aware (catalog server-side). */
export async function placeVariantSelections(
  input: VariantPlacementInput,
): Promise<VariantPlacement[]> {
  // TODO(prod-hardening): validate `input` here (trust boundary, per account/plan
  // actions). `startTermId` reaches buildEmptySlots unchecked and throws on a bad
  // value — prefer returning [] so the picker degrades, not 500s. fetchVariantGroups
  // already skips unknown ids, so it needs no guard.
  const catalog = await loadTerm(PINNED_TERM);
  return resolveVariantPlacements(input, catalog);
}
