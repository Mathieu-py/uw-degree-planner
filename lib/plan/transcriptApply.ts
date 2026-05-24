/**
 * Convert a parsed Quest transcript into a fully-formed `LocalPlan`.
 *
 * Strategy:
 *  1. Determine the student's start term from the EARLIEST parsed course's
 *     `termLabel` (the parser already ordered courses chronologically).
 *  2. Build the canonical slot sequence (1A→4B + co-op slots) via
 *     `sequenceTerms(startTermId, stream)`.
 *  3. Drop each parsed course into the slot whose `termId` matches the
 *     course's term-label. Courses with `status === "transfer"` land in the
 *     synthetic `'pre'` slot. Unmatched courses (e.g. the student took a
 *     term we couldn't place onto the cadence) go into an "unsorted" overflow
 *     slot at the end of the sequence so they're visible, not silently lost.
 *
 * Skipped courses are always dropped. Unrecognized courses are included
 * only if their code is in `includedUnrecognized` (caller opt-in).
 */

import { termLabelToTermId } from "../terms";
import type { TranscriptParseResult } from "../transcript/types";
import type { TermId } from "../types";
import { sequenceTerms } from "./sequence";
import type { LocalPlan, PlanSlot, SlotCourse, Stream } from "./types";
import { PLAN_SCHEMA_VERSION } from "./types";

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

export function applyTranscriptToPlan(
  parseResult: TranscriptParseResult,
  opts: TranscriptToPlanOptions,
): TranscriptToPlanResult {
  const { stream, includedUnrecognized, mintId } = opts;

  // Step 1: derive the start term from the earliest course with a recognizable
  // term-label. If none exists we still produce an empty plan rather than
  // throwing — the caller can prompt the user for a manual start.
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

  // Quick index: termId → academic slot. We intentionally do NOT route a
  // course into a co-op slot — that breaks the cadence assumption.
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
        preSlot.courses.push({ code: lc });
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
      // Term exists on the calendar but isn't in the student's cadence
      // (e.g. they took a course in a "Spring 2024" while on stream8 — that
      // would be a work term in this stream). Drop into unsorted rather than
      // overwriting cadence semantics.
      unsorted.push(lc);
      unplacedTermLabels.add(c.termLabel);
      continue;
    }
    if (!target.courses.some((x) => x.code === lc)) {
      target.courses.push({ code: lc });
    }
  }

  const plan: LocalPlan = {
    version: PLAN_SCHEMA_VERSION,
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
    version: PLAN_SCHEMA_VERSION,
    programId: parseResult.detectedProgramId,
    specializationId: parseResult.detectedSpecializationSlug,
    stream,
    startTermId: null,
    slots,
    updatedAt: new Date().toISOString(),
  };
}
