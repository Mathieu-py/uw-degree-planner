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

function positionLabel(position: PlanSlot["position"]): string {
  if (position === "pre") return "Pre-arrival";
  if (position.startsWith("coop")) {
    const n = position.slice(4);
    return `Co-op ${n}`;
  }
  return position;
}

export const TermColumn = memo(function TermColumn({
  slot,
  issues,
  onSlotClick,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  const info = slot.termId !== null ? termInfo(slot.termId) : null;
  const isCoop = slot.isCoop;
  const { byCourse, slotLevel } = issuesByCourseInSlot(issues);

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
    <div
      className={
        "w-full lg:h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3 flex flex-col " +
        (slot.courses.length === 0 ? "gap-1" : "gap-2")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold truncate min-w-0">
          {info?.label ?? "—"}
          <span
            className={
              "ml-2 font-medium " +
              (isCoop
                ? "text-blue-700 dark:text-blue-300"
                : "text-zinc-500 dark:text-zinc-400")
            }
          >
            <span className="mr-2">·</span>
            <span>{positionLabel(slot.position)}</span>
          </span>
        </span>
        {slotLevel.length > 0 ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-rose-700 dark:text-rose-300"
            title={slotLevel.map((i) => i.message).join("\n")}
          >
            <Icon name="warning" size="sm" aria-hidden="true" />
            {slotLevel.map((i) => labelForKind(i.kind)).join(", ")}
          </span>
        ) : null}
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

function labelForKind(kind: ValidationIssue["kind"]): string {
  switch (kind) {
    case "overload":
      return "Overload";
    case "prereq":
      return "Prereq";
    case "antireq":
      return "Antireq";
    case "coreq":
      return "Coreq";
  }
}
