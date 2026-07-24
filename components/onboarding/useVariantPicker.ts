"use client";

import { useEffect, useState } from "react";
import { logError } from "@/lib/log";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import {
  fetchVariantGroups,
  placeVariantSelections,
} from "@/lib/plan/server/actions";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import type {
  VariantPlacement,
  VariantSelection,
} from "@/lib/plan/variantPlacement";
import type { VariantGroup } from "@/lib/requirements/variantGroups";

/**
 * Owns the manual-onboarding variant picker: the program's pickable
 * course-variant groups, the student's selections, and folding those picks into
 * the built plan. Kept out of WelcomeFlow so that already-busy component doesn't
 * grow another state machine (mirrors the planner's usePlanner* hooks).
 *
 * `enabled` is false on the transcript path — placed courses already resolve
 * every choice, so no picker and no placement.
 */
export function useVariantPicker({
  programIds,
  stream,
  enabled,
}: {
  programIds: string[];
  stream: Stream;
  enabled: boolean;
}) {
  const [groups, setGroups] = useState<VariantGroup[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  // Rule trees stay off the onboarding bundle, so fetch groups server-side. A
  // program change refetches and clears now-stale selections.
  useEffect(() => {
    setSelections({});
    if (!enabled || programIds.length === 0) {
      setGroups([]);
      return;
    }
    let active = true;
    fetchVariantGroups(programIds)
      .then((next) => {
        if (active) setGroups(next);
      })
      .catch((err) => {
        logError("fetchVariantGroups failed:", err);
        if (active) setGroups([]);
      });
    return () => {
      active = false;
    };
  }, [programIds, enabled]);

  function onChange(key: string, codes: string[]) {
    setSelections((prev) =>
      codes.length > 0
        ? { ...prev, [key]: codes }
        : // Empty selection drops the key, so the flatten stays omit-empty.
          Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)),
    );
  }

  /**
   * Place the student's picks into `plan`. Placement is server-side (prereq-aware,
   * needs the catalog); returned positions map back onto this plan's own slot ids.
   * No picks / disabled → plan returned unchanged.
   */
  async function applyTo(plan: LocalPlan): Promise<LocalPlan> {
    if (!enabled || plan.startTermId === null) return plan;
    const termByKey = new Map(groups.map((g) => [g.key, g.termLabel]));
    const flat: VariantSelection[] = [];
    for (const [key, codes] of Object.entries(selections)) {
      const termLabel = termByKey.get(key) ?? null;
      for (const code of codes) flat.push({ code, termLabel });
    }
    if (flat.length === 0) return plan;

    // The picker is an optional convenience — a placement failure (RPC/catalog
    // error) must not block onboarding, so fall back to the un-placed plan.
    const placements: VariantPlacement[] = await placeVariantSelections({
      programIds,
      startTermId: plan.startTermId,
      stream,
      selections: flat,
    }).catch((err) => {
      logError("placeVariantSelections failed:", err);
      return [];
    });
    if (placements.length === 0) return plan;

    const slotIdByPosition = new Map(plan.slots.map((s) => [s.position, s.id]));
    let next = plan;
    for (const p of placements) {
      const slotId = slotIdByPosition.get(p.position);
      if (slotId) next = addCourseToSlot(next, slotId, { code: p.code });
    }
    return next;
  }

  return { groups, selections, onChange, applyTo };
}
