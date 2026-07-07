"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";

/**
 * Shared chrome for the two course→term "add" modals (TermPicker and
 * TermChoiceModal). Owns the shell, the "{heading} · CODE · name" header, and
 * the footer that flips to "Added to … ✓" once `addedTo` is set; the option list
 * is `children`. Caller owns the exit lifecycle via `useModalExit` (same
 * contract as {@link Modal}); `heading` is a prop so the catalog flow can flip it.
 */
export function CourseTermModalShell({
  course,
  heading,
  titleId,
  isClosing,
  onClose,
  addedTo,
  children,
}: {
  course: Course;
  heading: string;
  titleId: string;
  isClosing: boolean;
  onClose: () => void;
  addedTo: string | null;
  children: ReactNode;
}) {
  const niceCode = formatCourseCode(course.code);
  return (
    <Modal
      isClosing={isClosing}
      onClose={onClose}
      titleId={titleId}
      className="max-w-md"
    >
      <header className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-3">
            {heading}
          </div>
          <h2 id={titleId} className="text-sm font-medium truncate">
            <span className="u-mono">{niceCode}</span> · {course.name}
          </h2>
        </div>
        <Button variant="icon" onClick={onClose} aria-label="Close">
          <Icon name="close" size="md" aria-hidden="true" />
        </Button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-2">{children}</div>

      <footer className="border-t border-line px-4 py-2.5">
        <span className="u-small">
          {addedTo ? (
            <span className="text-met inline-flex items-center gap-1">
              Added to {addedTo}
              <Icon name="check" size="xs" aria-hidden="true" />
            </span>
          ) : (
            "Ineligible terms are disabled"
          )}
        </span>
      </footer>
    </Modal>
  );
}
