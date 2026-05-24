import type { TermId } from "../types";

/**
 * Schema version stamped on every persisted `LocalPlan`. Bump when introducing
 * a breaking shape change (renamed field, removed field, changed semantics).
 * `loadPlan` rejects payloads with any other value and stashes the raw blob
 * under `<key>.broken` so we can build a migrator before users lose data.
 */
export const PLAN_SCHEMA_VERSION = 1;

/**
 * Co-op stream determines the cadence of academic and work terms.
 * - "regular": eight contiguous academic terms (1A–4B), no work terms.
 * - "stream8": 1A 1B [WT] 2A [WT] 2B [WT] 3A [WT] 3B [WT] 4A [WT] 4B.
 * - "stream4": 1A 1B 2A [WT WT WT WT WT] 2B 3A 3B 4A 4B (rare, mostly Math).
 */
export type Stream = "regular" | "stream4" | "stream8";

export type TermLetter = "1A" | "1B" | "2A" | "2B" | "3A" | "3B" | "4A" | "4B";

export type CoopLabel = `coop${1 | 2 | 3 | 4 | 5 | 6}`;

/**
 * Position of a slot in the student's program path. Stored on the slot at
 * sequence-construction time so we don't recompute it on every render.
 *
 * - TermLetter: a normal academic term, 1A through 4B.
 * - CoopLabel: a co-op work term, numbered in placement order.
 * - "pre": synthetic pre-arrival slot holding transfer credits.
 */
export type SlotPosition = TermLetter | CoopLabel | "pre";

export interface SlotCourse {
  /** Lowercase course code, matches the catalog form (e.g. "cs246"). */
  code: string;
  /** Optional grade. "87", "CR", "IP", "WD", etc. Free-form for now. */
  grade?: string;
}

export interface PlanSlot {
  /** Stable UUID for client-side identification. */
  id: string;
  /** Calendar term (e.g. 1259 Fall 2025). Null only for the "pre" slot. */
  termId: TermId | null;
  position: SlotPosition;
  isCoop: boolean;
  courses: SlotCourse[];
}

export interface LocalPlan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  programId: string | null;
  specializationId: string | null;
  stream: Stream;
  /** Calendar term ID of the student's 1A. Null until set during onboarding. */
  startTermId: TermId | null;
  slots: PlanSlot[];
  /** ISO-8601 timestamp of last save. */
  updatedAt: string;
}
