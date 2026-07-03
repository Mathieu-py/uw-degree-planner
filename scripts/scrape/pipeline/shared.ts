/**
 * Shared building blocks for the program-scrape pipeline: calendar-view URL
 * base, fetch pacing, and the DTO/result types the phases pass between each
 * other. The phase logic lives in `./programs`, `./specializations`,
 * `./degrees`; orchestration in `./run`.
 */
import type { Program, Specialization } from "../../../lib/programs";

export const VIEW_BASE =
  "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs";
const FETCH_DELAY_MS = 200;

export interface ProgramListEntry {
  pid: string;
  code: string;
  title: string;
  undergraduateCredentialType?: { name?: string };
  fieldOfStudy?: { name?: string };
}

export interface ProgramDetail extends ProgramListEntry {
  /** Calendar's faculty label, e.g. `{ name: "Faculty of Mathematics" }`. */
  facultyCalendarDisplay?: { name?: string };
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  graduationRequirements?: string;
  courseListsNew?: string;
  specializationsList?: string;
  /**
   * Free-prose calendar notes carried through as `informational` (where list
   * defs and discretionary "see your advisor" rules live). See #117.
   */
  additionalConstraints?: string;
}

export interface SpecializationRef {
  id: string;
  name: string;
}

export interface PhaseAResult {
  programs: Record<string, Program>;
  specRefsByParent: Map<string, SpecializationRef[]>;
  /** Each program's referenced "Bachelor of X degree-level requirements" pid. */
  degreeRefBySlug: Map<string, { pid: string; name: string }>;
  /** Free electives dropped from a program's rule tree, re-surfaced later for
   *  programs that end up with no totalUnits denominator. See FREE_ELECTIVE_RE. */
  freeElectivesBySlug: Map<string, string[]>;
  withData: number;
  skippedNoData: string[];
  failed: string[];
  warnings: string[];
}

export interface PhaseBResult {
  specById: Map<string, Specialization>;
  failedSpecs: string[];
  warnings: string[];
  uniqueSpecIds: readonly string[];
}

/**
 * Iterate `items` sequentially with a polite delay. Each iteration prints
 * `[i/N] <label>... ` plus the caller's result or `ERROR: <message>`. State
 * recording is the caller's job via `onResult` / `onError`. Shared by Phase A
 * and Phase B.
 */
export async function fetchEachPaced<T, R>(opts: {
  items: readonly T[];
  label: (item: T) => string;
  fetcher: (item: T) => Promise<R>;
  onResult: (result: R, item: T) => string;
  onError: (item: T, message: string) => void;
}): Promise<void> {
  const { items, label, fetcher, onResult, onError } = opts;
  const total = items.length;
  for (let i = 0; i < total; i++) {
    const item = items[i];
    process.stdout.write(`[${i + 1}/${total}] ${label(item)}... `);
    try {
      const r = await fetcher(item);
      console.log(onResult(r, item));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(item, msg);
      console.log(`ERROR: ${msg}`);
    }
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }
}
