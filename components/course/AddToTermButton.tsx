"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TermPicker } from "@/components/planner/picker/TermPicker";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { commitAddCourse } from "@/lib/plan/commitAddCourse";
import { type TermId, termLabel } from "@/lib/terms";

// The button's mutually-exclusive phases as one value, so they can't overlap
// (no "error while the fallback picker is open") and there's no stray message
// string to keep in sync.
type Status = "idle" | "saving" | "error" | "fallback";

/**
 * Detail-page one-click add for `from=picker`: plan + term are known (from the
 * URL), so it adds straight there and returns to the planner. Falls back to the
 * full {@link TermPicker} when the add can't complete (term no longer resolves,
 * already placed, or program-blocked).
 */
export function AddToTermButton({
  course,
  planId,
  term,
  backHref,
}: {
  course: Course;
  planId: string | null;
  term: TermId;
  backHref: string;
}) {
  const router = useRouter();
  const { isAuthed, ready } = useAuthState();
  const [status, setStatus] = useState<Status>("idle");

  const label = termLabel(term);
  const returnToPlan = () => router.push(backHref);

  async function handleClick() {
    // Wait for auth to resolve — an early click would read a stale `isAuthed`
    // and route a signed-in user's add down the local-plan path (wrong plan).
    if (status === "saving" || !ready) return;
    setStatus("saving");
    const res = await commitAddCourse({ isAuthed, planId, term, course });
    if (res.status === "added") {
      returnToPlan();
      return; // navigating away — leave the button disabled during the hop
    }
    // error → inline retry; unresolved / already-placed / blocked → the full
    // picker, where the user can pick a term, see it's placed, or read the block.
    setStatus(res.status === "error" ? "error" : "fallback");
  }

  const saving = status === "saving";
  return (
    <>
      <Button
        variant="primary"
        size="md"
        onClick={handleClick}
        disabled={saving || !ready}
      >
        <Icon name="plusSign" size="sm" />
        {saving ? "Adding…" : `Add to ${label}`}
      </Button>
      {status === "error" ? (
        <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-2">
          Couldn't add to your plan. Try again.
        </p>
      ) : null}
      {status === "fallback" ? (
        <TermPicker
          course={course}
          onClose={() => setStatus("idle")}
          onAdded={returnToPlan}
        />
      ) : null}
    </>
  );
}
