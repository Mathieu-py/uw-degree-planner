"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Course } from "@/lib/types";
import { formatCourseCode, formatPercent, truncate } from "@/lib/format";

type SortKey = "code" | "name" | "useful" | "easy" | "liked" | "reviews" | "seats";
type SortDir = "asc" | "desc";

interface Props {
  courses: Course[];
}

const LEVEL_BUCKETS = [100, 200, 300] as const;

export function CourseBrowser({ courses }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("useful");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<number>>(new Set(LEVEL_BUCKETS));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      const bucket = Math.floor(c.level / 100) * 100;
      if (!levels.has(bucket)) return false;
      if (q.length === 0) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
      );
    });
  }, [courses, query, levels]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => compare(a, b, sortKey, sortDir));
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleLevel(level: number) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "code" || key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by code or name…"
          className="flex-1 min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-200"
        />
        <div className="flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 p-1">
          {LEVEL_BUCKETS.map((lvl) => {
            const active = levels.has(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
                title={`Toggle ${lvl}-level`}
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {sorted.length} of {courses.length} courses
      </p>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-left">
              <Th label="Code" sortKey="code" current={sortKey} dir={sortDir} onSort={onSort} />
              <Th label="Course" sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
              <Th label="Useful" sortKey="useful" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
              <Th label="Easy" sortKey="easy" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
              <Th label="Liked" sortKey="liked" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
              <Th label="Reviews" sortKey="reviews" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
              <Th label="Seats" sortKey="seats" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <CourseRow key={c.id} course={c} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  No courses match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CourseRow({ course }: { course: Course }) {
  const reviews = course.rating?.filled_count ?? 0;
  const seats = seatsAvailable(course);
  return (
    <tr className="border-b last:border-0 border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30 transition-colors">
      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
        <Link
          href={`/course/${course.code}`}
          className="text-zinc-950 dark:text-zinc-50 hover:underline"
        >
          {formatCourseCode(course.code)}
        </Link>
      </td>
      <td className="px-4 py-3 min-w-[220px]">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {course.name}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {truncate(course.description, 110)}
          </span>
        </div>
      </td>
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} />
      <RatingCell value={course.rating?.liked} />
      <td className="px-4 py-3 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
        {reviews}
      </td>
      <td className="px-4 py-3 text-right text-xs tabular-nums">
        {seats == null ? (
          <span className="text-zinc-400">—</span>
        ) : seats > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">{seats} open</span>
        ) : (
          <span className="text-zinc-400">Full</span>
        )}
      </td>
    </tr>
  );
}

function RatingCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return (
      <td className="px-4 py-3 text-right text-xs text-zinc-400">—</td>
    );
  }
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <td className="px-4 py-3 text-right">
      <div className="inline-flex items-center gap-2 justify-end min-w-[64px]">
        <span className="h-1 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <span
            className={`block h-full ${color}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="tabular-nums text-xs font-medium w-9 text-right">
          {formatPercent(value)}
        </span>
      </div>
    </td>
  );
}

function Th({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th
      className={`px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-50 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        {active && (
          <span className="text-xs text-zinc-400">
            {dir === "asc" ? "↑" : "↓"}
          </span>
        )}
      </button>
    </th>
  );
}

function seatsAvailable(course: Course): number | null {
  if (course.sections.length === 0) return null;
  return course.sections.reduce(
    (sum, s) => sum + Math.max(0, s.enrollment_capacity - s.enrollment_total),
    0,
  );
}

function compare(a: Course, b: Course, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  switch (key) {
    case "code":
      return a.code.localeCompare(b.code) * mul;
    case "name":
      return a.name.localeCompare(b.name) * mul;
    case "useful":
      return (numberOr(b.rating?.useful) - numberOr(a.rating?.useful)) * (dir === "desc" ? 1 : -1);
    case "easy":
      return (numberOr(b.rating?.easy) - numberOr(a.rating?.easy)) * (dir === "desc" ? 1 : -1);
    case "liked":
      return (numberOr(b.rating?.liked) - numberOr(a.rating?.liked)) * (dir === "desc" ? 1 : -1);
    case "reviews":
      return (numberOr(b.rating?.filled_count) - numberOr(a.rating?.filled_count)) * (dir === "desc" ? 1 : -1);
    case "seats":
      return ((seatsAvailable(b) ?? -1) - (seatsAvailable(a) ?? -1)) * (dir === "desc" ? 1 : -1);
  }
}

function numberOr(v: number | null | undefined): number {
  return v ?? -1;
}
