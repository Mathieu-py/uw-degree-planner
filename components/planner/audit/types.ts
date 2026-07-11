import type { ScoredNode } from "@/lib/audit/score";
import type { Course, FilterPreset } from "@/lib/courses/types";

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

/**
 * A renderable audit section. The `elective*` / breadth / levelFloor / info
 * kinds derive from `program.electives[]` + degree notes, outside the rule tree
 * (rule-tree requirements render via `NodeBody`, not as sections).
 */
export type Section =
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
    }
  | {
      // Several same-titled notes folded into one collapsible row ("Additional
      // constraints · 7") so a wall of identical "Additional constraint" labels
      // reads as one group, not many.
      kind: "infoGroup";
      key: string;
      title: string;
      items: string[];
    };

/** One of the top-level collapsible macro-sections. */
type MacroKey = "degree" | "specialization" | "electives" | "other";

/**
 * A stratum within a macro: an optional light sub-heading over either a
 * flattened rule-tree node or a list of Section objects, rendered as rows.
 */
export interface MacroBlock {
  subLabel: string | null;
  content:
    | { kind: "node"; scored: ScoredNode }
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
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}

/**
 * The generic `all` description (`describeRule`'s fallback). Carries no info, so
 * it's never shown as a sub-label — sections flatten through it.
 */
export const GENERIC_ALL = "Complete all of the following";
