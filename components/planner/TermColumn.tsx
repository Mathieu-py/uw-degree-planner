"use client";

import type { PlanSlot } from "@/lib/plan/types";
import {
  issuesByCourseInSlot,
  type ValidationIssue,
} from "@/lib/plan/validate";
import { termInfo } from "@/lib/terms";
import { Slot } from "./Slot";

interface Props {
  slot: PlanSlot;
  issues: ValidationIssue[];
  onClick: () => void;
  onRemoveCourse: (code: string) => void;
}

function positionLabel(position: PlanSlot["position"]): string {
  if (position === "pre") return "Pre-arrival";
  if (position.startsWith("coop")) {
    const n = position.slice(4);
    return `Co-op ${n}`;
  }
  return position;
}

export function TermColumn({ slot, issues, onClick, onRemoveCourse }: Props) {
  const info = slot.termId !== null ? termInfo(slot.termId) : null;
  const isCoop = slot.isCoop;
  const { byCourse, slotLevel } = issuesByCourseInSlot(issues);

  return (
    <div className="w-40 shrink-0 flex flex-col gap-2">
      <div className="flex flex-col px-1">
        <span
          className={
            "text-xs uppercase tracking-wider " +
            (isCoop
              ? "text-blue-700 dark:text-blue-300"
              : "text-zinc-500 dark:text-zinc-400")
          }
        >
          {positionLabel(slot.position)}
        </span>
        <span className="text-sm font-medium">{info?.label ?? "—"}</span>
        {slotLevel.length > 0 ? (
          <span
            className="text-[10px] mt-0.5 text-rose-700 dark:text-rose-300"
            title={slotLevel.map((i) => i.message).join("\n")}
          >
            ⚠ {slotLevel.map((i) => labelForKind(i.kind)).join(", ")}
          </span>
        ) : null}
      </div>
      <Slot
        slot={slot}
        issuesByCourse={byCourse}
        onAdd={onClick}
        onRemoveCourse={onRemoveCourse}
      />
    </div>
  );
}

function labelForKind(kind: ValidationIssue["kind"]): string {
  switch (kind) {
    case "overload":
      return "overload";
    case "prereq":
      return "prereq";
    case "antireq":
      return "antireq";
    case "coreq":
      return "coreq";
  }
}
