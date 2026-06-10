import { TERM_LETTERS } from "@/lib/programs";
import { nextTerm, type TermId, type TermInfo, termInfo } from "@/lib/terms";
import type {
  CoopLabel,
  PlanSlot,
  SlotPosition,
  Stream,
  TermLetter,
} from "./types";

// 1A–4B, the single source of truth shared with the audit (#105). The annotation
// makes membership drift between the two `TermLetter` unions a compile error.
const ACADEMIC_TERMS: readonly TermLetter[] = TERM_LETTERS;

/**
 * Cadence per stream: a sequence of slot kinds, each the next academic term
 * letter or "coop" (a work term, numbered in placement order).
 * Source: https://uwaterloo.ca/engineering/undergraduate-students/co-op-experience/co-op-study-sequences
 *
 * Both engineering streams have 8 academic + 6 work terms; they differ in when
 * the first work term lands:
 * - Stream 4 (Architectural, Electrical, Environmental, Geological, Systems
 *   Design): WT between every academic term until 3B, then 4A/4B back-to-back.
 * - Stream 8 (Software, Biomedical, Civil, Nanotechnology, Management): 1A→1B,
 *   then alternating, with two back-to-back WTs before 4A.
 *
 * Math sequences aren't modeled yet — those students pick stream8 and adjust.
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

/** The full academic span; also the ceiling, since `TermLetter` stops at 4B. */
const FULL_TERM_SPAN = ACADEMIC_TERMS.length;

/**
 * Truncate a stream's cadence to its first `numAcademicTerms` academic terms,
 * dropping work terms queued after the last one. A 6-term plan ends at 3B.
 */
function cadenceForSpan(
  stream: Stream,
  numAcademicTerms: number,
): Array<TermLetter | "coop"> {
  const cadence = CADENCE[stream];
  const out: Array<TermLetter | "coop"> = [];
  let academic = 0;
  for (const entry of cadence) {
    out.push(entry);
    if (entry !== "coop") {
      academic += 1;
      if (academic >= numAcademicTerms) break;
    }
  }
  return out;
}

/**
 * Slot sequence for a student starting in `startTermId` on `stream`. Calendar
 * terms advance monotonically (Winter → Spring → Fall → …); positions follow the
 * cadence, truncated to `numAcademicTerms` (clamped to `[1, FULL_TERM_SPAN]`).
 */
export function sequenceTerms(
  startTermId: TermId,
  stream: Stream,
  numAcademicTerms: number = FULL_TERM_SPAN,
): SequencedSlot[] {
  const start = termInfo(startTermId);
  if (!start) {
    throw new Error(`Cannot sequence from invalid term id: ${startTermId}`);
  }
  const span = Math.min(FULL_TERM_SPAN, Math.max(1, numAcademicTerms));
  const cadence = cadenceForSpan(stream, span);
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
 * Build empty PlanSlots for a fresh plan. Caller supplies an ID minter
 * (`crypto.randomUUID()` in the browser, a stub in tests).
 */
export function buildEmptySlots(
  startTermId: TermId,
  stream: Stream,
  mintId: () => string,
  numAcademicTerms: number = FULL_TERM_SPAN,
): PlanSlot[] {
  return sequenceTerms(startTermId, stream, numAcademicTerms).map((s) => ({
    id: mintId(),
    termId: s.termId,
    position: s.position,
    isCoop: s.isCoop,
    courses: [],
  }));
}

/**
 * Re-sequence a plan's slots for a new stream and/or span, carrying courses by
 * `position`. Used when the student changes stream or program(s) in
 * PlanSettingsModal. Positions in the old cadence but not the new (coop slots
 * dropped by "regular", 4A/4B dropped when shrinking 8→6) return their courses
 * as `droppedCodes` for a banner; "pre" passes through untouched.
 */
export function rebuildSlots(
  oldSlots: PlanSlot[],
  startTermId: TermId,
  newStream: Stream,
  mintId: () => string,
  numAcademicTerms: number = FULL_TERM_SPAN,
): { slots: PlanSlot[]; droppedCodes: string[] } {
  const preSlot = oldSlots.find((s) => s.position === "pre");
  const coursesByPosition = new Map<string, PlanSlot["courses"]>();
  for (const slot of oldSlots) {
    if (slot.position === "pre") continue;
    coursesByPosition.set(slot.position, slot.courses);
  }

  const sequenced = sequenceTerms(startTermId, newStream, numAcademicTerms);
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
