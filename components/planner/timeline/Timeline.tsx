"use client";

import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import { TermColumn } from "./TermColumn";

interface Props {
  plan: LocalPlan;
  issuesPerSlot: ReadonlyMap<string, ValidationIssue[]>;
  onSlotClick: (slotId: string) => void;
  onRemoveCourse: (slotId: string, code: string) => void;
  readOnly?: boolean;
}

/**
 * Responsive grid of the 8 academic term columns (1A–4B). Co-op work terms
 * remain in the plan's data model (so academic terms keep their correct,
 * co-op-spaced calendar dates) but are not rendered here. The grid wraps —
 * 4 columns per row on desktop, 2 on tablet, 1 on mobile — so it never
 * scrolls horizontally.
 *
 * Pre-arrival / transfer credits — when present — render as the first cell
 * (distinct amber styling), rather than as a separate banner above.
 */
export function Timeline({
  plan,
  issuesPerSlot,
  onSlotClick,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  const preSlot = plan.slots.find((s) => s.position === "pre");
  const orderedSlots = plan.slots.filter(
    (s) => s.position !== "pre" && !s.isCoop,
  );
  const hasTransfer = !!preSlot && preSlot.courses.length > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:flex-1 lg:min-h-0 lg:auto-rows-fr">
      {hasTransfer && preSlot ? <PreArrivalColumn slot={preSlot} /> : null}
      {orderedSlots.map((slot) => (
        <TermColumn
          key={slot.id}
          slot={slot}
          issues={issuesPerSlot.get(slot.id) ?? []}
          onClick={() => onSlotClick(slot.id)}
          onRemoveCourse={(code) => onRemoveCourse(slot.id, code)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

/**
 * Read-only column for credits the student arrived with. Same width as
 * TermColumn so it lines up; amber styling marks it as not-a-regular-term.
 */
function PreArrivalColumn({ slot }: { slot: PlanSlot }) {
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex flex-col px-1">
        <span className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-300">
          Transfer credits
        </span>
        <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
          Pre-arrival
        </span>
      </div>
      <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 p-2 flex flex-col gap-1">
        {slot.courses.map((c) => (
          <span
            key={c.code}
            className="rounded bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 px-2 py-0.5 text-xs font-mono"
          >
            {c.code}
          </span>
        ))}
      </div>
    </div>
  );
}
