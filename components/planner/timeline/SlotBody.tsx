"use client";

import Link from "next/link";
import { memo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { PlanSlot, SlotCourse } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";

interface Props {
  slot: PlanSlot;
  issuesByCourse: ReadonlyMap<string, ValidationIssue[]>;
  onRemoveCourse: (code: string) => void;
  /** Reports a chip being dragged between terms (or null on end) for the highlight. */
  onMoveDrag?: (moving: { code: string; fromSlotId: string } | null) => void;
  readOnly?: boolean;
  /** `?from=plan` appended to course links so the detail page knows they came
   *  from a plan (and hides its "Add to plan"). Omitted by the shared view. */
  planOriginQuery?: string;
}

type SlotStatus = "plan" | "warn";

// A graded course is already taken, so a stale prereq flag stays quiet; an
// outstanding issue on an ungraded course makes it "warn", otherwise "plan".
function courseStatus(course: SlotCourse, hasIssue: boolean): SlotStatus {
  return !course.grade && hasIssue ? "warn" : "plan";
}

/**
 * One term's placed courses as status-colored slots (plan/warn); empty terms
 * show a muted "No courses yet" line. Each slot shows its status glyph and
 * reveals view (↗) + remove (×) on hover; warn slots list their messages inline.
 * Adding is driven from TermColumn's header "+" square, not from here.
 */
export const SlotBody = memo(function SlotBody({
  slot,
  issuesByCourse,
  onRemoveCourse,
  onMoveDrag,
  readOnly = false,
  planOriginQuery = "",
}: Props) {
  // Chip being dragged out of this term, dimmed while in flight; cleared on
  // dragend.
  const [draggingCode, setDraggingCode] = useState<string | null>(null);

  // A drop unmounts the source chip, so its `dragend` never fires and
  // `draggingCode` is left stale — clear it whenever the term's course set
  // changes (covers the chip's leave and any return).
  const coursesRef = useRef(slot.courses);
  if (coursesRef.current !== slot.courses) {
    coursesRef.current = slot.courses;
    if (draggingCode !== null) setDraggingCode(null);
  }

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
                onStart: () => {
                  setDraggingCode(c.code);
                  onMoveDrag?.({ code: c.code, fromSlotId: slot.id });
                },
                onEnd: () => {
                  setDraggingCode(null);
                  onMoveDrag?.(null);
                },
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
                {status === "warn" ? (
                  <span
                    className="pw-ic pw-stat"
                    style={{ color: "var(--partial)" }}
                  >
                    <Icon name="bolt" size="xs" aria-hidden="true" />
                  </span>
                ) : null}
                <Link
                  href={`/course/${c.code}${planOriginQuery}`}
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
                  <li key={i.kind} className="break-words" title={i.message}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {slot.courses.length === 0 ? (
        <div className="pw-empty-hint">No courses yet</div>
      ) : null}
    </div>
  );
});
