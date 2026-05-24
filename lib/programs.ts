import { z } from "zod";
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
 * Schemas below use `z.lazy` for the self-reference. `selectCount` on
 * `subjectPool` is exactly-N (semantically `selectMin === selectMax === N`
 * on `pick`); the field name differs because Kuali emits subject pools as
 * "Complete N additional <SUBJECT> courses …" with no range form.
 */
const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("all"),
      description: z.string().optional(),
      children: z.array(RuleNodeSchema),
    }),
    z.object({
      kind: z.literal("pick"),
      description: z.string().optional(),
      selectMin: z.number().optional(),
      selectMax: z.number().optional(),
      children: z.array(RuleNodeSchema),
    }),
    z.object({
      kind: z.literal("subjectPool"),
      description: z.string().optional(),
      selectCount: z.number(),
      subjectCodes: z.array(z.string()),
      minLevel: z.number().optional(),
      maxLevel: z.number().optional(),
      exclusions: z.array(z.string()).optional(),
    }),
    z.object({
      kind: z.literal("courses"),
      courses: z.array(z.string()),
    }),
    z.object({
      kind: z.literal("excluded"),
      description: z.string().optional(),
      courses: z.array(z.string()),
    }),
  ]),
);

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
      description?: string;
      selectCount: number;
      subjectCodes: string[];
      minLevel?: number;
      maxLevel?: number;
      exclusions?: string[];
    }
  | { kind: "courses"; courses: string[] }
  | { kind: "excluded"; description?: string; courses: string[] };

export type SubjectPoolNode = Extract<RuleNode, { kind: "subjectPool" }>;

const ElectiveCategorySchema = z.object({
  description: z.string(),
  unitRequirement: z.number().optional(),
  approvedCourses: z.array(z.string()).optional(),
});

export type ElectiveCategory = z.infer<typeof ElectiveCategorySchema>;

const SpecializationSchema = z.object({
  slug: z.string(),
  name: z.string(),
  kualiId: z.string(),
  source: z.string().optional(),
  rules: RuleNodeSchema.optional(),
  electives: z.array(ElectiveCategorySchema).optional(),
});

export type Specialization = z.infer<typeof SpecializationSchema>;

const TermsSchema = z.object({
  "1A": RuleNodeSchema,
  "1B": RuleNodeSchema,
  "2A": RuleNodeSchema,
  "2B": RuleNodeSchema,
  "3A": RuleNodeSchema,
  "3B": RuleNodeSchema,
  "4A": RuleNodeSchema,
  "4B": RuleNodeSchema,
});

const ProgramSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("engineering"),
    name: z.string(),
    asOf: z.string(),
    source: z.string().optional(),
    terms: TermsSchema,
    electives: z.array(ElectiveCategorySchema).optional(),
    specializations: z.array(SpecializationSchema).optional(),
  }),
  z.object({
    kind: z.literal("flexible"),
    name: z.string(),
    asOf: z.string(),
    source: z.string().optional(),
    rules: RuleNodeSchema,
    electives: z.array(ElectiveCategorySchema).optional(),
    specializations: z.array(SpecializationSchema).optional(),
  }),
]);

export type Program = z.infer<typeof ProgramSchema>;

export const PROGRAMS: Record<string, Program> = z
  .record(z.string(), ProgramSchema)
  .parse(programsData);

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
