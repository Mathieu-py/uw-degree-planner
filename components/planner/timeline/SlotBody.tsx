"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { PlanSlot } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";

interface Props {
  slot: PlanSlot;
  issuesByCourse: ReadonlyMap<string, ValidationIssue[]>;
  onAdd: () => void;
  onRemoveCourse: (code: string) => void;
  readOnly?: boolean;
}

// Visual placeholder rows shown in an empty term, sized to roughly the
// typical UW course load. Each row opens the same picker; the data model is
// still one slot per term.
const PLACEHOLDER_ROWS = 5;

/**
 * One term's worth of courses. Empty area is clickable to open the picker;
 * each placed course shows a small × to remove it and a ⚠ if it has any
 * validation issues (prereq, antireq, coreq). Hover the badge to see details.
 *
 * Co-op slots are inert — no courses, no picker.
 */
export function SlotBody({
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

  const placeholderCount = Math.max(0, PLACEHOLDER_ROWS - slot.courses.length);

  return (
    <div className="flex flex-col gap-1.5">
      {slot.courses.map((c) => {
        const courseIssues = issuesByCourse.get(c.code) ?? [];
        const hasIssue = courseIssues.length > 0;
        const issueTitle = courseIssues.map((i) => i.message).join("\n");
        return (
          <div
            key={`${slot.id}:${c.code}`}
            className={
              "rounded border px-2 py-1 text-xs font-mono flex items-center justify-between gap-2 group " +
              (hasIssue
                ? "border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20"
                : "border-zinc-200 dark:border-zinc-800")
            }
          >
            <span className="truncate flex items-center gap-1.5 min-w-0">
              {hasIssue ? (
                <span
                  role="img"
                  aria-label={`Validation issue: ${issueTitle}`}
                  title={issueTitle}
                  className="text-rose-600 dark:text-rose-400 cursor-help"
                >
                  <span aria-hidden="true">⚠</span>
                </span>
              ) : null}
              <Link
                href={`/course/${c.code}`}
                target="_blank"
                rel="noopener"
                title={`Open ${c.code} details (new tab)`}
                className="truncate hover:underline underline-offset-2"
              >
                {c.code}
              </Link>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {c.grade ? (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {c.grade}
                </span>
              ) : null}
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => onRemoveCourse(c.code)}
                  aria-label={`Remove ${c.code}`}
                  title={`Remove ${c.code}`}
                  className="text-zinc-300 hover:text-rose-600 dark:text-zinc-700 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  <Icon name="close" size="xs" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {readOnly ? (
        slot.courses.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">
            —
          </div>
        ) : null
      ) : (
        Array.from({ length: placeholderCount }, (_, i) => (
          <button
            // Placeholder index keys are stable for a given term — the row
            // count only changes when the user adds/removes a course.
            // biome-ignore lint/suspicious/noArrayIndexKey: index is stable
            key={`add-${i}`}
            type="button"
            onClick={onAdd}
            className="text-xs rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 hover:border-zinc-400 hover:bg-zinc-50 dark:hover:text-zinc-50 dark:hover:border-zinc-500 dark:hover:bg-zinc-900/40 transition-colors py-3 px-2 text-center"
          >
            + Add course
          </button>
        ))
      )}
    </div>
  );
}
