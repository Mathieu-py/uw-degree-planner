import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { countNoun } from "@/lib/format";

interface Props {
  /** Program's calendar entry states no total units → denominator estimated. */
  estimatedDenom: boolean;
  /** Plan-wide prereq/antireq placement issues (shown the same on each program). */
  blockingIssueCount: number;
  /** "Add a partner plan" copy when a lone Joint Honours plan is unpaired (#111). */
  jointHonoursPartner?: string | null;
}

/**
 * The advisory `av-note` block under an audit headline — estimated denominator
 * and blocking placement issues. Shared by the single-program card
 * ({@link ProgramAuditCard}) and the master·detail pane ({@link AuditPanel}) so
 * the wording stays in one place. Unverified requirements are surfaced
 * separately as acknowledgeable rows ({@link UnverifiedRequirements}).
 */
export function AuditAdvisoryNotes({
  estimatedDenom,
  blockingIssueCount,
  jointHonoursPartner,
}: Props) {
  return (
    <>
      {jointHonoursPartner ? (
        <WarningNote>{jointHonoursPartner}</WarningNote>
      ) : null}
      {estimatedDenom ? (
        <div className="av-note">
          This program&apos;s calendar entry states no total unit count, so the
          denominator is estimated from its listed requirements.
        </div>
      ) : null}
      {blockingIssueCount > 0 ? (
        <WarningNote>
          {countNoun(blockingIssueCount, "placement issue")} (prereq/antireq) —
          until resolved, an antireq conflict counts once toward the bar and a
          course placed before its prereqs is held out.
        </WarningNote>
      ) : null}
    </>
  );
}

/** Advisory `av-note` with the shared warning-icon leader. */
function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div className="av-note text-partial flex items-start gap-1.5">
      <Icon
        name="warning"
        size="xs"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />
      <span>{children}</span>
    </div>
  );
}
