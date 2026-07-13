import Link from "next/link";
import { notFound } from "next/navigation";
import { AddInPlannerButton } from "@/components/course/AddInPlannerButton";
import { Icon } from "@/components/ui/Icon";
import { loadCourseByCode } from "@/lib/courses/data";
import { seatsAvailable } from "@/lib/courses/filters";
import { getRatingColor } from "@/lib/courses/ratingColor";
import { countNoun, formatCourseCode, formatPercent } from "@/lib/format";
import { parseCourseOrigin } from "@/lib/plan/courseOrigin";
import { describePrereqParts } from "@/lib/prereqs/describe";
import { PINNED_TERM as TERM, termLabel } from "@/lib/terms";

export async function generateMetadata(props: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await props.params;
  const course = await loadCourseByCode(TERM, code);
  if (!course) return { title: "Course not found" };
  return {
    title: `${formatCourseCode(course.code)} — ${course.name}`,
    description: course.description?.slice(0, 160) ?? undefined,
  };
}

export default async function CoursePage(props: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; planId?: string; term?: string }>;
}) {
  const { code } = await props.params;
  const { from, planId, term } = parseCourseOrigin(await props.searchParams);
  const course = await loadCourseByCode(TERM, code);
  if (!course) notFound();

  // "← Back" goes to the catalog when the user came from it, else the planner
  // (the exact plan if a planId was passed; else generic /plan).
  const plannerHref = planId ? `/plan/${encodeURIComponent(planId)}` : "/plan";
  const fromCatalog = from === "catalog";
  const backHref = fromCatalog ? "/catalog" : plannerHref;
  const backLabel = fromCatalog ? "Back to catalog" : "Back to planner";

  const rating = course.rating;
  const hasRatings =
    rating && rating.filled_count != null && rating.filled_count > 0;
  const totalSeats = seatsAvailable(course) ?? 0;
  const uwflowUrl = `https://uwflow.com/course/${course.code}`;

  return (
    <div className="mx-auto max-w-5xl w-full px-6 py-10">
      <Link
        href={backHref}
        className="text-sm text-ink-2 hover:text-ink w-fit inline-flex items-center gap-1.5"
      >
        ← {backLabel}
      </Link>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <span className="u-mono text-xs uppercase tracking-wider text-ink-3">
              {formatCourseCode(course.code)} · {termLabel(TERM)}
            </span>
            <h1 className="u-h1 text-[34px]">{course.name}</h1>
          </header>

          {course.description ? (
            <p className="u-body whitespace-pre-line">{course.description}</p>
          ) : null}

          <section className="grid sm:grid-cols-3 gap-3">
            <ReqCard
              label="Prerequisites"
              lines={describePrereqParts(course.prereqAst)}
              value={course.prereqs}
            />
            <ReqCard
              label="Corequisites"
              lines={describePrereqParts(course.coreqAst)}
              value={course.coreqs}
            />
            <ReqCard
              label="Antirequisites"
              lines={
                course.antireqCodes && course.antireqCodes.length > 0
                  ? [course.antireqCodes.map(formatCourseCode).join(", ")]
                  : null
              }
              // Empty antireqCodes = Kuali's authoritative "none"; suppress the
              // stale UWFlow prose for it.
              value={
                course.antireqCodes && course.antireqCodes.length === 0
                  ? null
                  : course.antireqs
              }
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="u-h3">Sections in {termLabel(TERM)}</h2>
            {course.sections.length === 0 ? (
              <p className="text-sm text-ink-3">No sections scheduled.</p>
            ) : (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-line text-sm">
                  <span className="text-ink-2">
                    {countNoun(course.sections.length, "section")}
                  </span>
                  <span className={totalSeats > 0 ? "text-met" : "text-ink-3"}>
                    {totalSeats > 0 ? `${totalSeats} seats open` : "Full"}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {course.sections.map((s) => {
                    const open = Math.max(
                      0,
                      s.enrollment_capacity - s.enrollment_total,
                    );
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between px-4 py-2 text-xs tabular-nums"
                      >
                        <span className="u-mono text-ink">#{s.id}</span>
                        <span className="text-ink-2">
                          {s.enrollment_total}/{s.enrollment_capacity}
                          {open > 0 ? (
                            <span className="text-met"> · {open} open</span>
                          ) : (
                            <span className="text-ink-3"> · full</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* Sticky add rail */}
        <aside className="lg:sticky lg:top-20 card p-5 flex flex-col gap-5">
          {hasRatings ? (
            <div className="flex flex-col gap-3">
              <RatingRow label="Useful" value={rating.useful} />
              <RatingRow label="Easy" value={rating.easy} />
              <RatingRow label="Liked" value={rating.liked} />
              <p className="u-small">
                Based on {countNoun(rating.filled_count ?? 0, "UWFlow review")}
              </p>
            </div>
          ) : (
            <p className="u-small">No UWFlow ratings yet.</p>
          )}

          <div className="h-px bg-line" />

          <AddInPlannerButton
            course={course}
            from={from}
            planId={planId}
            term={term}
            backHref={plannerHref}
          />
          <a
            href={uwflowUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-2 h-[42px] px-[18px] rounded-[9px] border border-line-2 text-ink text-sm font-semibold hover:bg-bg-2"
          >
            View on UWFlow
            <Icon name="external" size="sm" />
          </a>
        </aside>
      </div>
    </div>
  );
}

function RatingRow({ label, value }: { label: string; value: number | null }) {
  const color = getRatingColor(value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="inline-flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        <span className="u-mono text-sm font-semibold tabular-nums">
          {value == null ? "—" : formatPercent(value)}
        </span>
      </span>
    </div>
  );
}

/** Lowercased alphanumerics only, for "is the prose just the parts re-worded" checks. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ReqCard({
  label,
  lines,
  value,
}: {
  label: string;
  // Structured requirement parts (one per top-level AND clause); preferred over
  // `value` when present so grouping shows as separate lines, not brackets.
  lines?: string[] | null;
  // Verbatim calendar prose. Sole content with no structured tree; otherwise a
  // footnote under the parts, since the AST drops grade thresholds/qualifiers
  // ("60% in CS 135", "taken prior to fall 2013") the student still needs.
  value?: string | null;
}) {
  const parts = lines && lines.length > 0 ? lines : null;
  const text = value && value.trim() !== "" ? value : null;
  // Skip the footnote when the prose is just the parts re-worded.
  const proseNote =
    parts && text && squash(text) !== squash(parts.join("; ")) ? text : null;
  return (
    <div className="card-2 border border-line rounded-[14px] p-4 flex flex-col gap-1.5">
      <span className="u-eyebrow">{label}</span>
      {parts ? (
        parts.length === 1 ? (
          <p className="text-[13px] leading-relaxed text-ink">{parts[0]}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px] leading-relaxed text-ink">
            {parts.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are static per course (never reordered); index disambiguates duplicate strings
              <li key={`${part}-${index}`} className="flex gap-2">
                <span aria-hidden className="text-ink-3 select-none">
                  •
                </span>
                <span className="min-w-0">{part}</span>
              </li>
            ))}
          </ul>
        )
      ) : text ? (
        <p className="text-[13px] leading-relaxed text-ink">{text}</p>
      ) : (
        <span className="text-[13px] text-ink-3">None</span>
      )}
      {proseNote ? (
        <p className="text-xs leading-relaxed text-ink-3">
          Calendar: {proseNote}
        </p>
      ) : null}
    </div>
  );
}
