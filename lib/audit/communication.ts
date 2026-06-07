import {
  type Program,
  type RuleNode,
  TERM_LETTERS,
  walkRule,
} from "@/lib/programs";

/**
 * The faculty Communication requirement (`degreeRequirements.communication`),
 * e.g. "ARTS160 or ARTS160E" — a pick-one that lives outside the rule tree.
 *
 * `alreadyInTree` guards double-counting: ~1/3 of programs (notably sciences)
 * already list the communication course as required. Callers treat it as
 * standalone only when `alreadyInTree` is false.
 */
export interface CommunicationRequirement {
  title: string;
  /** Catalog codes that satisfy it (the course and its online variant). */
  options: string[];
  /** Courses to complete — always 1 (the options are OR alternatives). */
  need: number;
  /** Distinct placed options, capped at `need`. */
  placed: number;
  /** Those placed option codes, for met chips. */
  satisfiers: string[];
  /** Whether an option is already a named course in the rule tree. */
  alreadyInTree: boolean;
}

/** Every course code named in a program's rule tree (terms or flexible rules). */
function ruleTreeCodes(program: Program): Set<string> {
  const codes = new Set<string>();
  const collect = (n: RuleNode) =>
    walkRule(n, (x) => {
      if (x.kind === "courses") for (const c of x.courses) codes.add(c);
    });
  if (program.kind === "flexible") collect(program.rules);
  else for (const t of TERM_LETTERS) collect(program.terms[t]);
  return codes;
}

/** The communication requirement scored against placed courses, or null if none. */
export function deriveCommunicationRequirement(
  program: Program,
  placedCodes: Iterable<string>,
): CommunicationRequirement | null {
  const comm = program.degreeRequirements?.communication;
  if (!comm || comm.options.length === 0) return null;

  const placed = new Set(placedCodes);
  const satisfiers = comm.options.filter((o) => placed.has(o));
  const treeCodes = ruleTreeCodes(program);
  return {
    title: "Communication requirement",
    options: comm.options,
    need: 1,
    placed: Math.min(satisfiers.length, 1),
    satisfiers,
    alreadyInTree: comm.options.some((o) => treeCodes.has(o)),
  };
}
