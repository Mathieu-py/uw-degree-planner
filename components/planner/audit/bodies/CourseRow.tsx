import { Grip } from "@/components/ui/Grip";
import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { DragWiring, DrillFn } from "../types";

/**
 * A required course. Placed → met-styled row with a check. Unplaced and
 * interactive → draggable row with a grip + "Add". Read-only → inert row.
 */
export function CourseRow({
  code,
  placed,
  illegal,
  catalogByCode,
  onDrill,
  drag,
}: {
  code: string;
  placed: boolean;
  /** Placed, but illegally (unmet prereq / antireq conflict) — flag, don't credit. */
  illegal?: boolean;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const label = formatCourseCode(code);
  const title = catalogByCode.get(code)?.name ?? "";

  if (placed) {
    // Placed-but-illegal: keep the row (it IS in the plan) but flag it amber and
    // explain — our ring/headline counts exclude it, so a plain green check would
    // read as "done" when it isn't credited yet.
    return (
      <div
        className={`av-item ${illegal ? "flagged" : "met"}`}
        title={
          illegal
            ? `${label} is placed before its prereqs or in an antireq conflict — it shows on your timeline, but doesn't credit the degree until the placement is valid.`
            : undefined
        }
      >
        <span className={`av-item-grip ${illegal ? "flagged" : "met"}`}>
          <Icon
            name={illegal ? "warning" : "check"}
            size="sm"
            aria-hidden="true"
          />
        </span>
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="u-mono av-item-code">{label}</span>
          {title ? <span className="av-item-name">{title}</span> : null}
        </span>
      </div>
    );
  }

  if (!onDrill) {
    return (
      <div className="av-item">
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="u-mono av-item-code">{label}</span>
          {title ? <span className="av-item-name">{title}</span> : null}
        </span>
      </div>
    );
  }

  const isPlacing = drag?.draggingCode === code;
  return (
    <div
      className={`av-item drag${isPlacing ? " dim" : ""}`}
      {...courseDragProps(
        { kind: "add", code },
        drag
          ? { onStart: () => drag.onStart(code), onEnd: () => drag.onEnd() }
          : undefined,
      )}
    >
      <span className="av-item-grip">
        <Grip />
      </span>
      <span className="flex flex-col gap-px min-w-0 flex-1">
        <span className="u-mono av-item-code">{label}</span>
        {title ? <span className="av-item-name">{title}</span> : null}
      </span>
      <button
        type="button"
        className="av-item-add"
        onClick={() => onDrill([code])}
        title={`Drag ${label} into a term, or click to pick one`}
        aria-label={`Add ${label} to a term`}
      >
        Add <Icon name="arrow" size="xs" aria-hidden="true" />
      </button>
    </div>
  );
}
