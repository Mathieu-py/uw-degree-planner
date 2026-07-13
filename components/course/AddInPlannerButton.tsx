"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TermPicker } from "@/components/catalog/TermPicker";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";
import type { TermId } from "@/lib/terms";
import { AddToTermButton } from "./AddToTermButton";

/**
 * "Add to plan" CTA on the course detail page. Behaviour keys off where the
 * user arrived from (the `from` query contract, see {@link lib/plan/courseOrigin}):
 * - `plan`   — course already placed → nothing to add (hidden).
 * - `picker` — plan + term already chosen → one-click {@link AddToTermButton}.
 * - else (`catalog` / direct) — open the shared {@link TermPicker} in place;
 *   from the catalog, return to it after adding.
 */
export function AddInPlannerButton({
  course,
  from,
  planId,
  term,
  backHref,
}: {
  course: Course;
  from?: string;
  planId?: string;
  term?: TermId;
  backHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // The course is already in the plan the user came from — nothing to add.
  if (from === "plan") return null;

  // From the slot picker: the plan + target term are known, so add in one click.
  if (from === "picker" && term != null) {
    return (
      <AddToTermButton
        course={course}
        planId={planId ?? null}
        term={term}
        backHref={backHref ?? "/plan"}
      />
    );
  }

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
          // catalog → back to catalog; picker with no resolvable term (pre-arrival
          // slot) → back to the planner; direct visit → stay.
          onAdded={
            from === "catalog"
              ? () => router.push("/catalog")
              : from === "picker"
                ? () => router.push(backHref ?? "/plan")
                : undefined
          }
        />
      ) : null}
    </>
  );
}
