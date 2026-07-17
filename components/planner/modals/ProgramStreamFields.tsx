"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { jointHonoursWarning } from "@/lib/plan/jointHonours";
import type { ProgramOption } from "@/lib/programs";
import { DoubleDegreeSuggestion } from "./DoubleDegreeSuggestion";
import { ProgramMultiSelect } from "./ProgramMultiSelect";

interface Props {
  programOptions: ProgramOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Collapse to a packaged double degree; the caller re-runs its stream suggestion. */
  onAcceptDoubleDegree: (doubleDegreeId: string) => void;
  /**
   * Caller-specific hint shown in place of the joint-honours banner (e.g. a
   * "pick a program" prompt or a double-degree note); the two never apply at once.
   */
  note?: ReactNode;
}

/**
 * The program-selection trio shared by onboarding and plan settings:
 * multi-select, a joint-honours "half a degree" banner, and the double-degree
 * collapse suggestion.
 */
export function ProgramStreamFields({
  programOptions,
  selected,
  onChange,
  onAcceptDoubleDegree,
  note,
}: Props) {
  // A lone Joint Honours plan is only half a degree — prompt for a partner.
  const jointHonoursPartner = jointHonoursWarning(selected);
  return (
    <>
      <ProgramMultiSelect
        programOptions={programOptions}
        selected={selected}
        onChange={onChange}
      />
      {jointHonoursPartner ? (
        <p className="flex items-start gap-1.5 rounded-[8px] border border-partial bg-partial-soft px-3 py-2 text-xs text-ink-2">
          <Icon
            name="warning"
            size="xs"
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-partial"
          />
          <span>{jointHonoursPartner}</span>
        </p>
      ) : (
        note
      )}
      <DoubleDegreeSuggestion
        programIds={selected}
        onAccept={onAcceptDoubleDegree}
      />
    </>
  );
}
