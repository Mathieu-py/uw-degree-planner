"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TermPicker } from "@/components/catalog/TermPicker";
import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";

/**
 * "Add to plan" CTA on the course detail page. Opens the shared
 * {@link TermPicker} in place, then returns to the catalog once added. Hidden
 * when arriving from a plan (`?from=plan`) — the course is already placed.
 */
export function AddInPlannerButton({
  course,
  from,
}: {
  course: Course;
  from?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // The course is already in the plan the user came from — nothing to add.
  if (from === "plan") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 h-[42px] px-[18px] rounded-[9px] bg-primary text-primary-ink text-sm font-semibold hover:bg-primary-hover"
      >
        <Icon name="plusSign" size="sm" />
        Add to plan
      </button>
      {open ? (
        <TermPicker
          course={course}
          onClose={() => setOpen(false)}
          // From the catalog → back to it after adding; a direct visit just
          // closes and stays.
          onAdded={
            from === "catalog" ? () => router.push("/catalog") : undefined
          }
        />
      ) : null}
    </>
  );
}
