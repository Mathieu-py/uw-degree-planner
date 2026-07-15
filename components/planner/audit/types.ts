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

/** Props every option-card piece needs to render (and recurse via NodeBody). */
export interface OptionRenderProps {
  placedCodes: ReadonlySet<string>;
  /** Placed codes whose placement is illegal (prereq/antireq) — flagged, uncounted. */
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}
