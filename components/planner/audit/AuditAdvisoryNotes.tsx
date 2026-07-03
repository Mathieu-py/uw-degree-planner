import { countNoun } from "@/lib/format";

interface Props {
  /** Program's calendar entry states no total units → denominator estimated. */
  estimatedDenom: boolean;
  /** Plan-wide prereq/antireq placement issues (shown the same on each program). */
  blockingIssueCount: number;
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
}: Props) {
  return (
    <>
      {estimatedDenom ? (
        <div className="av-note">
          This program&apos;s calendar entry states no total unit count, so the
          denominator is estimated from its listed requirements.
        </div>
      ) : null}
      {blockingIssueCount > 0 ? (
        <div className="av-note text-partial">
          ⚠ {countNoun(blockingIssueCount, "placement issue")} (prereq/antireq)
          — until resolved, an antireq conflict counts once toward the bar and a
          course placed before its prereqs is held out.
        </div>
      ) : null}
    </>
  );
}
