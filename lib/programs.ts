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

/**
 * Recursive AST for program requirements. Mirrors the pattern in
 * `lib/prereqs/parse.ts` — discriminated union, walkable via `walkRule`.
 */
export type RuleNode =
  | { kind: "all"; description?: string; children: RuleNode[] }
  | {
      kind: "pick";
      description?: string;
      selectMin?: number;
      selectMax?: number;
      children: RuleNode[];
    }
  | {
      kind: "subjectPool";
      // Optional — present only when the parser couldn't derive the prose
      // structurally (rare, defensive escape hatch). The standard display
      // string is reconstructed by `describeRule(node)`.
      description?: string;
      // `selectCount` is always exactly-N (semantically equivalent to
      // `selectMin === selectMax === N` on `pick`). The field name differs
      // because subject pools never carry a range in Kuali's prose — they're
      // emitted as "Complete N additional <SUBJECT> courses …".
      selectCount: number;
      subjectCodes: string[];
      minLevel?: number;
      maxLevel?: number;
      // Free-form prose clauses (e.g. "excluding courses cross-listed with a
      // CO course"). Human-readable, not machine-actionable — display verbatim.
      exclusions?: string[];
    }
  | { kind: "courses"; courses: string[] }
  | { kind: "excluded"; description?: string; courses: string[] };

export type SubjectPoolNode = Extract<RuleNode, { kind: "subjectPool" }>;

export interface ElectiveCategory {
  description: string;
  unitRequirement?: number;
  approvedCourses?: string[];
}

export interface Specialization {
  slug: string;
  name: string;
  kualiId: string;
  source?: string;
  rules?: RuleNode;
  electives?: ElectiveCategory[];
}

interface EngineeringProgram {
  kind: "engineering";
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, RuleNode>;
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}

interface FlexibleProgram {
  kind: "flexible";
  name: string;
  asOf: string;
  source?: string;
  rules: RuleNode;
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

export function getSpecialization(
  programId: string,
  specializationSlug: string,
): Specialization | null {
  const program = PROGRAMS[programId];
  return (
    program?.specializations?.find((s) => s.slug === specializationSlug) ?? null
  );
}

export function isKnownSpecialization(
  programId: string,
  specializationSlug: string,
): boolean {
  return getSpecialization(programId, specializationSlug) !== null;
}

export function walkRule(node: RuleNode, visit: (n: RuleNode) => void): void {
  visit(node);
  if (node.kind === "all" || node.kind === "pick") {
    for (const c of node.children) walkRule(c, visit);
  }
}

/**
 * Derive the display prose for a rule node from its structure. The scraper
 * deliberately omits these standard phrasings from `data/programs.json` to
 * keep the file small and avoid duplication; consumers reconstruct them on
 * demand here.
 *
 * Returns `undefined` for leaves (`courses`) and for nodes whose stored
 * `description` should win (a non-standard wrapper text the parser couldn't
 * fold into a recognized shape — currently no such cases exist in the data
 * but the type allows it).
 */
export function describeRule(node: RuleNode): string | undefined {
  switch (node.kind) {
    case "courses":
      return undefined;
    case "all":
      return node.description ?? "Complete all of the following";
    case "excluded":
      return (
        node.description ??
        "The following cannot be used towards this academic plan"
      );
    case "pick": {
      if (node.description !== undefined) return node.description;
      const { selectMin, selectMax, children } = node;
      if (selectMin === undefined && selectMax === undefined) {
        return "Choose any of the following";
      }
      if (selectMin === undefined && selectMax !== undefined) {
        return `Complete no more than ${selectMax} from the following`;
      }
      // metaParent shape: a pick whose children are themselves rules (not a
      // single `courses` leaf) emits the variant "from … choices" phrasing.
      // The leaf form wraps a single courses leaf with "of the following".
      const isMetaParent =
        children.length !== 1 || children[0].kind !== "courses";
      if (selectMin === selectMax && selectMin !== undefined) {
        const noun = selectMin === 1 ? "course" : "courses";
        return isMetaParent
          ? `Complete ${selectMin} ${noun} from the following choices`
          : `Complete ${selectMin} of the following`;
      }
      if (selectMin !== undefined && selectMax === undefined) {
        const noun = selectMin === 1 ? "course" : "courses";
        return isMetaParent
          ? `Complete at least ${selectMin} ${noun} from the following choices`
          : `Complete at least ${selectMin} of the following`;
      }
      // Remaining shape: both bounds defined and unequal (the equal case is
      // handled above).
      return isMetaParent
        ? `Complete between ${selectMin} and ${selectMax} courses from the following choices`
        : `Complete between ${selectMin} and ${selectMax} of the following`;
    }
    case "subjectPool": {
      if (node.description !== undefined) return node.description;
      const singleSubject =
        node.subjectCodes.length === 1 ? `${node.subjectCodes[0]} ` : "";
      const level =
        node.minLevel !== undefined && node.maxLevel !== undefined
          ? ` at the ${node.minLevel}- or ${node.maxLevel}-level`
          : node.minLevel !== undefined
            ? ` at the ${node.minLevel}-level`
            : "";
      const fromList =
        node.subjectCodes.length > 1
          ? ` from: ${node.subjectCodes.join(", ")}`
          : "";
      const exclusions =
        node.exclusions && node.exclusions.length > 0
          ? `; ${node.exclusions.join("; ")}`
          : "";
      const noun = node.selectCount === 1 ? "course" : "courses";
      return `Complete ${node.selectCount} additional ${singleSubject}${noun}${level}${fromList}${exclusions}`;
    }
  }
}

/**
 * A `pick` whose `selectMin` equals the total number of unique course-leaf
 * options is functionally mandatory — the student must take every listed
 * course. Kuali emits some single-course mandatory rules as `pick(1,1)` over
 * one course rather than `all` + courses, and this predicate recovers them.
 *
 * Returns the flat list of course codes if the node qualifies, else null.
 */
export function functionallyMandatoryCourses(node: RuleNode): string[] | null {
  if (node.kind !== "pick" || node.selectMin === undefined) return null;
  const leafCourses: string[] = [];
  for (const c of node.children) {
    if (c.kind !== "courses") return null;
    leafCourses.push(...c.courses);
  }
  return new Set(leafCourses).size === node.selectMin ? leafCourses : null;
}

function collectRequired(
  node: RuleNode,
  inAllOnly: boolean,
  out: Set<string>,
): void {
  if (node.kind === "courses") {
    if (inAllOnly) for (const c of node.courses) out.add(c);
    return;
  }
  if (node.kind === "subjectPool" || node.kind === "excluded") return;
  if (inAllOnly) {
    const mandatory = functionallyMandatoryCourses(node);
    if (mandatory !== null) {
      for (const c of mandatory) out.add(c);
      return;
    }
  }
  const childAllOnly = inAllOnly && node.kind === "all";
  for (const c of node.children) collectRequired(c, childAllOnly, out);
}

/** Required courses inside a single rule tree (courses under all-only paths). */
export function requiredCoursesIn(node: RuleNode): string[] {
  const out = new Set<string>();
  collectRequired(node, true, out);
  return [...out].sort();
}

/**
 * Flat union of all required courses across whatever shape the program has.
 * Engineering: union of every term tree. Flexible: the program's single tree.
 * Choice-group options are intentionally NOT included — those need a student
 * variant pick first (deferred to the variant-picker modal).
 */
export function getRequiredCourses(program: Program): string[] {
  if (program.kind === "engineering") {
    const out = new Set<string>();
    for (const t of TERM_LETTERS) {
      for (const c of requiredCoursesIn(program.terms[t])) out.add(c);
    }
    return [...out].sort();
  }
  return requiredCoursesIn(program.rules);
}

export function getTermSchedule(
  program: Program,
): Record<TermLetter, string[]> | null {
  if (program.kind !== "engineering") return null;
  return Object.fromEntries(
    TERM_LETTERS.map((t) => [t, requiredCoursesIn(program.terms[t])]),
  ) as Record<TermLetter, string[]>;
}

/**
 * For engineering programs, returns the union of required courses from every
 * term strictly before `currentTerm`. For flexible programs, returns all
 * required courses (the `currentTerm` argument is ignored since flexible
 * programs have no temporal schedule). Codes are deduped and sorted.
 *
 * `currentTerm: null` means "no term selected" — engineering returns []
 * (nothing seeded yet); flexible still returns the full required list.
 *
 * If `specializationId` resolves on the program, the spec's tree-derived
 * required courses are unioned in regardless of term (specs are thematic
 * focuses, not temporal schedules).
 *
 * Unknown program → []. Unknown specialization (or program with no specs) →
 * parent-only result.
 */
export function inferCompleted(
  programId: string,
  currentTerm: TermLetter | null,
  specializationId: string | null = null,
): string[] {
  const program = PROGRAMS[programId];
  if (!program) return [];
  const out = new Set<string>();
  if (program.kind === "flexible") {
    for (const c of getRequiredCourses(program)) out.add(c);
  } else if (currentTerm != null) {
    const cutoff = TERM_LETTERS.indexOf(currentTerm);
    for (const t of TERM_LETTERS.slice(0, cutoff)) {
      for (const c of requiredCoursesIn(program.terms[t])) out.add(c);
    }
  }
  if (specializationId) {
    const spec = getSpecialization(programId, specializationId);
    if (spec?.rules) {
      for (const c of requiredCoursesIn(spec.rules)) out.add(c);
    }
  }
  return [...out].sort();
}

export function getSubjectPools(program: Program): SubjectPoolNode[] {
  const out: SubjectPoolNode[] = [];
  const visit = (n: RuleNode) => {
    if (n.kind === "subjectPool") out.push(n);
  };
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS) walkRule(program.terms[t], visit);
  } else {
    walkRule(program.rules, visit);
  }
  return out;
}

/**
 * Courses explicitly excluded from counting towards the program (Kuali's
 * "The following cannot be used towards this academic plan" rule). The
 * seeder should warn — not auto-complete — if a student claims any of these.
 */
export function getExcludedCourses(program: Program): string[] {
  const out = new Set<string>();
  const visit = (n: RuleNode) => {
    if (n.kind === "excluded") for (const c of n.courses) out.add(c);
  };
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS) walkRule(program.terms[t], visit);
  } else {
    walkRule(program.rules, visit);
  }
  return [...out].sort();
}
