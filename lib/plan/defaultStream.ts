import { makeTermId, type TermId } from "@/lib/terms";
import type { Stream } from "./types";

/**
 * Canonical co-op stream per UW Engineering program — the sequence a program
 * assigns by default. Source: UW Engineering co-op study sequences,
 * https://uwaterloo.ca/engineering/undergraduate-students/co-op-experience/co-op-study-sequences
 * ("Stream 4" = first work term in January of first year; "Stream 8" = first
 * work term in May of first year).
 *
 * Systems Design changed cohorts — Fall 2025 and earlier are Stream 4, Fall 2026
 * and later are Stream 8 — so it is resolved by start term below, not here.
 *
 * Dual-stream programs (Chemical, Computer, Mechanical, Mechatronics) are
 * *assigned* a stream the summer before first year; the calendar names no
 * default, so we suggest the more common Stream 8 (matching the app's
 * unknown-co-op fallback in WelcomeFlow) and let the student correct it.
 *
 * Omitted programs fall through to "regular": Architecture (work terms begin in
 * 2nd year) and Medical Sciences have sequences we don't model, and flexible
 * programs (Math/CS/Arts/Science) treat co-op as a student opt-in.
 */
const ENGINEERING_DEFAULT_STREAM: Record<string, Stream> = {
  // Stream 4 — first work term in January of first year.
  "architectural-engineering": "stream4",
  "electrical-engineering": "stream4",
  "environmental-engineering": "stream4",
  "geological-engineering": "stream4",
  // Stream 8 — first work term in May of first year.
  "biomedical-engineering": "stream8",
  "civil-engineering": "stream8",
  "management-engineering": "stream8",
  "nanotechnology-engineering": "stream8",
  "software-engineering": "stream8",
  // Dual-stream (assigned in summer before 1A): suggest the common Stream 8.
  "chemical-engineering": "stream8",
  "computer-engineering": "stream8",
  "mechanical-engineering": "stream8",
  "mechatronics-engineering": "stream8",
};

/** Resolved by cohort start term below, so it's not in the static map above. */
const SYDE_PROGRAM_ID = "systems-design-engineering";

/**
 * Every program id this module keys off, for a test that asserts each still
 * resolves to a real program (a renamed slug would silently fall back to
 * "regular" otherwise). Not typed against a program-id union — none exists;
 * ids are `programs.json` keys — so the drift guard is a runtime test instead.
 */
export const STREAMED_PROGRAM_IDS: readonly string[] = [
  ...Object.keys(ENGINEERING_DEFAULT_STREAM),
  SYDE_PROGRAM_ID,
];

/** Systems Design flipped Stream 4 → Stream 8 for the Fall 2026 intake onward. */
const SYDE_STREAM8_FROM: TermId = makeTermId(2026, "Fall");

function sydeDefault(startTermId: TermId | null | undefined): Stream {
  // TermIds sort chronologically, so a numeric compare is the cohort test.
  // Unknown start term ⇒ assume the current (Fall 2026+) cohort.
  if (startTermId == null) return "stream8";
  return startTermId >= SYDE_STREAM8_FROM ? "stream8" : "stream4";
}

/**
 * The co-op stream a program defaults to. Engineering programs map to their
 * assigned stream (Systems Design by cohort start term); everything else —
 * flexible programs, unmodeled co-op sequences — defaults to "regular".
 */
export function programDefaultStream(
  programId: string,
  startTermId?: TermId | null,
): Stream {
  if (programId === SYDE_PROGRAM_ID) {
    return sydeDefault(startTermId);
  }
  return ENGINEERING_DEFAULT_STREAM[programId] ?? "regular";
}

/**
 * Suggested stream for a plan's program set: the primary (first) program's
 * default, matching the "first program is primary" convention. Returns null
 * when there is no program to key on, so callers leave the stream untouched
 * rather than forcing a value onto an empty selection.
 */
export function defaultStreamFor(
  programIds: readonly string[],
  startTermId?: TermId | null,
): Stream | null {
  const primary = programIds[0];
  if (!primary) return null;
  return programDefaultStream(primary, startTermId);
}
