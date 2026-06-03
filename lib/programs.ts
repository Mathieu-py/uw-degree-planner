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
  /** Units required, e.g. 6.0 for "6.0 units of ANTH courses". */
  unitRequirement: z.number().optional(),
  /** Course count required, e.g. 2 for "Complete 2 of the following". */
  requiredCount: z.number().optional(),
  /** Explicit approved-course list (catalog form, lowercase). */
  approvedCourses: z.array(z.string()).optional(),
  /**
   * Subject prefixes that satisfy a unit-based bucket when there's no fixed
   * list — e.g. ["anth"] for "6.0 units of ANTH courses". Lets the audit sum
   * the units of any in-scope placed course instead of leaving it untracked.
   */
  subjectScope: z.array(z.string()).optional(),
  /**
   * Verbatim requirement statement from the UW source. Always shown to the
   * student so the exact wording is preserved even when our structured parse
   * is partial.
   */
  sourceText: z.string().optional(),
});

export type ElectiveCategory = z.infer<typeof ElectiveCategorySchema>;

/* --------------------------- unit accounting ---------------------------- */
/*
 * UW degrees are measured in units (credits), not course counts: "21.5 units
 * total = 9.0 required + 7.0 BIOL + 5.5 elective, min 14.5 at the 200-level".
 * A `UnitPlan` captures that bucketed total so the audit can allocate every
 * placed course's catalog units across buckets (most-specific first) and report
 * exact unit progress. Buckets also carry the faculty degree-level requirements
 * (breadth) via `degreeRequirements`.
 */

/** What counts toward a unit bucket. */
const UnitScopeSchema = z.discriminatedUnion("kind", [
  // The program's own required courses (their units, wherever placed).
  z.object({ kind: z.literal("required") }),
  // Any course in these subjects (optionally at/above a level), e.g. BIOL.
  z.object({
    kind: z.literal("subject"),
    subjects: z.array(z.string()),
    minLevel: z.number().optional(),
  }),
  // Any course NOT in these subjects, e.g. "non-math units" (Math faculty).
  z.object({
    kind: z.literal("subjectExcept"),
    exclude: z.array(z.string()),
    minLevel: z.number().optional(),
  }),
  // A fixed approved-course list.
  z.object({ kind: z.literal("list"), courses: z.array(z.string()) }),
  // Free electives: any units left after the specific buckets are filled.
  z.object({ kind: z.literal("open") }),
]);

export type UnitScope = z.infer<typeof UnitScopeSchema>;

const UnitBucketSchema = z.object({
  id: z.string(),
  label: z.string(),
  requiredUnits: z.number(),
  scope: UnitScopeSchema,
  sourceText: z.string().optional(),
});

export type UnitBucket = z.infer<typeof UnitBucketSchema>;

/** A non-bucket degree rule, e.g. "min 14.5 units at the 200-level or above". */
const UnitConstraintSchema = z.object({
  label: z.string(),
  minUnits: z.number().optional(),
  minLevel: z.number().optional(),
  sourceText: z.string().optional(),
});

export type UnitConstraint = z.infer<typeof UnitConstraintSchema>;

const UnitPlanSchema = z.object({
  totalUnits: z.number().optional(),
  buckets: z.array(UnitBucketSchema),
  constraints: z.array(UnitConstraintSchema).optional(),
});

export type UnitPlan = z.infer<typeof UnitPlanSchema>;

/** A degree rule we surface verbatim but don't progress-track (residency etc.). */
const InformationalItemSchema = z.object({
  label: z.string(),
  text: z.string(),
});

export type InformationalItem = z.infer<typeof InformationalItemSchema>;

/**
 * Faculty-wide "Bachelor of X degree-level requirements" shared by every major
 * in that faculty: breadth buckets, a communication requirement, unit minimums,
 * and informational items (residency, averages, co-op work terms).
 */
const DegreeRequirementsSchema = z.object({
  kualiId: z.string().optional(),
  name: z.string(),
  source: z.string().optional(),
  buckets: z.array(UnitBucketSchema).optional(),
  communication: z
    .object({
      options: z.array(z.string()),
      sourceText: z.string().optional(),
    })
    .optional(),
  constraints: z.array(UnitConstraintSchema).optional(),
  informational: z.array(InformationalItemSchema).optional(),
});

export type DegreeRequirements = z.infer<typeof DegreeRequirementsSchema>;

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
    unitPlan: UnitPlanSchema.optional(),
    degreeRequirements: DegreeRequirementsSchema.optional(),
    informational: z.array(InformationalItemSchema).optional(),
    specializations: z.array(SpecializationSchema).optional(),
  }),
  z.object({
    kind: z.literal("flexible"),
    name: z.string(),
    asOf: z.string(),
    source: z.string().optional(),
    rules: RuleNodeSchema,
    electives: z.array(ElectiveCategorySchema).optional(),
    unitPlan: UnitPlanSchema.optional(),
    degreeRequirements: DegreeRequirementsSchema.optional(),
    informational: z.array(InformationalItemSchema).optional(),
    specializations: z.array(SpecializationSchema).optional(),
  }),
]);

export type Program = z.infer<typeof ProgramSchema>;

const ProgramsFileSchema = z.record(z.string(), ProgramSchema);

/**
 * Validate a `slug → Program` map, throwing on the first schema violation.
 * Used both to parse the bundled `programs.json` at import and by the scraper
 * to fail fast before it writes a malformed file the app couldn't load.
 */
export function validatePrograms(raw: unknown): Record<string, Program> {
  return ProgramsFileSchema.parse(raw);
}

export const PROGRAMS: Record<string, Program> = validatePrograms(programsData);

/** The six UWaterloo undergraduate faculties a program can belong to. */
export type Faculty =
  | "engineering"
  | "mathematics"
  | "arts"
  | "science"
  | "environment"
  | "health";

/**
 * Normalized, matchable description of the student's program, used to resolve
 * program-restriction prereqs (e.g. "Honours Mathematics students only") to a
 * definite eligible/missing instead of "check". Derived from {@link PROGRAMS}.
 */
export interface ProgramIdentity {
  programId: string;
  /** Lowercased name variants to match restriction text against: short name + aliases. */
  names: string[];
  /** Faculty, or null when it can't be derived confidently from the degree type. */
  faculty: Faculty | null;
}

/**
 * Curated aliases keyed by program short name (lowercased). UWFlow restriction
 * text uses abbreviations the registry names don't ("CS", "SE", "BBA/BMath");
 * a miss here only narrows coverage (falls back to "check"), never correctness.
 */
const PROGRAM_ALIASES: Record<string, string[]> = {
  "computer science": ["cs"],
  "software engineering": ["se"],
  "systems design engineering": ["syde"],
  // UWFlow restriction text says "Architecture students only"; the registry
  // calls these programs "Architectural Studies" / "Architectural Engineering".
  "architectural studies": ["architecture"],
  "architectural engineering": ["architecture"],
  "accounting and financial management": ["afm"],
  "computing and financial management": ["cfm"],
  "mathematical finance": ["math fin", "math finance"],
  "business administration and mathematics double degree": [
    "bba/bmath",
    "bba and bmath",
    "busmath",
  ],
  "business administration and computer science double degree": [
    "bba/bcs",
    "bba and bcs",
    "bba/bmath or bba/cs",
  ],
};

/** Degree-type substring (inside the program name's parentheses) → faculty. */
const DEGREE_FACULTY: Array<[string, Faculty]> = [
  ["bachelor of applied science", "engineering"],
  ["bachelor of software engineering", "engineering"],
  ["bachelor of architectural studies", "engineering"],
  ["bachelor of mathematics", "mathematics"],
  ["bachelor of computer science", "mathematics"],
  ["bachelor of computing and financial management", "mathematics"],
  ["bachelor of environmental studies", "environment"],
  ["bachelor of arts", "arts"],
  ["bachelor of science", "science"],
  ["bachelor of public health", "health"],
];

/** Short name = program name up to the first " (" (e.g. "Computer Science"). */
function shortName(name: string): string {
  const paren = name.indexOf(" (");
  return (paren === -1 ? name : name.slice(0, paren)).trim();
}

/** Faculty from the degree-type clause inside the name, or null if ambiguous. */
function facultyFromName(name: string): Faculty | null {
  const lower = name.toLowerCase();
  for (const [needle, faculty] of DEGREE_FACULTY) {
    if (lower.includes(needle)) return faculty;
  }
  return null;
}

/**
 * Build a {@link ProgramIdentity} for the student's program (and optional
 * specialization), or null when the program id is unknown. The specialization
 * name, when present, is added as an extra matchable name.
 */
export function programIdentity(
  programId: string | null | undefined,
  specializationId?: string | null,
): ProgramIdentity | null {
  if (!programId) return null;
  const program = PROGRAMS[programId];
  if (!program) return null;
  const short = shortName(program.name).toLowerCase();
  const names = new Set<string>([short, ...(PROGRAM_ALIASES[short] ?? [])]);
  if (specializationId) {
    const spec = getSpecialization(programId, specializationId);
    if (spec) names.add(spec.name.toLowerCase());
  }
  return {
    programId,
    names: [...names],
    faculty: facultyFromName(program.name),
  };
}

/**
 * Lowercased set of every program short name + alias in the registry. Serves as
 * the recognition vocabulary for {@link matchProgram}: a restriction can only be
 * resolved to a definite "block" when every program it names is recognized here
 * (otherwise we can't be sure the student isn't in an unrecognized synonym).
 */
let shortNamesCache: ReadonlySet<string> | null = null;
export function programShortNames(): ReadonlySet<string> {
  if (shortNamesCache) return shortNamesCache;
  const out = new Set<string>();
  for (const id of Object.keys(PROGRAMS)) {
    const short = shortName(PROGRAMS[id].name).toLowerCase();
    out.add(short);
    for (const alias of PROGRAM_ALIASES[short] ?? []) out.add(alias);
  }
  shortNamesCache = out;
  return out;
}

export function isTermLetter(s: string | null | undefined): s is TermLetter {
  return s != null && (TERM_LETTERS as readonly string[]).includes(s);
}

export function isKnownProgram(id: string): boolean {
  return Object.hasOwn(PROGRAMS, id);
}

export interface ProgramOption {
  id: string;
  name: string;
  kind: Program["kind"];
}

/**
 * The `(id, name, kind)` digest of every program, sorted by name. Server
 * components ship this to the client instead of the full programs.json so the
 * planner / onboarding UI can populate a program dropdown without the rule
 * trees. Callers that only need `(id, name)` accept the richer shape fine.
 */
export function getProgramOptions(): ProgramOption[] {
  return Object.entries(PROGRAMS)
    .map(([id, p]) => ({ id, name: p.name, kind: p.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A flat `id → name` lookup for labelling plan cards client-side. */
export function programNameMap(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PROGRAMS).map(([id, p]) => [id, p.name]),
  );
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

const EMPTY_CODE_SET: ReadonlySet<string> = new Set();
const referencedCodesCache = new Map<string, ReadonlySet<string>>();

/** Collect every explicit course code a rule tree names (lowercased). */
function collectReferenced(root: RuleNode, out: Set<string>): void {
  // Only `courses` names explicit codes; `excluded` is forbidden (not
  // referenced) and `subjectPool` matches by prefix/level.
  walkRule(root, (n) => {
    if (n.kind === "courses") {
      for (const c of n.courses) out.add(c.toLowerCase());
    }
  });
}

/**
 * Every course code the program (and optional specialization) references,
 * lowercased. Broader than {@link getRequiredCourses} — includes choice-group
 * options and elective pools. Used by the eligibility core to suppress a stale
 * program restriction (`suppressProgramBlock`): a program can't sensibly require
 * a course its own restriction would block. Memoized on the static program data.
 */
export function programReferencedCodes(
  programId: string | null | undefined,
  specializationId?: string | null,
): ReadonlySet<string> {
  if (!programId) return EMPTY_CODE_SET;
  const key = `${programId}::${specializationId ?? ""}`;
  const cached = referencedCodesCache.get(key);
  if (cached) return cached;

  const program = PROGRAMS[programId];
  if (!program) {
    referencedCodesCache.set(key, EMPTY_CODE_SET);
    return EMPTY_CODE_SET;
  }

  const out = new Set<string>();
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS) collectReferenced(program.terms[t], out);
  } else {
    collectReferenced(program.rules, out);
  }
  for (const e of program.electives ?? []) {
    for (const c of e.approvedCourses ?? []) out.add(c.toLowerCase());
  }
  if (specializationId) {
    const spec = getSpecialization(programId, specializationId);
    if (spec?.rules) collectReferenced(spec.rules, out);
    for (const e of spec?.electives ?? []) {
      for (const c of e.approvedCourses ?? []) out.add(c.toLowerCase());
    }
  }

  referencedCodesCache.set(key, out);
  return out;
}
