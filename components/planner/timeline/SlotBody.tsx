"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { PlanSlot, SlotCourse } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";

interface Props {
  slot: PlanSlot;
  issuesByCourse: ReadonlyMap<string, ValidationIssue[]>;
  onAdd: () => void;
  onRemoveCourse: (code: string) => void;
  readOnly?: boolean;
}

type SlotStatus = "done" | "plan" | "warn";

// A graded course is one the student has completed (transcript-imported pass),
// so it reads as "done" regardless of any stale prereq flag. Otherwise an
// outstanding validation issue makes it "warn" (amber); else it's "plan".
function courseStatus(course: SlotCourse, hasIssue: boolean): SlotStatus {
  if (course.grade) return "done";
  if (hasIssue) return "warn";
  return "plan";
}

/**
 * One term's placed courses, rendered as the design's status-colored slots
 * (done = green / plan = neutral / warn = amber) plus a single dashed
 * "+ add course" affordance. Each filled slot shows its status glyph by
 * default and reveals view (↗) + remove (×) actions on hover. Warn slots list
 * their validation message(s) inline so the problem is visible at a glance.
 */
export const SlotBody = memo(function SlotBody({
  slot,
  issuesByCourse,
  onAdd,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  // Code of the chip currently being dragged out of this term, so we can dim
  // it while it's in flight. Cleared on dragend (drop or cancel).
  const [draggingCode, setDraggingCode] = useState<string | null>(null);
  return (
    <div className="pw-slots">
      {slot.courses.map((c) => {
        const courseIssues = issuesByCourse.get(c.code) ?? [];
        const hasIssue = courseIssues.length > 0;
        const status = courseStatus(c, hasIssue);
        const issueText = courseIssues.map((i) => i.message).join("\n");
        const code = formatCourseCode(c.code);
        const isDragging = draggingCode === c.code;
        const dragProps = readOnly
          ? null
          : courseDragProps(
              { kind: "move", fromSlotId: slot.id, code: c.code },
              {
                onStart: () => setDraggingCode(c.code),
                onEnd: () => setDraggingCode(null),
              },
            );
        return (
          <div
            key={`${slot.id}:${c.code}`}
            className={`pw-slot pw-${status}${isDragging ? " is-dragging" : ""}`}
            title={status === "warn" ? issueText : code}
            {...dragProps}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="u-mono pw-code truncate min-w-0">{code}</span>
              <span className="pw-slot-actions">
                {status === "done" ? (
                  <span
                    className="pw-ic pw-stat"
                    style={{ color: "var(--met)" }}
                  >
                    <Icon name="check" size="xs" aria-hidden="true" />
                  </span>
                ) : status === "warn" ? (
                  <span
                    className="pw-ic pw-stat"
                    style={{ color: "var(--partial)" }}
                  >
                    <Icon name="bolt" size="xs" aria-hidden="true" />
                  </span>
                ) : null}
                <Link
                  href={`/course/${c.code}`}
                  target="_blank"
                  rel="noopener"
                  draggable={false}
                  className="pw-slot-btn"
                  title={`View ${code} details (new tab)`}
                >
                  <Icon name="external" size="xs" aria-hidden="true" />
                </Link>
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRemoveCourse(c.code)}
                    draggable={false}
                    aria-label={`Remove ${code}`}
                    title={`Remove ${code}`}
                    className="pw-slot-btn pw-slot-x"
                  >
                    <Icon name="close" size="sm" aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>
            {status === "warn" && courseIssues.length > 0 ? (
              <ul className="font-sans text-[10px] font-medium leading-snug text-partial space-y-0.5">
                {courseIssues.map((i) => (
                  <li key={i.kind} className="truncate" title={i.message}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {readOnly ? null : (
        <button type="button" onClick={onAdd} className="pw-slot pw-empty">
          + add course
        </button>
      )}
    </div>
  );
});
