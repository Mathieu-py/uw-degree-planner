"use client";

import { Icon } from "@/components/ui/Icon";
import type { CourseDragData } from "@/lib/plan/dnd";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import { termInfo } from "@/lib/terms";
import { TermColumn } from "./TermColumn";

// Stable reference for slots with no issues so memoized TermColumns aren't
// invalidated by a fresh `[]` literal on every render of the timeline.
const EMPTY_ISSUES: ValidationIssue[] = [];

interface Props {
  plan: LocalPlan;
  issuesPerSlot: ReadonlyMap<string, ValidationIssue[]>;
  onSlotClick: (slotId: string) => void;
  onRemoveCourse: (slotId: string, code: string) => void;
  /** Present only in editable views; absent makes term columns inert as drop targets. */
  onCourseDrop?: (toSlotId: string, data: CourseDragData) => void;
  /**
   * Notifies the shell which placed course is being dragged between terms (or
   * null on drag end), so the eligibility highlight runs on a move like an add.
   */
  onMoveDrag?: (moving: { code: string; fromSlotId: string } | null) => void;
  /**
   * Slot ids where the dragged audit course is eligible; non-null only mid-drag.
   * Drives the per-term green/muted highlight. Absent in read-only views.
   */
  eligibleSlotIds?: Set<string> | null;
  readOnly?: boolean;
  /** `?from=plan` for course links so the detail page hides its "Add to plan".
   *  Set by the editable planner; omitted by the shared view. */
  planOriginQuery?: string;
}

/**
 * Wrapping grid of the whole degree — academic term cards with co-op terms
 * interleaved in calendar order. Grows downward, scrolls vertically only.
 * Pre-arrival / transfer credits, when present, render as the first cell.
 */
export function Timeline({
  plan,
  issuesPerSlot,
  onSlotClick,
  onRemoveCourse,
  onCourseDrop,
  onMoveDrag,
  eligibleSlotIds = null,
  readOnly = false,
  planOriginQuery,
}: Props) {
  const preSlot = plan.slots.find((s) => s.position === "pre");
  const orderedSlots = plan.slots.filter((s) => s.position !== "pre");
  const hasTransfer = !!preSlot && preSlot.courses.length > 0;

  return (
    <div className="pw-tl-grid">
      {hasTransfer && preSlot ? <PreArrivalColumn slot={preSlot} /> : null}
      {orderedSlots.map((slot) =>
        slot.isCoop ? (
          <CoopTerm key={slot.id} slot={slot} />
        ) : (
          <TermColumn
            key={slot.id}
            slot={slot}
            issues={issuesPerSlot.get(slot.id) ?? EMPTY_ISSUES}
            onSlotClick={onSlotClick}
            onRemoveCourse={onRemoveCourse}
            onCourseDrop={onCourseDrop}
            onMoveDrag={onMoveDrag}
            eligibility={
              eligibleSlotIds == null
                ? null
                : eligibleSlotIds.has(slot.id)
                  ? "eligible"
                  : "ineligible"
            }
            readOnly={readOnly}
            planOriginQuery={planOriginQuery}
          />
        ),
      )}
    </div>
  );
}

/**
 * Interleaved co-op work term — a single hairline row: bolt mark, CO-OP label,
 * and the calendar season pushed right. The plan model doesn't track a
 * placement, so the season falls back to "Work term".
 */
function CoopTerm({ slot }: { slot: PlanSlot }) {
  const info = slot.termId !== null ? termInfo(slot.termId) : null;
  return (
    <div className="card pw-coop">
      <span className="inline-flex text-accent">
        <Icon name="bolt" size="sm" aria-hidden="true" />
      </span>
      <span className="pw-coop-label">Co-op</span>
      <span className="pw-coop-term">{info?.label ?? "Work term"}</span>
    </div>
  );
}

/**
 * Read-only column for credits the student arrived with. Same width as a term
 * card so it lines up; amber accent marks it as not-a-regular-term.
 */
function PreArrivalColumn({ slot }: { slot: PlanSlot }) {
  return (
    <div className="card pw-term">
      <div className="pw-thead">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="pw-badge"
            style={{
              background: "var(--partial-soft)",
              color: "var(--partial)",
            }}
          >
            Pre
          </span>
          <span className="pw-season truncate">Transfer credits</span>
        </div>
      </div>
      <div className="pw-slots">
        {slot.courses.map((c) => (
          <span key={c.code} className="pw-slot pw-plan">
            <span className="u-mono pw-code truncate">{c.code}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
