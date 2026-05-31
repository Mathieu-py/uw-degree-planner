"use client";

import { memo, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import type { PlanSlot } from "@/lib/plan/types";
import {
  issuesByCourseInSlot,
  type ValidationIssue,
} from "@/lib/plan/validate";
import { termInfo } from "@/lib/terms";
import { SlotBody } from "./SlotBody";

interface Props {
  slot: PlanSlot;
  issues: ValidationIssue[];
  onSlotClick: (slotId: string) => void;
  onRemoveCourse: (slotId: string, code: string) => void;
  readOnly?: boolean;
}

export const TermColumn = memo(function TermColumn({
  slot,
  issues,
  onSlotClick,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  const info = slot.termId !== null ? termInfo(slot.termId) : null;
  const { byCourse, slotLevel } = issuesByCourseInSlot(issues);
  const filled = slot.courses.length;
  const allDone = filled > 0 && slot.courses.every((c) => !!c.grade);

  // Bind the slot id here so the parent's handlers stay referentially stable
  // across edits (they take a slotId) while SlotBody still gets the simple
  // zero/one-arg callbacks it expects — both stable, so SlotBody's memo holds.
  const slotId = slot.id;
  const handleAdd = useCallback(
    () => onSlotClick(slotId),
    [onSlotClick, slotId],
  );
  const handleRemoveCourse = useCallback(
    (code: string) => onRemoveCourse(slotId, code),
    [onRemoveCourse, slotId],
  );

  return (
    <div className="card pw-term">
      <div className="pw-thead">
        <div className="flex items-center gap-2 min-w-0">
          <span className="pw-badge">{slot.position}</span>
          <span className="pw-season truncate">{info?.label ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {slotLevel.length > 0 ? (
            <span
              className="inline-flex items-center text-partial"
              title={slotLevel.map((i) => i.message).join("\n")}
            >
              <Icon name="warning" size="xs" aria-hidden="true" />
            </span>
          ) : null}
          <span
            className="u-mono u-small"
            style={{ color: allDone ? "var(--met)" : "var(--ink-3)" }}
          >
            {filled}
          </span>
        </div>
      </div>
      <SlotBody
        slot={slot}
        issuesByCourse={byCourse}
        onAdd={handleAdd}
        onRemoveCourse={handleRemoveCourse}
        readOnly={readOnly}
      />
    </div>
  );
});
