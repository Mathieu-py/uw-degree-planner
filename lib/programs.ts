import programsData from "../data/programs.json";

export const TERM_LETTERS = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"] as const;

export type TermLetter = typeof TERM_LETTERS[number];

export interface Program {
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, string[]>;
}

export const PROGRAMS: Record<string, Program> = programsData as Record<string, Program>;

export function isTermLetter(s: string | null | undefined): s is TermLetter {
  return s != null && (TERM_LETTERS as readonly string[]).includes(s);
}

export function isKnownProgram(id: string | null | undefined): boolean {
  return id != null && Object.prototype.hasOwnProperty.call(PROGRAMS, id);
}

/**
 * Returns the union of required courses from every term strictly before
 * `currentTerm`. Codes are deduped and sorted. Unknown program → [].
 */
export function inferCompleted(programId: string, currentTerm: TermLetter): string[] {
  const program = PROGRAMS[programId];
  if (!program) return [];
  const cutoff = TERM_LETTERS.indexOf(currentTerm);
  const codes = new Set<string>();
  for (let i = 0; i < cutoff; i++) {
    const termCodes = program.terms[TERM_LETTERS[i]];
    if (termCodes) for (const c of termCodes) codes.add(c);
  }
  return [...codes].sort();
}
