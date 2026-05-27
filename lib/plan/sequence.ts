import { nextTerm, type TermId, type TermInfo, termInfo } from "@/lib/terms";
import type {
  CoopLabel,
  PlanSlot,
  SlotPosition,
  Stream,
  TermLetter,
} from "./types";

const ACADEMIC_TERMS: TermLetter[] = [
  "1A",
  "1B",
  "2A",
  "2B",
  "3A",
  "3B",
  "4A",
  "4B",
];

/**
 * Cadence per stream: the sequence of slot kinds, where each entry is either
 * the next academic term letter or "coop" (a work term to be numbered in
 * placement order). Source:
 * https://uwaterloo.ca/engineering/undergraduate-students/co-op-experience/co-op-study-sequences
 *
 * Both engineering streams have 8 academic + 6 work terms. They differ in
 * when the first work term lands:
 * - Stream 4 starts co-op in January of 1st year (Architectural, Electrical,
 *   Environmental, Geological, Systems Design): WT between every academic
 *   term until 3B, then 4A and 4B back-to-back at the end.
 * - Stream 8 starts co-op in May of 1st year (Software, Biomedical, Civil,
 *   Nanotechnology, Management): straight 1A → 1B, then alternating with
 *   work terms, and two back-to-back WTs before 4A.
 *
 * Math sequences (SEQ 1-4 plus specialized) are not yet modeled — students
 * in Math programs can pick stream8 and manually adjust slots.
 */
const CADENCE: Record<Stream, Array<TermLetter | "coop">> = {
  regular: [...ACADEMIC_TERMS],
  stream4: [
    "1A",
    "coop",
    "1B",
    "coop",
    "2A",
    "coop",
    "2B",
    "coop",
    "3A",
    "coop",
    "3B",
    "coop",
    "4A",
    "4B",
  ],
  stream8: [
    "1A",
    "1B",
    "coop",
    "2A",
    "coop",
    "2B",
    "coop",
    "3A",
    "coop",
    "3B",
    "coop",
    "coop",
    "4A",
    "4B",
  ],
};

export interface SequencedSlot {
  termId: TermId;
  position: SlotPosition;
  isCoop: boolean;
}

/**
 * Generate the slot sequence for a student starting in `startTermId` on
 * `stream`. Calendar terms advance monotonically (Winter → Spring → Fall →
 * Winter ...); positions follow the cadence table.
 */
export function sequenceTerms(
  startTermId: TermId,
  stream: Stream,
): SequencedSlot[] {
  const start = termInfo(startTermId);
  if (!start) {
    throw new Error(`Cannot sequence from invalid term id: ${startTermId}`);
  }
  const cadence = CADENCE[stream];
  const out: SequencedSlot[] = [];
  let cursor: TermInfo = start;
  let coopNum = 0;
  for (const entry of cadence) {
    if (entry === "coop") {
      coopNum += 1;
      const label = `coop${coopNum}` as CoopLabel;
      out.push({ termId: cursor.id, position: label, isCoop: true });
    } else {
      out.push({ termId: cursor.id, position: entry, isCoop: false });
    }
    cursor = nextTerm(cursor);
  }
  return out;
}

/**
 * Convenience: build empty PlanSlots for a fresh plan. Caller supplies an
 * ID minter (so we can use `crypto.randomUUID()` in the browser and a stub
 * in tests).
 */
export function buildEmptySlots(
  startTermId: TermId,
  stream: Stream,
  mintId: () => string,
): PlanSlot[] {
  return sequenceTerms(startTermId, stream).map((s) => ({
    id: mintId(),
    termId: s.termId,
    position: s.position,
    isCoop: s.isCoop,
    courses: [],
  }));
}

/**
 * Re-sequence an existing plan's slots for a new stream while preserving
 * course placements by slot position. Used when the student changes stream
 * mid-plan in PlanSettingsModal.
 *
 * Strategy: match each new slot to the old slot with the same `position`
 * (e.g. "1A" → "1A", "coop1" → "coop1") and copy its courses. Positions
 * that exist in the old cadence but not the new one (e.g. coop slots when
 * switching to "regular") have their courses returned as `droppedCodes` so
 * the caller can surface a banner. The "pre" slot (transfer credits) is
 * passed through untouched — it's independent of stream.
 */
export function rebuildSlotsForStream(
  oldSlots: PlanSlot[],
  startTermId: TermId,
  newStream: Stream,
  mintId: () => string,
): { slots: PlanSlot[]; droppedCodes: string[] } {
  const preSlot = oldSlots.find((s) => s.position === "pre");
  const coursesByPosition = new Map<string, PlanSlot["courses"]>();
  for (const slot of oldSlots) {
    if (slot.position === "pre") continue;
    coursesByPosition.set(slot.position, slot.courses);
  }

  const sequenced = sequenceTerms(startTermId, newStream);
  const newSlots: PlanSlot[] = [];
  if (preSlot) newSlots.push(preSlot);

  const usedPositions = new Set<string>();
  for (const s of sequenced) {
    const carried = coursesByPosition.get(s.position) ?? [];
    if (carried.length > 0) usedPositions.add(s.position);
    newSlots.push({
      id: mintId(),
      termId: s.termId,
      position: s.position,
      isCoop: s.isCoop,
      courses: carried,
    });
  }

  const droppedCodes: string[] = [];
  for (const [pos, courses] of coursesByPosition.entries()) {
    if (!usedPositions.has(pos)) {
      droppedCodes.push(...courses.map((c) => c.code));
    }
  }

  return { slots: newSlots, droppedCodes };
}
