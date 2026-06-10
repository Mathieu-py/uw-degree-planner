import { countNoun } from "@/lib/format";

interface Props {
  /** Program's calendar entry states no total units → denominator estimated. */
  estimatedDenom: boolean;
  /** Structured requirements that couldn't be auto-verified. */
  unverifiedCount: number;
  /** Plan-wide prereq/antireq placement issues (shown the same on each program). */
  blockingIssueCount: number;
}

/**
 * The advisory `av-note` block under an audit headline — estimated denominator,
 * unverified requirements, and blocking placement issues. Shared by the
 * single-program card ({@link ProgramAuditCard}) and the master·detail pane
 * ({@link AuditPanel}) so the wording stays in one place.
 */
export function AuditAdvisoryNotes({
  estimatedDenom,
  unverifiedCount,
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
      {unverifiedCount > 0 ? (
        <div className="av-note">
          {countNoun(unverifiedCount, "requirement")} couldn&apos;t be
          auto-verified — check with your advisor.
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
