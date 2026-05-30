"use client";

import Link from "next/link";
import { memo } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatCourseCode } from "@/lib/format";
import type { PlanSlot } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";

interface Props {
  slot: PlanSlot;
  issuesByCourse: ReadonlyMap<string, ValidationIssue[]>;
  onAdd: () => void;
  onRemoveCourse: (code: string) => void;
  readOnly?: boolean;
}

/**
 * One term's worth of courses. Empty area is clickable to open the picker;
 * each placed course shows a small × to remove it and, if it has any
 * validation issues (prereq, antireq, coreq), a ⚠ on the code row plus
 * the issue message(s) listed underneath. Hover for the full text.
 *
 * Co-op slots are inert — no courses, no picker.
 */
export const SlotBody = memo(function SlotBody({
  slot,
  issuesByCourse,
  onAdd,
  onRemoveCourse,
  readOnly = false,
}: Props) {
  if (slot.isCoop) {
    return (
      <div className="min-h-32 rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-3 text-xs text-blue-800 dark:text-blue-200">
        Work term
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1">
      <div
        className={
          "min-h-0 overflow-y-auto flex flex-col gap-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
          (slot.courses.length === 0 ? "" : "flex-1")
        }
      >
        {slot.courses.map((c) => {
          const courseIssues = issuesByCourse.get(c.code) ?? [];
          const hasIssue = courseIssues.length > 0;
          const issueTitle = courseIssues.map((i) => i.message).join("\n");
          return (
            <div
              key={`${slot.id}:${c.code}`}
              className={
                "rounded-md border px-2 py-1.5 text-sm font-mono flex items-start justify-between gap-2 group " +
                (hasIssue
                  ? "border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20"
                  : "border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40")
              }
            >
              <span className="flex flex-col gap-1 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  {hasIssue ? (
                    <span
                      role="img"
                      aria-label={`Validation issue: ${issueTitle}`}
                      title={issueTitle}
                      className="shrink-0 text-rose-600 dark:text-rose-400 cursor-help"
                    >
                      <span aria-hidden="true">⚠</span>
                    </span>
                  ) : null}
                  <Link
                    href={`/course/${c.code}`}
                    target="_blank"
                    rel="noopener"
                    title={`Open ${c.code} details (new tab)`}
                    className="truncate tracking-tight hover:underline underline-offset-2"
                  >
                    {formatCourseCode(c.code)}
                  </Link>
                </span>
                {hasIssue ? (
                  <ul className="font-sans text-[11px] font-medium text-rose-600 dark:text-rose-400 leading-relaxed space-y-1">
                    {courseIssues.map((i) => (
                      <li key={i.kind} className="truncate" title={i.message}>
                        {i.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {c.grade ? (
                  <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                    {c.grade}
                  </span>
                ) : null}
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRemoveCourse(c.code)}
                    aria-label={`Remove ${c.code}`}
                    title={`Remove ${c.code}`}
                    className="text-zinc-400 hover:text-rose-600 dark:text-zinc-600 dark:hover:text-rose-400 opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition"
                  >
                    <Icon name="close" size="sm" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {readOnly && slot.courses.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">
            —
          </div>
        ) : null}
      </div>
      {readOnly ? null : (
        <button
          type="button"
          onClick={onAdd}
          className={
            "text-xs rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 hover:border-zinc-400 hover:bg-zinc-50 dark:hover:text-zinc-50 dark:hover:border-zinc-500 dark:hover:bg-zinc-900/40 transition-colors py-3 px-2 text-center " +
            (slot.courses.length === 0 ? "flex-1" : "shrink-0")
          }
        >
          + Add course
        </button>
      )}
    </div>
  );
});
