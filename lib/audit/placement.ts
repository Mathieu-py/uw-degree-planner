import type { LocalPlan, SlotPosition } from "../plan/types";
import type { TermId } from "../types";

/**
 * Location of a placed course within a plan: which slot it sits in.
 * `termId === null` is the synthetic pre-arrival slot (transfer credits).
 */
export interface Placement {
  code: string;
  slotId: string;
  termId: TermId | null;
  position: SlotPosition;
}

export type PlacementMap = ReadonlyMap<string, Placement>;

/**
 * Build a course-code → placement lookup from a plan. If the same code
 * appears in multiple slots (which shouldn't happen in normal use but is
 * defensible), the FIRST occurrence in slot-iteration order wins.
 */
export function buildPlacementMap(plan: LocalPlan): PlacementMap {
  const map = new Map<string, Placement>();
  for (const slot of plan.slots) {
    for (const c of slot.courses) {
      if (map.has(c.code)) continue;
      map.set(c.code, {
        code: c.code,
        slotId: slot.id,
        termId: slot.termId,
        position: slot.position,
      });
    }
  }
  return map;
}
