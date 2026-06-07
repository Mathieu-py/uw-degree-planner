import type { DragEvent } from "react";
import { addCourseToSlot, removeCourseFromSlot } from "@/lib/plan/mutateSlots";
import type { LocalPlan, SlotCourse } from "@/lib/plan/types";

/**
 * Course drag-and-drop for the planner timeline.
 *
 * A drag carries a small JSON payload under a private MIME type so the planner
 * only reacts to its own chips (not dragged files, links, or text). Two kinds:
 *   - "move": a placed chip dragged from one term to another.
 *   - "add":  a still-needed chip dragged out of the audit panel.
 *
 * Drops apply via the pure {@link applyCourseDrop} reducer.
 */

export const COURSE_DRAG_MIME = "application/x-uw-course";

export type CourseDragData =
  | { kind: "move"; fromSlotId: string; code: string }
  | { kind: "add"; code: string };

// A value-less type whose suffix encodes the drag's kind. The payload can't be
// read during `dragover` (protected mode) but its types can, so a drop target
// can pick the matching cursor there.
function kindType(kind: CourseDragData["kind"]): string {
  return `${COURSE_DRAG_MIME}+${kind}`;
}

/** Stamp a drag payload onto the event's dataTransfer at dragstart. */
export function writeCourseDrag(
  e: { dataTransfer: DataTransfer | null },
  data: CourseDragData,
): void {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.setData(COURSE_DRAG_MIME, JSON.stringify(data));
  dt.setData(kindType(data.kind), "");
  // Harmless human-readable fallback for anything that only reads text/plain.
  dt.setData("text/plain", data.code);
  // "add" copies a still-needed course out of the audit (chip stays put);
  // "move" relocates a placed chip.
  dt.effectAllowed = data.kind === "add" ? "copy" : "move";
}

/**
 * Drag-source DOM props for a course chip, to spread onto the draggable. A
 * factory (not a hook) so it can run inside a `.map()`. `lifecycle` hooks
 * dragstart/dragend for UI state (e.g. dimming the in-flight chip).
 */
export function courseDragProps(
  data: CourseDragData,
  lifecycle?: { onStart?: () => void; onEnd?: () => void },
): {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
} {
  return {
    draggable: true,
    onDragStart: (e) => {
      writeCourseDrag(e, data);
      lifecycle?.onStart?.();
    },
    onDragEnd: () => lifecycle?.onEnd?.(),
  };
}

/**
 * Whether the in-flight drag is one of ours. Safe to call during `dragover`,
 * where the payload itself can't be read but its types can.
 */
export function hasCourseDrag(e: {
  dataTransfer: DataTransfer | null;
}): boolean {
  return e.dataTransfer?.types.includes(COURSE_DRAG_MIME) ?? false;
}

/**
 * Which kind of course drag is in flight, read from `dataTransfer.types` so it
 * works during `dragover`. Null if not one of ours. Lets a drop target show a
 * copy cursor for "add" and a move cursor for "move".
 */
export function courseDragKind(e: {
  dataTransfer: DataTransfer | null;
}): CourseDragData["kind"] | null {
  const types = e.dataTransfer?.types;
  if (!types) return null;
  if (types.includes(kindType("add"))) return "add";
  if (types.includes(kindType("move"))) return "move";
  return null;
}

// Catalog course-code shape (e.g. "cs136", "math115", "se101l"). Drag payloads
// only ever carry real codes, so anything else is foreign or tampered with.
const COURSE_CODE_RE = /^[a-z]+\d+[a-z]?$/;

/** Read and validate the drag payload at drop time; null if foreign/garbled. */
export function readCourseDrag(e: {
  dataTransfer: DataTransfer | null;
}): CourseDragData | null {
  const raw = e.dataTransfer?.getData(COURSE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CourseDragData;
    if (typeof parsed.code !== "string") return null;
    if (!COURSE_CODE_RE.test(parsed.code.toLowerCase())) return null;
    if (parsed.kind === "add") return parsed;
    if (parsed.kind === "move" && typeof parsed.fromSlotId === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Apply a course drop onto `toSlotId`, returning the next plan — or the **same
 * plan reference** for any no-op (invalid target, self-drop, duplicate, missing
 * source) so callers can skip a save. Moves carry the whole {@link SlotCourse}
 * so a transcript grade follows the course.
 */
export function applyCourseDrop(
  plan: LocalPlan,
  toSlotId: string,
  data: CourseDragData,
): LocalPlan {
  const target = plan.slots.find((s) => s.id === toSlotId);
  // Only academic term columns accept drops — never co-op or pre-arrival.
  if (!target || target.isCoop || target.position === "pre") return plan;

  const code = data.code.toLowerCase();
  if (target.courses.some((c) => c.code === code)) return plan; // already there

  if (data.kind === "add") {
    return addCourseToSlot(plan, toSlotId, { code });
  }

  // kind === "move"
  if (data.fromSlotId === toSlotId) return plan;
  const source = plan.slots.find((s) => s.id === data.fromSlotId);
  const moving: SlotCourse | undefined = source?.courses.find(
    (c) => c.code === code,
  );
  if (!moving) return plan;

  return addCourseToSlot(
    removeCourseFromSlot(plan, data.fromSlotId, code),
    toSlotId,
    moving,
  );
}
