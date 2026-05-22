import programsData from "../data/programs.json";

export const TERM_LETTERS = [
  "1A",
  "1B",
  "2A",
  "2B",
  "3A",
  "3B",
  "4A",
  "4B",
] as const;

export type TermLetter = (typeof TERM_LETTERS)[number];

export interface ChoiceGroup {
  description?: string;
  selectCount?: number;
  options: string[];
}

export interface ElectiveCategory {
  description: string;
  unitRequirement?: number;
  approvedCourses?: string[];
}

export interface Specialization {
  slug: string;
  name: string;
  pid: string;
  source?: string;
  requiredCourses?: string[];
  choiceGroups?: ChoiceGroup[];
  electives?: ElectiveCategory[];
}

export interface EngineeringProgram {
  kind: "engineering";
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, string[]>;
  choiceGroupsByTerm?: Record<TermLetter, ChoiceGroup[]>;
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}

export interface FlexibleProgram {
  kind: "flexible";
  name: string;
  asOf: string;
  source?: string;
  requiredCourses: string[];
  choiceGroups?: ChoiceGroup[];
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}

export type Program = EngineeringProgram | FlexibleProgram;

// `resolveJsonModule` widens string literals from imported JSON, so the `kind`
// field comes in as `string` rather than `"engineering" | "flexible"` and the
// discriminated union won't accept it without a cast.
export const PROGRAMS: Record<string, Program> =
  programsData as unknown as Record<string, Program>;

export function isTermLetter(s: string | null | undefined): s is TermLetter {
  return s != null && (TERM_LETTERS as readonly string[]).includes(s);
}

export function isKnownProgram(id: string): boolean {
  return Object.hasOwn(PROGRAMS, id);
}

/**
 * Flat union of all required courses across whatever shape the program has.
 * Engineering: union of every term bucket. Flexible: the explicit list.
 * `choiceGroups*` are intentionally NOT included — those need a student
 * variant pick first (deferred to a future variant-picker modal).
 */
export function getRequiredCourses(program: Program): string[] {
  if (program.kind === "engineering") {
    return [...new Set(Object.values(program.terms).flat())].sort();
  }
  return [...new Set(program.requiredCourses)].sort();
}

export function getTermSchedule(
  program: Program,
): Record<TermLetter, string[]> | null {
  return program.kind === "engineering" ? program.terms : null;
}

/**
 * For engineering programs, returns the union of required courses from every
 * term strictly before `currentTerm`. For flexible programs, returns all
 * `requiredCourses` (the `currentTerm` argument is ignored since flexible
 * programs have no temporal schedule). Codes are deduped and sorted.
 *
 * `currentTerm: null` means "no term selected" — engineering returns []
 * (nothing seeded yet); flexible still returns the full required list.
 *
 * Unknown program → [].
 */
export function inferCompleted(
  programId: string,
  currentTerm: TermLetter | null,
): string[] {
  const program = PROGRAMS[programId];
  if (!program) return [];
  if (program.kind === "flexible")
    return [...new Set(program.requiredCourses)].sort();
  if (currentTerm == null) return [];
  const cutoff = TERM_LETTERS.indexOf(currentTerm);
  const completed = TERM_LETTERS.slice(0, cutoff).flatMap(
    (t) => program.terms[t],
  );
  return [...new Set(completed)].sort();
}
