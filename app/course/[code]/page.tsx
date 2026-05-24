import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCourseByCode } from "@/lib/data";
import { seatsAvailable } from "@/lib/filters";
import { formatCourseCode, formatPercent } from "@/lib/format";
import { PINNED_TERM as TERM, termLabel } from "@/lib/terms";

interface PageParams {
  code: string;
}

export async function generateMetadata(props: { params: Promise<PageParams> }) {
  const { code } = await props.params;
  const course = await loadCourseByCode(TERM, code);
  if (!course) return { title: "Course not found · UW Degree Planner" };
  return {
    title: `${formatCourseCode(course.code)} — ${course.name} · UW Degree Planner`,
    description: course.description?.slice(0, 160) ?? undefined,
  };
}

export default async function CoursePage(props: {
  params: Promise<PageParams>;
}) {
  const { code } = await props.params;
  const course = await loadCourseByCode(TERM, code);
  if (!course) notFound();

  const rating = course.rating;
  const totalSeats = seatsAvailable(course) ?? 0;

  return (
    <div className="mx-auto max-w-3xl w-full px-6 py-10 flex flex-col gap-8">
      <Link
        href="/plan"
        className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 w-fit"
      >
        ← Back to planner
      </Link>

      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {formatCourseCode(course.code)} · {termLabel(TERM)}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">{course.name}</h1>
      </header>

      {rating && rating.filled_count != null && rating.filled_count > 0 && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <Stat label="Useful" value={formatPercent(rating.useful)} />
          <Stat label="Easy" value={formatPercent(rating.easy)} />
          <Stat label="Liked" value={formatPercent(rating.liked)} />
          <Stat label="Reviews" value={rating.filled_count.toString()} />
        </section>
      )}

      {course.description && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Description
          </h2>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-line">
            {course.description}
          </p>
        </section>
      )}

      <section className="grid sm:grid-cols-3 gap-6">
        <ReqBlock label="Prerequisites" value={course.prereqs} />
        <ReqBlock label="Corequisites" value={course.coreqs} />
        <ReqBlock label="Antirequisites" value={course.antireqs} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Sections in {termLabel(TERM)}
        </h2>
        {course.sections.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No sections scheduled.
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {course.sections.length} section
              {course.sections.length === 1 ? "" : "s"} ·{" "}
              <span
                className={
                  totalSeats > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-500"
                }
              >
                {totalSeats > 0 ? `${totalSeats} seats open` : "Full"}
              </span>
            </p>
            <ul className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {course.sections.map((s) => {
                const open = Math.max(
                  0,
                  s.enrollment_capacity - s.enrollment_total,
                );
                return (
                  <li key={s.id} className="tabular-nums">
                    #{s.id}: {s.enrollment_total}/{s.enrollment_capacity}
                    {open > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {" "}
                        ({open} open)
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function ReqBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {value && value.trim() !== "" ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          {value}
        </p>
      ) : (
        <span className="text-sm text-zinc-400">None</span>
      )}
    </div>
  );
}
