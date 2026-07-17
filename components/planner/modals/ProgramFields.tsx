"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { jointHonoursWarning } from "@/lib/plan/jointHonours";
import type { ProgramOption } from "@/lib/programs";
import { DoubleDegreeSuggestion } from "./DoubleDegreeSuggestion";
import { ProgramMultiSelect } from "./ProgramMultiSelect";

interface NoticesProps {
  programIds: string[];
  /** Collapse to a packaged double degree; the caller re-runs its stream suggestion. */
  onAcceptDoubleDegree: (doubleDegreeId: string) => void;
  /** Hint shown when there's no joint-honours banner (e.g. a double-degree note). */
  note?: ReactNode;
}

/**
 * Program warnings shared by the picker and the onboarding review step: the
 * joint-honours banner plus the double-degree suggestion.
 */
export function ProgramNotices({
  programIds,
  onAcceptDoubleDegree,
  note,
}: NoticesProps) {
  // A lone Joint Honours plan is only half a degree — prompt for a partner.
  const jointHonoursPartner = jointHonoursWarning(programIds);
  return (
    <>
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
        programIds={programIds}
        onAccept={onAcceptDoubleDegree}
      />
    </>
  );
}

interface Props {
  programOptions: ProgramOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  onAcceptDoubleDegree: (doubleDegreeId: string) => void;
  note?: ReactNode;
}

/**
 * The program picker shared by onboarding and plan settings: multi-select plus
 * its notices. The co-op stream sits beside this in each caller, not inside it.
 */
export function ProgramFields({
  programOptions,
  selected,
  onChange,
  onAcceptDoubleDegree,
  note,
}: Props) {
  return (
    <>
      <ProgramMultiSelect
        programOptions={programOptions}
        selected={selected}
        onChange={onChange}
      />
      <ProgramNotices
        programIds={selected}
        onAcceptDoubleDegree={onAcceptDoubleDegree}
        note={note}
      />
    </>
  );
}
