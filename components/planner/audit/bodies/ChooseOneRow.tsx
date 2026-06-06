import { Icon } from "@/components/ui/Icon";
import type { AuditNode } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { describeRule } from "@/lib/programs";
import type { DragWiring, DrillFn } from "../types";
import { OptionChip } from "./OptionChip";

/** A pick(1-of-N) requirement: marker + label + the option pool as chips. */
export function ChooseOneRow({
  node,
  options,
  catalogByCode,
  onDrill,
  drag,
}: {
  node: AuditNode;
  options: string[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const r = node.ruleNode;
  if (r.kind !== "pick") return null;
  // `selectMin` is absent for "choose any" / "no more than N" picks, which the
  // compiler reports as vacuously met. Only collapse to the chosen chip(s) once
  // a placement actually satisfies the choice — otherwise keep showing the
  // options (a vacuously-met optional pick has none, and would render empty).
  const decided =
    (node.status === "met" || node.status === "overSatisfied") &&
    node.satisfiers.length > 0;
  const selectMin = r.selectMin ?? 0;
  const label =
    selectMin === 1 && (r.selectMax ?? 1) === 1
      ? "Choose one"
      : (describeRule(r) ?? "Choose one");
  const satisfierCodes = new Set(node.satisfiers.map((s) => s.code));

  return (
    <div className={`av-choose${decided ? " is-met" : ""}`}>
      <span className="av-choose-mark">
        {decided ? (
          <Icon name="check" size="xs" aria-hidden="true" />
        ) : (
          <span className="av-need">{selectMin > 0 ? selectMin : "+"}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="av-choose-label">{label}</div>
        <div className="av-chips mt-1.5">
          {decided
            ? node.satisfiers.map((s) => (
                <span key={s.code} className="av-chip met">
                  <Icon name="check" size="xs" aria-hidden="true" />
                  {formatCourseCode(s.code)}
                </span>
              ))
            : options.map((code) => (
                <OptionChip
                  key={code}
                  code={code}
                  placed={satisfierCodes.has(code)}
                  catalogByCode={catalogByCode}
                  onDrill={onDrill}
                  drag={drag}
                />
              ))}
        </div>
      </div>
    </div>
  );
}
