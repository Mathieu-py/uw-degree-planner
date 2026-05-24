import { nextTerm, type TermInfo, termInfo } from "../terms";
import type { TermId } from "../types";
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
