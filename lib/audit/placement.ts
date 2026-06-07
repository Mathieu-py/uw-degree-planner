import { earnsCredit } from "@/lib/plan/grades";
import type { LocalPlan, SlotPosition } from "@/lib/plan/types";
import type { TermId } from "@/lib/terms";

/**
 * Where a placed course sits in a plan. `termId === null` is the synthetic
 * pre-arrival slot (transfer credits).
 */
export interface Placement {
  code: string;
  slotId: string;
  termId: TermId | null;
  position: SlotPosition;
}

export type PlacementMap = ReadonlyMap<string, Placement>;

/**
 * Course-code → placement lookup for a plan. On duplicate codes (rare but
 * tolerated) the FIRST in slot order wins.
 *
 * No-credit attempts (failed / withdrawn — see {@link earnsCredit}) are skipped
 * so the audit doesn't treat them as placed; a passed retake elsewhere still
 * registers.
 */
export function buildPlacementMap(plan: LocalPlan): PlacementMap {
  const map = new Map<string, Placement>();
  for (const slot of plan.slots) {
    for (const c of slot.courses) {
      if (!earnsCredit(c.grade)) continue;
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
