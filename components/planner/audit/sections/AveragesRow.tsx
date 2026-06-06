import { type Averages, MIN_GRADED_FOR_AVERAGE } from "@/lib/audit/averages";

/**
 * Compact averages line in the audit header. Shows the unit-weighted
 * cumulative and major percentages once computable; while there are graded
 * courses but too few to be meaningful, it says so rather than showing a
 * misleading number. Renders nothing when no grades exist yet.
 */
export function AveragesRow({ averages }: { averages: Averages }) {
  const { cumulative, major } = averages;
  if (cumulative.value === null) {
    if (cumulative.countedCourses === 0) return null;
    return (
      <div className="av-note">
        Averages available after {MIN_GRADED_FOR_AVERAGE} graded courses (
        {cumulative.countedCourses} so far).
      </div>
    );
  }
  return (
    <div className="av-note u-mono">
      Cumulative {cumulative.value}%
      {major.value !== null ? <> · Major {major.value}%</> : null}
    </div>
  );
}
