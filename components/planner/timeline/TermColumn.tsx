"use client";

import { memo, useCallback, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type CourseDragData,
  courseDragKind,
  hasCourseDrag,
  readCourseDrag,
} from "@/lib/plan/dnd";
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
  onCourseDrop?: (toSlotId: string, data: CourseDragData) => void;
  /** Bubbles a between-term move drag (or null on end) up for the eligibility highlight. */
  onMoveDrag?: (moving: { code: string; fromSlotId: string } | null) => void;
  readOnly?: boolean;
  /**
   * Drag highlight: "eligible" tints green, "ineligible" mutes, null clears.
   * Advisory only — drops still land on any academic term.
   */
  eligibility?: "eligible" | "ineligible" | null;
  /** Forwarded to SlotBody's course-detail links — see {@link SlotBody}. */
  planOriginQuery?: string;
}

export const TermColumn = memo(function TermColumn({
  slot,
  issues,
  onSlotClick,
  onRemoveCourse,
  onCourseDrop,
  onMoveDrag,
  readOnly = false,
  eligibility = null,
  planOriginQuery,
}: Props) {
  const info = slot.termId !== null ? termInfo(slot.termId) : null;
  const { byCourse, slotLevel } = issuesByCourseInSlot(issues);
  const filled = slot.courses.length;

  // Bind slotId here so SlotBody gets stable zero/one-arg callbacks (and its
  // memo holds) while the parent's handlers stay slotId-keyed.
  const slotId = slot.id;
  const handleAdd = useCallback(
    () => onSlotClick(slotId),
    [onSlotClick, slotId],
  );
  const handleRemoveCourse = useCallback(
    (code: string) => onRemoveCourse(slotId, code),
    [onRemoveCourse, slotId],
  );

  // Drop target: highlight while one of our chips hovers, add/move on drop.
  // Disabled entirely in read-only views (no onCourseDrop).
  const [dropActive, setDropActive] = useState(false);
  const droppable = !readOnly && !!onCourseDrop;
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasCourseDrag(e)) return;
    e.preventDefault(); // required so the drop event fires
    e.dataTransfer.dropEffect = courseDragKind(e) === "add" ? "copy" : "move";
    setDropActive(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Ignore leaves into descendant chips; only clear on a real exit.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropActive(false);
    }
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropActive(false);
      const data = readCourseDrag(e);
      if (data) onCourseDrop?.(slotId, data);
    },
    [onCourseDrop, slotId],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone for course chips; the keyboard-accessible path is the + add / × remove buttons.
    <div
      // is-drop last so a hovered eligible column reads as the active target.
      className={`card pw-term${
        eligibility === "eligible"
          ? " pw-term-eligible"
          : eligibility === "ineligible"
            ? " pw-term-muted"
            : ""
      }${dropActive ? " is-drop" : ""}`}
      onDragOver={droppable ? handleDragOver : undefined}
      onDragLeave={droppable ? handleDragLeave : undefined}
      onDrop={droppable ? handleDrop : undefined}
    >
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
              <Icon name="warning" size="sm" aria-hidden="true" />
            </span>
          ) : null}
          <span className="u-mono u-small" style={{ color: "var(--ink-3)" }}>
            {filled}
          </span>
        </div>
      </div>
      <SlotBody
        slot={slot}
        issuesByCourse={byCourse}
        onAdd={handleAdd}
        onRemoveCourse={handleRemoveCourse}
        onMoveDrag={onMoveDrag}
        readOnly={readOnly}
        planOriginQuery={planOriginQuery}
      />
    </div>
  );
});
