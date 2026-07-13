"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { CourseEligibilityVerdict } from "@/lib/courses/courseEligibility";
import type { SortDir, SortKey } from "@/lib/courses/courseSort";
import { seatsAvailable } from "@/lib/courses/filters";
import { getRatingColor } from "@/lib/courses/ratingColor";
import type { EligibilityRow } from "@/lib/courses/rowEligibility";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode, formatPercent } from "@/lib/format";
import { buildCourseOrigin } from "@/lib/plan/courseOrigin";

export type CourseTableMode = "catalog" | "picker";

// Secondary columns drop on narrow widths so the table always fits its
// container — no horizontal scroll. Course name truncates to absorb the slack.
// These are CONTAINER queries (`@md`/`@lg`/`@xl`), not viewport: the picker
// table lives in a narrow area inside a wide viewport (modal minus sidebar), so
// it must react to its own width, not the window's. Requires the `@container`
// wrapper below.
const EASY_VIS = "hidden @md:table-cell";
const LIKED_VIS = "hidden @lg:table-cell";
const SEATS_VIS = "hidden @xl:table-cell";

interface CourseTableProps {
  rows: EligibilityRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  mode: CourseTableMode;
  /**
   * Add a course. Catalog opens the term picker (choose a plan/term); picker
   * adds directly to the target slot.
   */
  onAdd: (course: Course) => void;
  /**
   * Query appended to each picker row's Details link (`?from=picker&planId=…&term=…`)
   * so the detail page can offer a one-click "Add to {term}". Picker mode only.
   */
  detailsQuery?: string;
}

/**
 * Shared course grid behind both the catalog and the slot picker (#91). One
 * clean, sortable table; `mode` is the only structural difference:
 * - catalog: no eligibility column (status is plan-relative, unknown here);
 *   the row opens course details and a per-row Add button starts the add flow.
 * - picker: leads with a Status column; the row itself adds the course to the
 *   slot and a quiet Details link opens the course page. Rows blocked by
 *   program/faculty or already in the plan render non-interactive.
 * Reviews aren't a column on either surface — that count lives on the details
 * page (`reviews` stays a valid sort key, just not shown). Fixed layout keeps
 * the table within its container at every width.
 */
export function CourseTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  mode,
  onAdd,
  detailsQuery,
}: CourseTableProps) {
  const isPicker = mode === "picker";
  return (
    <div className="@container">
      <table className="w-full table-fixed text-[13px]">
        <thead className="sticky top-0 z-[1] bg-bg border-b border-line">
          <tr>
            {isPicker ? (
              <th className="pl-5 pr-2 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 w-[96px]">
                Status
              </th>
            ) : null}
            <SortableTh
              label="Code"
              col="code"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              className={isPicker ? "w-[80px]" : "w-[96px] pl-5"}
            />
            <SortableTh
              label="Course"
              col="name"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableTh
              label="Useful"
              col="useful"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
              className="w-[62px]"
            />
            <SortableTh
              label="Easy"
              col="easy"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
              className={`w-[60px] ${EASY_VIS}`}
            />
            <SortableTh
              label="Liked"
              col="liked"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
              className={`w-[60px] ${LIKED_VIS}`}
            />
            <SortableTh
              label="Seats"
              col="seats"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
              className={`w-[56px] ${SEATS_VIS}`}
            />
            <th className="w-[88px] pr-5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            isPicker ? (
              <PickerRow
                key={r.course.id}
                row={r}
                onAdd={onAdd}
                detailsQuery={detailsQuery}
              />
            ) : (
              <CatalogRow key={r.course.id} row={r} onAdd={onAdd} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = col === sortKey;
  return (
    <th
      className={`px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-accent" : "text-ink-3"} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 select-none hover:text-ink ${
          active ? "text-accent hover:text-accent" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {/* Reserve arrow space so toggling sort doesn't shift the header. */}
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`}>
          {sortDir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

/**
 * Catalog row. The whole row opens course details (mouse path via `router`,
 * keyboard path via the code Link); the Add button starts the add-to-plan flow.
 */
function CatalogRow({
  row,
  onAdd,
}: {
  row: EligibilityRow;
  onAdd: (course: Course) => void;
}) {
  const router = useRouter();
  const { course } = row;
  const detailsHref = `/course/${course.code}${buildCourseOrigin({ from: "catalog" })}`;
  const seats = seatsAvailable(course);

  return (
    <tr
      className="border-b border-line last:border-b-0 hover:bg-bg-2 cursor-pointer"
      onClick={() => router.push(detailsHref)}
    >
      <td className="pl-5 pr-3 h-[52px] align-middle whitespace-nowrap overflow-hidden font-mono text-[13px] font-semibold">
        <Link href={detailsHref} onClick={(e) => e.stopPropagation()}>
          {formatCourseCode(course.code)}
        </Link>
      </td>
      <NameCell name={course.name} />
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} className={EASY_VIS} />
      <RatingCell value={course.rating?.liked} className={LIKED_VIS} />
      <SeatsCell seats={seats} className={SEATS_VIS} />
      <td className="pl-3 pr-5 h-[52px] align-middle text-right whitespace-nowrap">
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(course);
          }}
        >
          Add
        </Button>
      </td>
    </tr>
  );
}

/**
 * Picker row. The whole row adds the course (unless blocked); a quiet Details
 * link opens the course page in the same tab with the plan+term context
 * (`?from=picker&…`) for the same one-click add. Details is the action cell's
 * only content so it can't spill the column and trip the scroll area's overflow-x.
 */
function PickerRow({
  row,
  onAdd,
  detailsQuery,
}: {
  row: EligibilityRow;
  onAdd: (course: Course) => void;
  detailsQuery?: string;
}) {
  const { course, eligibility } = row;
  const seats = seatsAvailable(course);
  // A course closed to the student's program/faculty, or already in the plan
  // (incl. a cross-listed twin), can't be added — render the row inert; the
  // chip explains why. Belt-and-suspenders with the picker's own add gate.
  const inert = !!eligibility?.blockedByProgram || !!eligibility?.alreadyPlaced;
  const detailsHref = `/course/${course.code}${detailsQuery ?? ""}`;

  return (
    <tr
      className={`group border-b border-line last:border-b-0 ${
        inert
          ? "cursor-not-allowed opacity-[0.55]"
          : "hover:bg-bg-2 cursor-pointer"
      }`}
      onClick={inert ? undefined : () => onAdd(course)}
    >
      <td className="pl-5 pr-2 h-[52px] align-middle overflow-hidden">
        {eligibility ? (
          <EligibilityChip verdict={eligibility} />
        ) : (
          <span className="text-ink-3 text-[11px]">—</span>
        )}
      </td>
      <td className="px-3 h-[52px] align-middle whitespace-nowrap overflow-hidden font-mono text-[13px] font-semibold">
        {inert ? (
          <span className="text-ink-3">{formatCourseCode(course.code)}</span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdd(course);
            }}
            className="text-ink"
          >
            {formatCourseCode(course.code)}
          </button>
        )}
      </td>
      <NameCell name={course.name} muted={inert} />
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} className={EASY_VIS} />
      <RatingCell value={course.rating?.liked} className={LIKED_VIS} />
      <SeatsCell seats={seats} className={SEATS_VIS} />
      <td className="pl-3 pr-5 h-[52px] align-middle text-right whitespace-nowrap overflow-hidden">
        <Link
          href={detailsHref}
          title="Open course details"
          aria-label={`Details for ${course.code}`}
          className="text-[12.5px] font-semibold text-ink-2 hover:text-ink hover:underline underline-offset-[3px]"
          onClick={(e) => e.stopPropagation()}
        >
          Details
        </Link>
      </td>
    </tr>
  );
}

function NameCell({ name, muted = false }: { name: string; muted?: boolean }) {
  return (
    <td className="px-3 h-[52px] align-middle overflow-hidden">
      <span
        className={`block truncate ${muted ? "text-ink-3" : "text-ink"}`}
        title={name}
      >
        {name}
      </span>
    </td>
  );
}

function RatingCell({
  value,
  className = "",
}: {
  value: number | null | undefined;
  className?: string;
}) {
  if (value == null) {
    return (
      <td
        className={`px-3 h-[52px] align-middle text-right text-[13px] text-ink-3 ${className}`}
      >
        —
      </td>
    );
  }
  const color = getRatingColor(value);
  return (
    <td className={`px-3 h-[52px] align-middle text-right ${className}`}>
      <span className="inline-flex items-center gap-1.5 justify-end tabular-nums text-[13px]">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        {formatPercent(value)}
      </span>
    </td>
  );
}

function SeatsCell({
  seats,
  className = "",
}: {
  seats: number | null;
  className?: string;
}) {
  return (
    <td
      className={`px-3 h-[52px] align-middle text-right text-[13px] tabular-nums font-mono ${className}`}
    >
      {seats == null ? (
        <span className="text-ink-3">—</span>
      ) : seats > 0 ? (
        <span className="text-met font-semibold">{seats}</span>
      ) : (
        <span className="text-ink-3">Full</span>
      )}
    </td>
  );
}

/**
 * Eligibility state as a chip. The engine returns three base states
 * (`eligible | check | ineligible`); `ineligible` is expanded here into the
 * specific, actionable reason. Only rendered in picker mode.
 */
export function EligibilityChip({
  verdict,
}: {
  verdict: CourseEligibilityVerdict;
}) {
  // Shared shape. whitespace-nowrap keeps every label on ONE line inside the
  // narrow Status column; labels are short (≤ "Eligible", the common case, which
  // sizes the column) and the full reason lives in the hover tooltip.
  const base =
    "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";
  if (verdict.state === "eligible") {
    return <span className={`${base} bg-met-soft text-met`}>Eligible</span>;
  }
  if (verdict.state === "check") {
    return (
      <span
        className={`${base} bg-partial-soft text-partial`}
        title={verdict.reasons.join(" · ") || "Manual check needed"}
      >
        Check
      </span>
    );
  }
  // Ineligible — short label, full reason in the tooltip. `alreadyPlaced` fires
  // for a placed cross-listed twin (the exact code is filtered out upstream).
  if (verdict.alreadyPlaced) {
    return (
      <span
        className={`${base} bg-bg-3 text-ink-2`}
        title={verdict.reasons[0] ?? "Already in plan"}
      >
        In plan
      </span>
    );
  }
  if (verdict.antireqConflicts.length > 0) {
    return (
      <span
        className={`${base} bg-danger-soft text-danger`}
        title={`Antireq conflict: ${verdict.antireqConflicts.join(", ")}`}
      >
        Antireq
      </span>
    );
  }
  if (verdict.blockedByProgram) {
    return (
      <span
        className={`${base} bg-danger-soft text-danger`}
        title={
          verdict.rawRequirements.join(" · ") || "Restricted to another program"
        }
      >
        Blocked
      </span>
    );
  }
  return (
    <span
      className={`${base} bg-danger-soft text-danger`}
      title={
        verdict.missingCourses.length > 0
          ? `Missing: ${verdict.missingCourses.map(formatCourseCode).join(", ")}`
          : verdict.rawRequirements.join(" · ") || "Missing prerequisites"
      }
    >
      Missing
    </span>
  );
}
