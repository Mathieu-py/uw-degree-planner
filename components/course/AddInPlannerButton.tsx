"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TermPicker } from "@/components/catalog/TermPicker";
import { Button } from "@/components/ui/Button";
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
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Icon name="plusSign" size="sm" />
        Add to plan
      </Button>
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
