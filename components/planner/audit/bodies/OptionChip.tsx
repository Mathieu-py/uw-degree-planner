import { Grip } from "@/components/ui/Grip";
import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { DragWiring, DrillFn } from "../types";

/** A draggable option chip (pick options + finite elective pools). */
export function OptionChip({
  code,
  placed,
  catalogByCode,
  onDrill,
  drag,
}: {
  code: string;
  placed: boolean;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const label = formatCourseCode(code);
  const title = catalogByCode.get(code)?.name;
  const tip = title ? `${label} — ${title}` : label;

  if (placed) {
    return (
      <span className="av-chip met" title={tip}>
        <Icon name="check" size="xs" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (!onDrill) {
    return (
      <span className="av-chip" title={tip}>
        {label}
      </span>
    );
  }
  const isPlacing = drag?.draggingCode === code;
  return (
    <button
      type="button"
      className={`av-chip drag${isPlacing ? " dim" : ""}`}
      onClick={() => onDrill([code])}
      title={`${tip} · drag into a term`}
      {...courseDragProps(
        { kind: "add", code },
        drag
          ? { onStart: () => drag.onStart(code), onEnd: () => drag.onEnd() }
          : undefined,
      )}
    >
      <span className="av-grip">
        <Grip s={11} />
      </span>
      {label}
    </button>
  );
}
