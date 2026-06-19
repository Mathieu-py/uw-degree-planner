import type { AuditNode } from "@/lib/audit/compile";
import type { NodeFill } from "@/lib/audit/progress";
import type { Course, FilterPreset } from "@/lib/courses/types";
import { unitsMet } from "@/lib/format";

/**
 * Drag wiring for course rows / option chips. `draggingCode` is the code in
 * flight (dims its row); `onStart`/`onEnd` bracket the drag. Absent in the
 * read-only shared view.
 */
export interface DragWiring {
  draggingCode: string | null;
  onStart: (code: string) => void;
  onEnd: () => void;
}

/**
 * Opens the slot picker for a requirement. `codes` focuses specific courses (a
 * finite list / single "Add"); `preset` instead seeds the filters (a subject
 * pool passes its subjects + level range, narrowing the catalog live).
 */
export type DrillFn = (codes: string[], preset?: FilterPreset) => void;

/**
 * Toggle a program's manual confirmation of an unverified requirement (keyed by
 * its verbatim text). Absent in the read-only shared view → rows render static.
 */
export type AcknowledgeFn = (
  programId: string,
  text: string,
  acked: boolean,
) => void;

interface SectionSummary {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
}

/**
 * A renderable audit section. `node` sections (terms, flexible/spec groups)
 * carry a compiled `AuditNode`; the `elective*` kinds derive from
 * `program.electives[]`, outside the rule tree.
 */
export type Section =
  | {
      kind: "node";
      key: string;
      title: string;
      caption: string;
      node: AuditNode;
      summary: SectionSummary;
    }
  | {
      kind: "electiveFinite";
      key: string;
      title: string;
      caption: string;
      need: number;
      placed: number;
      options: string[];
    }
  | {
      kind: "electiveBrowse";
      key: string;
      title: string;
      caption: string;
      eligibleCodes: string[];
      unitBased: boolean;
    }
  | {
      kind: "breadth";
      key: string;
      title: string;
      caption: string;
      /** Units required / placed (the calendar states breadth in units). */
      needUnits: number;
      placedUnits: number;
      subjects: string[];
      satisfiers: string[];
    }
  | {
      kind: "levelFloor";
      key: string;
      title: string;
      caption: string;
      /** Units required / placed (a unit-based minimum, not a course count). */
      needUnits: number;
      placedUnits: number;
      /** Subject prefixes that scope it (uppercase); empty = any subject. */
      subjects: string[];
      satisfiers: string[];
      sourceText: string;
    }
  | {
      kind: "info";
      key: string;
      title: string;
      caption: string;
    };

/** True when a section still has unmet requirements (used to default it open). */
export function isIncomplete(section: Section): boolean {
  if (section.kind === "node")
    return section.summary.satisfied < section.summary.needed;
  if (section.kind === "electiveFinite") return section.placed < section.need;
  if (section.kind === "breadth")
    return !unitsMet(section.placedUnits, section.needUnits);
  if (section.kind === "levelFloor")
    return !unitsMet(section.placedUnits, section.needUnits);
  return false;
}

/** One of the top-level collapsible macro-sections. */
type MacroKey = "degree" | "specialization" | "electives" | "other";

/**
 * A stratum within a macro: an optional light sub-heading over either a
 * flattened rule-tree node or a list of Section objects, rendered as rows.
 */
export interface MacroBlock {
  subLabel: string | null;
  content:
    | { kind: "node"; node: AuditNode }
    | { kind: "sections"; sections: Section[] };
}

export interface Macro {
  key: MacroKey;
  label: string;
  /** Course-count progress for the header chip; null for informational macros. */
  count: { satisfied: number; needed: number } | null;
  /** "+N to plan" hint for elective volume the count can't measure. */
  hint: string | null;
  blocks: MacroBlock[];
  defaultOpen: boolean;
  /**
   * Per-node distinct credit from the unit headline (catalog-backed view only),
   * so sub-group rings read the same one-course-per-slot assignment as the
   * macro's header count. Absent in the read-only view → rings fall back to the
   * independent per-node count.
   */
  nodeFill?: NodeFill;
}

/** Props every option-card piece needs to render (and recurse via NodeBody). */
export interface OptionRenderProps {
  placedCodes: ReadonlySet<string>;
  /** Placed codes whose placement is illegal (prereq/antireq) — flagged, uncounted. */
  illegalCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}

/**
 * The generic `all` description (`describeRule`'s fallback). Carries no info, so
 * it's never shown as a sub-label — sections flatten through it.
 */
export const GENERIC_ALL = "Complete all of the following";
