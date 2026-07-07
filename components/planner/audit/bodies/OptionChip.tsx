import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import { MetChip, WarnChip } from "../cards/Chip";
import type { DragWiring, DrillFn } from "../types";

/**
 * A single course as a chip — the shared satisfier affordance across kinds:
 * met (placed), warn (placed illegally), drag (unplaced + interactive), or an
 * inert chip (unplaced, read-only). `.drag` chips are the drag handles.
 */
export function OptionChip({
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
  const name = catalogByCode.get(code)?.name;

  if (placed) {
    return illegal ? (
      <WarnChip code={code} name={name} />
    ) : (
      <MetChip code={code} name={name} />
    );
  }
  if (!onDrill) {
    return (
      <span className="cd-chip" title={name ? `${label} — ${name}` : label}>
        {label}
      </span>
    );
  }
  const isPlacing = drag?.draggingCode === code;
  return (
    <button
      type="button"
      className={`cd-chip drag${isPlacing ? " dim" : ""}`}
      onClick={() => onDrill([code])}
      title={`${name ? `${label} — ${name}` : label} · drag into a term, or click to pick one`}
      aria-label={`Add ${label} to a term`}
      {...courseDragProps(
        { kind: "add", code },
        drag
          ? { onStart: () => drag.onStart(code), onEnd: () => drag.onEnd() }
          : undefined,
      )}
    >
      <Icon name="grip" size="xs" aria-hidden="true" />
      {label}
    </button>
  );
}
