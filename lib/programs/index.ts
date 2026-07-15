/**
 * The programs subsystem, one directory, four tiers:
 * - `index.ts` (this file) — pure types + helpers, no data imports. Safe anywhere.
 * - `registry.ts` — SERVER-ONLY full registry (~2 MB programs.json).
 * - `meta.ts` — client-safe light index (programs-index.json): names, spans,
 *   identity/restriction matching.
 * - `detail.ts` + `usePlanPrograms.ts` — client store fetching one program's
 *   full detail from /api/programs/<slug>, and the React hooks over it.
 */
import { z } from "zod";
import { describeRule } from "../requirements/describe";
import { type RuleNode, RuleNodeSchema } from "../requirements/types";
import {
  flatCoursePickOptions,
  requiredCoursesIn,
  walkRule,
} from "../requirements/walk";

// The requirement AST (RuleNode) and helpers live in `lib/requirements`;
// re-export so `@/lib/programs` stays the stable entry point.
export {
  describeRule,
  flatCoursePickOptions,
  type RuleNode,
  requiredCoursesIn,
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
  // Owed requirements the parser couldn't structure, surfaced (like a program's)
  // so a spec can't read 100% with real requirements dropped.
  unverifiedRequirements: z.array(z.string()).optional(),
  // Dropped free-elective statements, stored RAW (not pre-folded into
  // `unverifiedRequirements` like the program path): a spec instance is shared by
  // reference across parents that may differ in whether they have a totalUnits
  // denominator, so the conditional re-surfacing happens per-parent at audit time
  // (buildProgramAudit), not here.
  freeElectives: z.array(z.string()).optional(),
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

/**
 * Academic terms in the full-time sequence: 6 for a Three-Year General (1A–3B),
 * 8 for a four-year degree (1A–4B). Absent ⇒ 8 (see {@link programTermSpan}).
 * Capped at 8 — `TermLetter` stops at 4B.
 */
const NumberOfTermsSchema = z.number().int().min(2).max(8).optional();

/**
 * The six UWaterloo undergraduate faculties — single source of truth for the
 * {@link Faculty} type, the schema, and the program picker's tab order (listed
 * most-searched first). Stamped per program by the scraper's `normalizeFaculty`.
 */
export const FACULTIES = [
  "mathematics",
  "engineering",
  "science",
  "arts",
  "health",
  "environment",
] as const;

const FacultySchema = z.enum(FACULTIES);

/** Fields shared by both program variants; only the rule shape (`terms` vs `rules`) differs. */
const baseProgramShape = {
  name: z.string(),
  asOf: z.string(),
  source: z.string().optional(),
  numberOfTerms: NumberOfTermsSchema,
  electives: z.array(ElectiveCategorySchema).optional(),
  unitPlan: UnitPlanSchema.optional(),
  degreeRequirements: DegreeRequirementsSchema.optional(),
  informational: z.array(InformationalItemSchema).optional(),
  specializations: z.array(SpecializationSchema).optional(),
  unverifiedRequirements: z.array(z.string()).optional(),
  catalog: CatalogProvenanceSchema.optional(),
  subjectCode: z.string().optional(),
  faculty: FacultySchema.optional(),
};

const ProgramSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("engineering"),
    ...baseProgramShape,
    terms: TermsSchema,
  }),
  z.object({
    kind: z.literal("flexible"),
    ...baseProgramShape,
    rules: RuleNodeSchema,
  }),
]);

export type Program = z.infer<typeof ProgramSchema>;

const ProgramsFileSchema = z.record(z.string(), ProgramSchema);

/**
 * Validate a `slug → Program` map, throwing on the first violation. Lets the
 * scraper fail fast before writing, and backs the `PROGRAMS` registry's
 * fail-fast parse (see `@/lib/programs/registry`).
 */
export function validatePrograms(raw: unknown): Record<string, Program> {
  return ProgramsFileSchema.parse(raw);
}

/** A UWaterloo undergraduate faculty (see {@link FACULTIES}). */
export type Faculty = (typeof FACULTIES)[number];

/** Title-case display label for a faculty ("arts" → "Arts"). */
export function facultyLabel(faculty: Faculty): string {
  return faculty[0].toUpperCase() + faculty.slice(1);
}

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
 * Short name = program name up to the first " (" (e.g. "Computer Science").
 * Exported for the registry's identity/short-name lookups (`@/lib/programs/registry`).
 */
export function shortName(name: string): string {
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

export function isTermLetter(s: string | null | undefined): s is TermLetter {
  return s != null && (TERM_LETTERS as readonly string[]).includes(s);
}

/** Span when a program declares none, and the clamp ceiling (`TermLetter` ≤ 4B). */
export const DEFAULT_TERM_SPAN = 8;

/**
 * Academic terms a program spans, from `numberOfTerms` (engineering/absent ⇒ 8).
 * Structural param so both a full `Program` and the client `ProgramMeta` fit —
 * this is the one home of the default-span rule.
 */
export function programTermSpan(program: { numberOfTerms?: number }): number {
  return program.numberOfTerms ?? DEFAULT_TERM_SPAN;
}

export interface ProgramOption {
  id: string;
  name: string;
  kind: Program["kind"];
  /** Home faculty, for the program picker's filter + grouping; absent if unknown. */
  faculty?: Faculty;
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

/**
 * Every rule-tree root of a program: one per term for engineering, the single
 * tree for flexible. Exported for the registry's `programReferencedCodes`.
 */
export function programRuleRoots(program: Program): RuleNode[] {
  return program.kind === "engineering"
    ? TERM_LETTERS.map((t) => program.terms[t])
    : [program.rules];
}

/**
 * Flat union of all required courses (every term tree for engineering, the
 * single tree for flexible). Choice-group options excluded — those need a pick.
 */
export function getRequiredCourses(program: Program): string[] {
  const out = new Set<string>();
  for (const root of programRuleRoots(program)) {
    for (const c of requiredCoursesIn(root)) out.add(c);
  }
  return [...out].sort();
}
