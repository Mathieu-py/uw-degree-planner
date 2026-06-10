import Link from "next/link";
import { notFound } from "next/navigation";
import { AddInPlannerButton } from "@/components/course/AddInPlannerButton";
import { Icon } from "@/components/ui/Icon";
import { loadCourseByCode } from "@/lib/courses/data";
import { seatsAvailable } from "@/lib/courses/filters";
import { getRatingColor } from "@/lib/courses/ratingColor";
import { countNoun, formatCourseCode, formatPercent } from "@/lib/format";
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
  searchParams: Promise<{ from?: string; planId?: string }>;
}) {
  const { code } = await props.params;
  const { from, planId } = await props.searchParams;
  const course = await loadCourseByCode(TERM, code);
  if (!course) notFound();

  // Return to the exact plan the user came from when one was passed; otherwise
  // fall back to the generic planner (signed-out local plan, or direct visit).
  const backToPlannerHref = planId
    ? `/plan/${encodeURIComponent(planId)}`
    : "/plan";

  const rating = course.rating;
  const hasRatings =
    rating && rating.filled_count != null && rating.filled_count > 0;
  const totalSeats = seatsAvailable(course) ?? 0;
  const uwflowUrl = `https://uwflow.com/course/${course.code}`;

  return (
    <div className="mx-auto max-w-5xl w-full px-6 py-10">
      <Link
        href={backToPlannerHref}
        className="text-sm text-ink-2 hover:text-ink w-fit inline-flex items-center gap-1.5"
      >
        ← Back to planner
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
            <ReqCard label="Prerequisites" value={course.prereqs} />
            <ReqCard label="Corequisites" value={course.coreqs} />
            <ReqCard label="Antirequisites" value={course.antireqs} />
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

          <AddInPlannerButton course={course} from={from} />
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

function ReqCard({ label, value }: { label: string; value: string | null }) {
  const has = !!value && value.trim() !== "";
  return (
    <div className="card-2 border border-line rounded-[14px] p-4 flex flex-col gap-1.5">
      <span className="u-eyebrow">{label}</span>
      {has ? (
        <p className="text-[13px] leading-relaxed text-ink">{value}</p>
      ) : (
        <span className="text-[13px] text-ink-3">None</span>
      )}
    </div>
  );
}
