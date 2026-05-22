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
 *
 * Tree-of-rules is the authoritative shape; `ChoiceGroup` is derived for
 * legacy consumers that haven't migrated yet.
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
      description: string;
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

/** Derived view for consumers that pre-date the rule tree. */
export interface ChoiceGroup {
  description?: string;
  selectMin?: number;
  selectMax?: number;
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
  rules?: RuleNode;
  electives?: ElectiveCategory[];
}

export interface EngineeringProgram {
  kind: "engineering";
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, RuleNode>;
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}

export interface FlexibleProgram {
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

export function walkRule(node: RuleNode, visit: (n: RuleNode) => void): void {
  visit(node);
  if (node.kind === "all" || node.kind === "pick") {
    for (const c of node.children) walkRule(c, visit);
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
function functionallyMandatoryCourses(node: RuleNode): string[] | null {
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
 * Unknown program → [].
 */
export function inferCompleted(
  programId: string,
  currentTerm: TermLetter | null,
): string[] {
  const program = PROGRAMS[programId];
  if (!program) return [];
  if (program.kind === "flexible") return getRequiredCourses(program);
  if (currentTerm == null) return [];
  const cutoff = TERM_LETTERS.indexOf(currentTerm);
  const out = new Set<string>();
  for (const t of TERM_LETTERS.slice(0, cutoff)) {
    for (const c of requiredCoursesIn(program.terms[t])) out.add(c);
  }
  return [...out].sort();
}

/**
 * Flatten every `pick` node in the tree whose direct children are all
 * `courses` leaves into a legacy `ChoiceGroup`. Nested `pick`-of-`pick`
 * (parent-quota constraints) is NOT representable in the flat shape; the
 * inner picks still surface as their own ChoiceGroups. Order: tree-walk
 * order (DFS pre-order), stable across runs.
 */
function flattenChoiceGroupsIn(node: RuleNode, out: ChoiceGroup[]): void {
  if (node.kind === "pick") {
    const leafCourses = node.children
      .filter((c) => c.kind === "courses")
      .flatMap((c) => (c.kind === "courses" ? c.courses : []));
    if (
      leafCourses.length > 0 &&
      node.children.every((c) => c.kind === "courses")
    ) {
      const group: ChoiceGroup = {
        ...(node.description !== undefined
          ? { description: node.description }
          : {}),
        ...(node.selectMin !== undefined ? { selectMin: node.selectMin } : {}),
        ...(node.selectMax !== undefined ? { selectMax: node.selectMax } : {}),
        options: [...new Set(leafCourses)].sort(),
      };
      out.push(group);
      return;
    }
    for (const c of node.children) flattenChoiceGroupsIn(c, out);
    return;
  }
  if (node.kind === "all") {
    for (const c of node.children) flattenChoiceGroupsIn(c, out);
  }
}

export function getChoiceGroups(program: Program): ChoiceGroup[] {
  const out: ChoiceGroup[] = [];
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS) flattenChoiceGroupsIn(program.terms[t], out);
  } else {
    flattenChoiceGroupsIn(program.rules, out);
  }
  return out;
}

/** Choice groups inside a single rule tree. */
export function flattenChoiceGroups(node: RuleNode): ChoiceGroup[] {
  const out: ChoiceGroup[] = [];
  flattenChoiceGroupsIn(node, out);
  return out;
}

export function getChoiceGroupsByTerm(
  program: Program,
): Record<TermLetter, ChoiceGroup[]> | null {
  if (program.kind !== "engineering") return null;
  return Object.fromEntries(
    TERM_LETTERS.map((t) => {
      const groups: ChoiceGroup[] = [];
      flattenChoiceGroupsIn(program.terms[t], groups);
      return [t, groups];
    }),
  ) as Record<TermLetter, ChoiceGroup[]>;
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
