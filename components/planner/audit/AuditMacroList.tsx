import type { Macro } from "@/lib/audit/view/types";
import type { Course } from "@/lib/courses/types";
import { MacroSection } from "./sections/MacroSection";
import type { DragWiring, DrillFn } from "./types";

interface Props {
  macros: Macro[];
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
  /** Extra classes on the scroll container (layout differs single vs. detail). */
  className?: string;
}

/**
 * The scrollable list of macro sections (Degree requirements / Specialization /
 * Electives) for one program. Shared by the single-program card and the
 * master·detail pane so all macro/row/chip rendering, drag wiring, and legality
 * flags come from one place.
 */
export function AuditMacroList({
  macros,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
  className,
}: Props) {
  return (
    <div className={className}>
      {macros.map((macro) => (
        <MacroSection
          key={macro.key}
          macro={macro}
          placedCodes={placedCodes}
          illegalCodes={illegalCodes}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      ))}
    </div>
  );
}
