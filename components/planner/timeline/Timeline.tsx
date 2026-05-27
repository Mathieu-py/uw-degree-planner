"use client";

import { useEffect, useRef, useState } from "react";
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

// Number of term columns that should be visible at once; columns beyond
// this scroll horizontally. Width per column is computed at runtime so the
// grid stays responsive to the available content area.
const VISIBLE_COLUMNS = 4;
const GAP_PX = 12;
const MIN_COL_PX = 140;

/**
 * Horizontal scrolling grid of term columns. Co-op slots are inline at their
 * sequenced position. Columns are sized so VISIBLE_COLUMNS fit exactly in
 * the scroller's visible width; additional terms scroll horizontally.
 *
 * Pre-arrival / transfer credits — when present — render as a pinned first
 * column inside the same horizontal scroll (distinct amber styling), rather
 * than as a separate banner above.
 */
export function Timeline({
  plan,
  issuesPerSlot,
  onSlotClick,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  const preSlot = plan.slots.find((s) => s.position === "pre");
  const orderedSlots = plan.slots.filter((s) => s.position !== "pre");
  const hasTransfer = !!preSlot && preSlot.courses.length > 0;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [colW, setColW] = useState<number>(160);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const compute = () => {
      const available = el.clientWidth - (VISIBLE_COLUMNS - 1) * GAP_PX;
      const next = Math.max(
        MIN_COL_PX,
        Math.floor(available / VISIBLE_COLUMNS),
      );
      setColW(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={scrollerRef}
      className="overflow-x-auto overscroll-x-contain pb-2 [-webkit-overflow-scrolling:touch]"
      style={{ "--col-w": `${colW}px` } as React.CSSProperties}
    >
      <div className="flex gap-3 min-w-min">
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
    </div>
  );
}

/**
 * Read-only column for credits the student arrived with. Same width as
 * TermColumn so it lines up; amber styling marks it as not-a-regular-term.
 */
function PreArrivalColumn({ slot }: { slot: PlanSlot }) {
  return (
    <div className="w-[var(--col-w)] shrink-0 flex flex-col gap-2">
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
