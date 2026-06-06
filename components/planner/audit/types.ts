import type { AuditNode } from "@/lib/audit/compile";
import type { Course, FilterPreset } from "@/lib/courses/types";

/**
 * Drag wiring for course rows / option chips, owned by the planner shell.
 * `draggingCode` is the code in flight (dims its row); `onStart`/`onEnd` bracket
 * the drag. Absent in the read-only shared view.
 */
export interface DragWiring {
  draggingCode: string | null;
  onStart: (code: string) => void;
  onEnd: () => void;
}

/**
 * Opens the slot picker for a requirement. `codes` focuses specific courses (a
 * finite list / a single "Add"); `preset` instead seeds the picker's filters —
 * a subject pool passes its subjects (as an `includePrefixes` allow-list) and
 * level range, so the catalog narrows live and the sidebar shows the filter.
 */
export type DrillFn = (codes: string[], preset?: FilterPreset) => void;

interface SectionSummary {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
}

/**
 * A renderable audit section. `node` sections (terms, flexible groups,
 * specialization groups) carry a compiled `AuditNode`; the two `elective*`
 * kinds are derived from `program.electives[]`, which is not part of the rule
 * tree.
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

/** One of the top-level collapsible macro-sections. */
type MacroKey = "degree" | "specialization" | "electives" | "other";

/**
 * A stratum within a macro: an optional light sub-heading over either a
 * flattened rule-tree node (rendered as direct rows) or a list of existing
 * Section objects (breadth, level floors, electives, info) rendered as rows.
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
 * The generic `all` description (`describeRule`'s fallback). It carries no
 * information, so it's never shown as a sub-label — flattening a section reads
 * the requirements directly instead of under a "Complete all of the following".
 */
export const GENERIC_ALL = "Complete all of the following";
