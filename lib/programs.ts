import { z } from "zod";
import programsData from "../data/programs.json";
import { describeRule } from "./requirements/describe";
import {
  type RuleNode,
  RuleNodeSchema,
  type SubjectPoolNode,
} from "./requirements/types";
import { requiredCoursesIn, walkRule } from "./requirements/walk";

// The requirement AST (RuleNode) and helpers live in `lib/requirements`;
// re-export so `@/lib/programs` stays the stable entry point.
export {
  describeRule,
  type RuleNode,
  requiredCoursesIn,
  type SubjectPoolNode,
  walkRule,
};

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

const ElectiveCategorySchema = z.object({
  description: z.string(),
  /** Units required, e.g. 6.0 for "6.0 units of ANTH courses". */
  unitRequirement: z.number().optional(),
  /** Course count required, e.g. 2 for "Complete 2 of the following". */
  requiredCount: z.number().optional(),
  /** Explicit approved-course list (catalog form, lowercase). */
  approvedCourses: z.array(z.string()).optional(),
  /**
   * Subject prefixes for a unit-based bucket with no fixed list — e.g. ["anth"]
   * for "6.0 units of ANTH courses". Lets the audit sum any in-scope course.
   */
  subjectScope: z.array(z.string()).optional(),
  /** Verbatim requirement statement, always shown to preserve exact wording. */
  sourceText: z.string().optional(),
});

export type ElectiveCategory = z.infer<typeof ElectiveCategorySchema>;

/* --------------------------- unit accounting ---------------------------- */
/*
 * No bucketed unit plan is audited; what survives is `totalUnits` and a list of
 * `constraints`. `lib/audit/breadth` re-derives subject-list constraints into
 * course counts; level-only minimums surface verbatim as notes.
 */

/** A degree rule kept as display text (faculty breadth, level minimums). */
const UnitConstraintSchema = z.object({
  label: z.string(),
  sourceText: z.string().optional(),
});

export type UnitConstraint = z.infer<typeof UnitConstraintSchema>;

const UnitPlanSchema = z.object({
  totalUnits: z.number().optional(),
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
 * Which Undergraduate Calendar (Kuali catalog) a program was scraped from.
 * `year` is the catalog's academic span (e.g. "2025-2026").
 */
const CatalogProvenanceSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  year: z.string().optional(),
});

export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;

/**
 * Faculty-wide degree-level requirements shared by every major in a faculty:
 * breadth/level constraints, a communication requirement, and informational
 * items (residency, averages, co-op work terms).
 */
const DegreeRequirementsSchema = z.object({
  kualiId: z.string().optional(),
  name: z.string(),
  source: z.string().optional(),
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
    unverifiedRequirements: z.array(z.string()).optional(),
    catalog: CatalogProvenanceSchema.optional(),
    subjectCode: z.string().optional(),
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
    unverifiedRequirements: z.array(z.string()).optional(),
    catalog: CatalogProvenanceSchema.optional(),
    subjectCode: z.string().optional(),
  }),
]);

export type Program = z.infer<typeof ProgramSchema>;

const ProgramsFileSchema = z.record(z.string(), ProgramSchema);

/**
 * Validate a `slug → Program` map, throwing on the first violation. Parses
 * bundled `programs.json` at import; lets the scraper fail fast before writing.
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
 * Normalized, matchable description of a program, to resolve program-restriction
 * prereqs ("Honours Mathematics students only") to eligible/missing not "check".
 */
export interface ProgramIdentity {
  programId: string;
  /** Lowercased name variants to match restriction text against: short name + aliases. */
  names: string[];
  /** Faculty, or null when it can't be derived confidently from the degree type. */
  faculty: Faculty | null;
}

/**
 * Alternate names per program short name (lowercased) — the vocabulary that
 * resolves prereq program-restrictions to a student's plan, matching the
 * phrasings upstream prose uses ("Architecture students", "BBA/BMath"). Consumed
 * by `programIdentity` + `programShortNames`, NOT by abbreviations (rail/pip
 * codes come from `subjectCode` + `PROGRAM_CODE_OVERRIDES`). Because these are
 * prose tokens, multi-word and slashed forms belong here; they have no subject-
 * code equivalent. A miss only narrows coverage (falls back to "check"), never
 * correctness.
 */
const PROGRAM_RESTRICTION_ALIASES: Record<string, string[]> = {
  "computer science": ["cs"],
  "software engineering": ["se"],
  "systems design engineering": ["syde"],
  // UWFlow says "Architecture students only"; the registry calls these
  // "Architectural Studies" / "Architectural Engineering".
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

/** A program's short name (e.g. "Computer Science"), for compact headers. */
export function programShortName(program: Program): string {
  return shortName(program.name);
}

/**
 * Display-code overrides keyed by lowercased short name, consulted *first* by
 * `programShortCode`. Distinct from `PROGRAM_RESTRICTION_ALIASES` (the eligibility
 * restriction-matching vocabulary): this map exists only to pick a rail/pip
 * code for the cases the official `subjectCode` can't cover —
 *  - name-mismatches: the program's `fieldOfStudy` name doesn't equal any
 *    subject description, but a real subject code exists (ECE, ARCH, …);
 *  - double degrees / interdisciplinary majors that span two subjects, where we
 *    pick one representative code rather than let the heuristic guess.
 */
const PROGRAM_CODE_OVERRIDES: Record<string, string> = {
  "computer engineering": "ECE",
  "electrical engineering": "ECE",
  "architectural studies": "ARCH",
  "architectural engineering": "AE",
  biostatistics: "STAT",
  french: "FR",
  "business administration and mathematics double degree": "BMATH",
  "business administration and computer science double degree": "BCS",
};

/** Most common subject prefix among a program's required courses, or "". */
function modalSubjectCode(program: Program): string {
  const counts = new Map<string, number>();
  for (const code of getRequiredCourses(program)) {
    const m = code.match(/^[A-Za-z]+/);
    if (!m) continue;
    const subj = m[0].toUpperCase();
    counts.set(subj, (counts.get(subj) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [subj, n] of counts) {
    if (n > bestN) {
      best = subj;
      bestN = n;
    }
  }
  return best;
}

/**
 * A terse rail/pip code for a program — "AMATH", "CS", "AFM". Resolution order:
 *   1. a curated `PROGRAM_CODE_OVERRIDES` entry (name-mismatches, double degrees);
 *   2. the official `subjectCode` stamped at scrape time;
 *   3. the most common subject prefix of the program's required courses;
 *   4. initials of the short name ("Systems Design Engineering" → "SDE").
 * Only the initials fallback is length-capped (real subject codes like "AMATH"
 * are returned whole). Always uppercase.
 */
export function programShortCode(program: Program): string {
  const short = shortName(program.name);

  const override = PROGRAM_CODE_OVERRIDES[short.toLowerCase()];
  if (override) return override.toUpperCase();

  if (program.subjectCode) return program.subjectCode.toUpperCase();

  const modal = modalSubjectCode(program);
  if (modal) return modal;

  const initials = short
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (initials || short.slice(0, 3)).slice(0, 4).toUpperCase();
}

/**
 * The credential clause inside a program name's parentheses, normalized for
 * display: "Computer Science (Bachelor of Computer Science - Honours)" →
 * "Bachelor of Computer Science · Honours". Empty string when there's no clause.
 */
export function programCredential(program: Program): string {
  const m = program.name.match(/\(([^)]*)\)/);
  return m ? m[1].replace(/\s-\s/g, " · ").trim() : "";
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
 * Build a {@link ProgramIdentity} for a program (and optional specialization),
 * or null when the program id is unknown. A specialization name, when present,
 * is added as an extra matchable name.
 */
export function programIdentity(
  programId: string | null | undefined,
  specializationId?: string | null,
): ProgramIdentity | null {
  if (!programId) return null;
  const program = PROGRAMS[programId];
  if (!program) return null;
  const short = shortName(program.name).toLowerCase();
  const names = new Set<string>([
    short,
    ...(PROGRAM_RESTRICTION_ALIASES[short] ?? []),
  ]);
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
 * Identities for every program on a plan (double degrees carry more than one),
 * each with its own specialization; unknown ids drop out. Lets eligibility judge
 * a restriction against *all* the student's programs, not just the primary.
 */
export function programIdentities(
  programIds: readonly string[] | null | undefined,
  specializationIds: Record<string, string> = {},
): ProgramIdentity[] {
  return (programIds ?? [])
    .map((id) => programIdentity(id, specializationIds[id] ?? null))
    .filter((p): p is ProgramIdentity => p !== null);
}

/**
 * Join a plan's program names for display — "A + B" for a double degree.
 * `resolve` supplies each name (e.g. `PROGRAMS[id]?.name`); unresolved ids drop,
 * and `fallback` covers the empty result. Centralizes the " + " convention.
 */
export function joinProgramNames(
  programIds: readonly string[],
  resolve: (id: string) => string | null | undefined,
  fallback: string | null = null,
): string | null {
  const joined = programIds.map(resolve).filter(Boolean).join(" + ");
  return joined || fallback;
}

/**
 * Lowercased set of every program short name + alias — the recognition
 * vocabulary for {@link matchProgram}. A restriction resolves to "block" only
 * when every program it names is recognized here.
 */
let shortNamesCache: ReadonlySet<string> | null = null;
export function programShortNames(): ReadonlySet<string> {
  if (shortNamesCache) return shortNamesCache;
  const out = new Set<string>();
  for (const id of Object.keys(PROGRAMS)) {
    const short = shortName(PROGRAMS[id].name).toLowerCase();
    out.add(short);
    for (const alias of PROGRAM_RESTRICTION_ALIASES[short] ?? [])
      out.add(alias);
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
 * The `(id, name, kind)` digest of every program, sorted by name. Shipped to
 * the client instead of full programs.json so the dropdown works without trees.
 */
export function getProgramOptions(): ProgramOption[] {
  return Object.entries(PROGRAMS)
    .map(([id, p]) => ({ id, name: p.name, kind: p.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Program names are "Title (Degree)", e.g. "Applied Mathematics (Joint
 * Honours)". Split off the trailing parenthetical so callers can render the
 * title and degree separately. The nested-paren allowance handles double-degree
 * names that contain a second set of parentheses inside the degree. Names with
 * no parenthetical return `{ title }` with `degree` undefined.
 */
export function splitProgramName(name: string): {
  title: string;
  degree?: string;
} {
  const m = name.match(/^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
  return m ? { title: m[1], degree: m[2] } : { title: name };
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

/**
 * Flat union of all required courses (every term tree for engineering, the
 * single tree for flexible). Choice-group options excluded — those need a pick.
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
  // Only `courses` names explicit codes (`excluded` is forbidden, not
  // referenced; `subjectPool` matches by prefix/level).
  walkRule(root, (n) => {
    if (n.kind === "courses") {
      for (const c of n.courses) out.add(c.toLowerCase());
    }
  });
}

/**
 * Every course code the program (+ optional specialization) references,
 * lowercased. Broader than {@link getRequiredCourses}: includes choice-group
 * options and elective pools. Lets eligibility suppress a stale program
 * restriction (a program can't require a course its own restriction blocks).
 * Memoized.
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
