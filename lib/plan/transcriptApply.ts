/**
 * Convert a parsed Quest transcript into a fully-formed `LocalPlan`:
 *  1. Start term = earliest parsed course's `termLabel`.
 *  2. Build the canonical slot sequence (1A→4B + co-op) via `sequenceTerms`.
 *  3. Drop each course into its term-label's slot. Transfers go to the
 *     synthetic `'pre'` slot; off-cadence courses go to "unsorted" so they
 *     stay visible rather than silently lost.
 *
 * Skipped courses are dropped; unrecognized ones only if opted into via
 * `includedUnrecognized`.
 */

import { type TermId, termLabelToTermId } from "@/lib/terms";
import type {
  ParsedCourse,
  TranscriptParseResult,
} from "@/lib/transcript/types";
import { sequenceTerms } from "./sequence";
import {
  type LocalPlan,
  PLAN_SCHEMA_VERSION,
  type PlanSlot,
  type SlotCourse,
  type Stream,
} from "./types";

export interface TranscriptToPlanOptions {
  /** Stream to use for the cadence. */
  stream: Stream;
  /** Unrecognized course codes the user has explicitly opted into. */
  includedUnrecognized: ReadonlySet<string>;
  /** Function to mint unique slot IDs (e.g. `crypto.randomUUID`). */
  mintId: () => string;
}

export interface TranscriptToPlanResult {
  plan: LocalPlan;
  /** Codes the parser saw a real term for but we couldn't fit into a slot. */
  unsortedCodes: string[];
  /** Codes the parser produced that fell off the cadence entirely. */
  unplacedTerms: string[];
}

/**
 * Build a `SlotCourse` from a parsed row, carrying the grade through. An empty
 * `rawGrade` (future enrollment) stays grade-less.
 */
function toSlotCourse(c: ParsedCourse): SlotCourse {
  const code = c.code.toLowerCase();
  return c.rawGrade ? { code, grade: c.rawGrade } : { code };
}

export function applyTranscriptToPlan(
  parseResult: TranscriptParseResult,
  opts: TranscriptToPlanOptions,
): TranscriptToPlanResult {
  const { stream, includedUnrecognized, mintId } = opts;

  // Step 1: start term = earliest course with a recognizable term-label. If
  // none, return an empty plan rather than throw, so the caller can prompt.
  const startTermId = inferStartTermId(parseResult);
  if (startTermId === null) {
    return {
      plan: bareplan(parseResult, stream, []),
      unsortedCodes: [],
      unplacedTerms: [],
    };
  }

  // Step 2: build the canonical sequence.
  const sequence = sequenceTerms(startTermId, stream);

  // Step 3: pre-arrival slot for transfer credits.
  const preSlot: PlanSlot = {
    id: mintId(),
    termId: null,
    position: "pre",
    isCoop: false,
    courses: [],
  };

  const slots: PlanSlot[] = [
    preSlot,
    ...sequence.map((s) => ({
      id: mintId(),
      termId: s.termId,
      position: s.position,
      isCoop: s.isCoop,
      courses: [] as SlotCourse[],
    })),
  ];

  // termId → academic slot. Deliberately never routes into a co-op slot —
  // that would break the cadence assumption.
  const academicByTerm = new Map<TermId, PlanSlot>();
  for (const s of slots) {
    if (s.termId === null || s.isCoop) continue;
    if (!academicByTerm.has(s.termId)) academicByTerm.set(s.termId, s);
  }

  const unsorted: string[] = [];
  const unplacedTermLabels = new Set<string>();

  for (const c of parseResult.courses) {
    if (c.status === "skipped") continue;
    if (c.status === "unrecognized" && !includedUnrecognized.has(c.code)) {
      continue;
    }
    const lc = c.code.toLowerCase();
    if (c.status === "transfer") {
      if (!preSlot.courses.some((x) => x.code === lc)) {
        preSlot.courses.push(toSlotCourse(c));
      }
      continue;
    }
    const tid = termLabelToTermId(c.termLabel);
    if (tid === null) {
      unsorted.push(lc);
      unplacedTermLabels.add(c.termLabel);
      continue;
    }
    const target = academicByTerm.get(tid);
    if (!target) {
      // Term exists on the calendar but not in this student's cadence (e.g. a
      // "Spring 2024" course while on stream8, where that's a work term). Drop
      // into unsorted rather than overwrite cadence semantics.
      unsorted.push(lc);
      unplacedTermLabels.add(c.termLabel);
      continue;
    }
    if (!target.courses.some((x) => x.code === lc)) {
      target.courses.push(toSlotCourse(c));
    }
  }

  const plan: LocalPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: parseResult.detectedProgramId,
    specializationId: parseResult.detectedSpecializationSlug,
    stream,
    startTermId,
    slots,
    updatedAt: new Date().toISOString(),
  };

  return {
    plan,
    unsortedCodes: [...new Set(unsorted)].sort(),
    unplacedTerms: [...unplacedTermLabels].sort(),
  };
}

/**
 * Infer a co-op student's stream from when their academic terms fall. Stream 4
 * and 8 interleave work terms differently, so the academic terms fingerprint
 * the stream: score each cadence by observed hits, return the clear winner.
 *
 * `"regular"` for a regular transcript; `null` when undecidable (unknown
 * system, <2 datable terms, or a tie) so the caller can ask.
 */
export function detectStream(
  parseResult: TranscriptParseResult,
): Stream | null {
  if (parseResult.detectedSystemOfStudy === "regular") return "regular";
  if (parseResult.detectedSystemOfStudy !== "coop") return null;

  const observed = [
    ...new Set(
      parseResult.courses
        .filter((c) => c.status !== "transfer" && c.status !== "skipped")
        .map((c) => termLabelToTermId(c.termLabel))
        .filter((id): id is TermId => id !== null),
    ),
  ];
  if (observed.length < 2) return null;

  // TermIds sort chronologically, so the smallest is the shared 1A start.
  const startTermId = Math.min(...observed);
  const academicHits = (stream: Stream): number => {
    const academic = new Set(
      sequenceTerms(startTermId, stream)
        .filter((s) => !s.isCoop)
        .map((s) => s.termId),
    );
    return observed.filter((id) => academic.has(id)).length;
  };

  const four = academicHits("stream4");
  const eight = academicHits("stream8");
  if (four === eight) return null;
  return four > eight ? "stream4" : "stream8";
}

function inferStartTermId(parseResult: TranscriptParseResult): TermId | null {
  let earliest: TermId | null = null;
  for (const c of parseResult.courses) {
    if (c.status === "transfer" || c.status === "skipped") continue;
    const tid = termLabelToTermId(c.termLabel);
    if (tid === null) continue;
    if (earliest === null || tid < earliest) earliest = tid;
  }
  return earliest;
}

function bareplan(
  parseResult: TranscriptParseResult,
  stream: Stream,
  slots: PlanSlot[],
): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: parseResult.detectedProgramId,
    specializationId: parseResult.detectedSpecializationSlug,
    stream,
    startTermId: null,
    slots,
    updatedAt: new Date().toISOString(),
  };
}
