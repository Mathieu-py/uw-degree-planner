import type { TermId } from "@/lib/terms";

/**
 * Schema version stamped on every persisted `LocalPlan`. Bump on a breaking
 * shape change; `loadPlan` rejects other values, parks the raw blob under
 * `<key>.broken`, and the user starts fresh — there is intentionally no legacy
 * migrator.
 */
export const PLAN_SCHEMA_VERSION = 3;

/**
 * Co-op stream: the cadence of academic and work terms. Authoritative tables
 * in `CADENCE` (plan/sequence.ts).
 * - "regular": 1A–4B contiguous, no work terms.
 * - "stream4": a work term between every academic term through 3B.
 * - "stream8": six work terms, two back-to-back before 4A.
 */
/**
 * The stream slugs as a runtime tuple — single source of truth shared by the
 * `Stream` type (derived below) and the zod `z.enum(...)` validators in
 * `lib/plan/storage.ts` and `lib/plan/server/validate.ts`, so the compile-time
 * union and the runtime enum can't drift apart.
 */
export const STREAM_VALUES = ["regular", "stream4", "stream8"] as const;

export type Stream = (typeof STREAM_VALUES)[number];

/**
 * The three streams as `{ value, label }`, ordered for display. Shared by the
 * onboarding setup/review screens and Plan Settings so the segmented co-op
 * control reads the same everywhere. Labels are kept short to fit the three
 * side-by-side segments.
 */
export const STREAM_OPTIONS: ReadonlyArray<{ value: Stream; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "stream4", label: "Stream 4 co-op" },
  { value: "stream8", label: "Stream 8 co-op" },
];

export type TermLetter = "1A" | "1B" | "2A" | "2B" | "3A" | "3B" | "4A" | "4B";

export type CoopLabel = `coop${1 | 2 | 3 | 4 | 5 | 6}`;

/**
 * Position of a slot in the program path, stored at sequence-construction time
 * so it isn't recomputed each render.
 * - TermLetter: an academic term, 1A–4B.
 * - CoopLabel: a work term, numbered in placement order.
 * - "pre": synthetic pre-arrival slot for transfer credits.
 */
export type SlotPosition = TermLetter | CoopLabel | "pre";

/**
 * Every `SlotPosition` value as a runtime tuple — the single source the
 * localStorage schema (`storage.ts`) and the server snapshot schema
 * (`server/validate.ts`) both build their `z.enum` from, so the two can't
 * drift. Order is cosmetic; membership is what the schemas check.
 */
export const SLOT_POSITIONS = [
  "1A",
  "1B",
  "2A",
  "2B",
  "3A",
  "3B",
  "4A",
  "4B",
  "coop1",
  "coop2",
  "coop3",
  "coop4",
  "coop5",
  "coop6",
  "pre",
] as const satisfies readonly SlotPosition[];

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
  /**
   * Programs this plan audits against. Empty = none picked. Usually one; a
   * double-degree student (two `Plan:` lines on their transcript) has two. The
   * first is the "primary" for display purposes (it anchors faculty-wide
   * eligibility lookups), but each program carries its own specialization.
   */
  programIds: string[];
  /**
   * Per-program specialization: `programId → specialization slug`. A UW
   * specialization is scoped to one program, so a double-degree student can
   * hold one on each side independently. A **missing key means no
   * specialization** for that program — empty entries are omitted, never stored
   * as null.
   */
  specializationIds: Record<string, string>;
  stream: Stream;
  /** Calendar term ID of the student's 1A. Null until set during onboarding. */
  startTermId: TermId | null;
  slots: PlanSlot[];
  /**
   * Per-program acknowledgement of `unverifiedRequirements` (`programId → acked
   * texts`): rules the scraper couldn't make machine-checkable, which the student
   * confirms to clear the 100% headline. Keyed by verbatim text (the only stable
   * id — re-wordings should re-prompt). Optional for earlier plans; the server
   * round-trip normalizes to `{}`, so `ServerPlan` has it required.
   */
  acknowledgedRequirements?: Record<string, string[]>;
  /** ISO-8601 timestamp of last save. */
  updatedAt: string;
}
