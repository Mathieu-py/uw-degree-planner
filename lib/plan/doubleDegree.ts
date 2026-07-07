import {
  getSpecialization,
  PROGRAMS,
  type Program,
  programShortName,
} from "@/lib/programs";

/** Order-insensitive key for a program-id pair. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("+");
}

/**
 * Standalone plan pairs UW publishes as one packaged double degree, keyed by a
 * sorted pair so lookup ignores order. Only the SDS/BSW plans appear: BBA/BMath
 * and BBA/BCS are omitted because BBA is a Laurier degree with no standalone entry
 * in the UW calendar snapshot — `data/programs.json` holds only the packaged
 * `bba-and-*` plans and a BMath `mathematics-business-administration`, so no
 * hand-picked pair of catalog programs can ever produce them.
 */
const DOUBLE_DEGREE_PAIRS: Record<string, string> = {
  [pairKey("h-social-development-studies", "social-work")]:
    "h-ba-sds-and-h-bsw-double-degree",
  [pairKey("3g-social-development-studies", "social-work")]:
    "3g-ba-sds-and-h-bsw-double-degree",
  [pairKey("4g-social-development-studies", "social-work")]:
    "4g-ba-sds-and-h-bsw-double-degree",
};

export interface DoubleDegreeSuggestion {
  id: string;
  program: Program;
}

/**
 * The packaged double degree a hand-picked pair maps to, or null. Fires only for
 * an exact two-program selection that matches a known packaged plan; ad-hoc
 * combinations (and 1- or 3+-program selections) return null, so hand-picking any
 * other combination stays allowed.
 */
export function suggestedDoubleDegree(
  programIds: readonly string[],
): DoubleDegreeSuggestion | null {
  if (programIds.length !== 2) return null;
  const id = DOUBLE_DEGREE_PAIRS[pairKey(programIds[0], programIds[1])];
  const program = id ? PROGRAMS[id] : undefined;
  return program ? { id, program } : null;
}

/** Canonical "switch to the packaged plan" copy for the suggestion banner. */
export function doubleDegreeSuggestionMessage(program: Program): string {
  return `These two plans are the packaged ${programShortName(program)} — switch for an accurate combined audit.`;
}

/**
 * The selection after accepting the swap: the two standalone ids collapse to the
 * single packaged id. A standalone's specialization carries over only if the
 * packaged plan actually offers that slug — e.g. standalone SDS's `sds-social-work`
 * option has no counterpart in the double degree, so it's dropped.
 */
export function swapToDoubleDegree(
  programIds: readonly string[],
  specializationIds: Record<string, string>,
  doubleDegreeId: string,
): { programIds: string[]; specializationIds: Record<string, string> } {
  const carried: Record<string, string> = {};
  for (const oldId of programIds) {
    const slug = specializationIds[oldId];
    if (slug && getSpecialization(doubleDegreeId, slug)) {
      carried[doubleDegreeId] = slug;
    }
  }
  return { programIds: [doubleDegreeId], specializationIds: carried };
}

/**
 * Onboarding builds specs from the transcript, keyed by the originally-detected
 * program ids. When the student swaps that detected pair for its packaged double
 * degree (#103), re-key any spec the packaged plan still offers so onboarding
 * preserves it too — parity with PlanSettingsModal. No-op unless the selection is
 * exactly that swap (the two-program detection collapsed to the single plan).
 */
export function specsAfterDoubleDegreeSwap(
  detectedProgramIds: readonly string[],
  detectedSpecializationIds: Record<string, string>,
  selectedProgramIds: readonly string[],
): Record<string, string> {
  const swap = suggestedDoubleDegree(detectedProgramIds);
  if (
    swap &&
    selectedProgramIds.length === 1 &&
    selectedProgramIds[0] === swap.id
  ) {
    return swapToDoubleDegree(
      detectedProgramIds,
      detectedSpecializationIds,
      swap.id,
    ).specializationIds;
  }
  return detectedSpecializationIds;
}
