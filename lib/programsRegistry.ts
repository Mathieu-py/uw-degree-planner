import programsData from "../data/programs.json";
import {
  DEFAULT_TERM_SPAN,
  type Faculty,
  type Program,
  type ProgramIdentity,
  type ProgramOption,
  programRuleRoots,
  programTermSpan,
  type RuleNode,
  type Specialization,
  shortName,
  validatePrograms,
  walkRule,
} from "./programs";

// The validated slug→Program registry. The ~2 MB data/programs.json enters a
// bundle ONLY through this module — data-free consumers use @/lib/programs and
// don't pay for it. Lazy-loading detail off the client is #31 (Tier 2). Parses
// at import to fail fast on bad data.
export const PROGRAMS: Record<string, Program> = validatePrograms(programsData);

// Aliases (lowercased) that resolve prereq program-restrictions to a plan when
// prose uses a different phrasing than the registry name ("Architecture" →
// Architectural Studies). Prose tokens only; a miss just falls back to "check".
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

/** Faculty from the degree-type clause inside the name, or null if ambiguous. */
function facultyFromName(name: string): Faculty | null {
  const lower = name.toLowerCase();
  for (const [needle, faculty] of DEGREE_FACULTY) {
    if (lower.includes(needle)) return faculty;
  }
  return null;
}

// A ProgramIdentity (+ optional spec name as an extra matchable name), or null
// for an unknown id.
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

// One identity per program on a plan (double degrees carry >1); unknown ids
// drop. Lets eligibility judge a restriction against all the student's programs.
export function programIdentities(
  programIds: readonly string[] | null | undefined,
  specializationIds: Record<string, string> = {},
): ProgramIdentity[] {
  return (programIds ?? [])
    .map((id) => programIdentity(id, specializationIds[id] ?? null))
    .filter((p): p is ProgramIdentity => p !== null);
}

// Lowercased set of every program short name + alias — the recognition
// vocabulary for restriction matching. Cached.
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

// Longest span among the given programs (a double degree runs as long as its
// longer leg); 8 when none/unknown.
export function programIdsTermSpan(programIds: readonly string[]): number {
  let span = 0;
  for (const id of programIds) {
    const program = PROGRAMS[id];
    if (program) span = Math.max(span, programTermSpan(program));
  }
  return span || DEFAULT_TERM_SPAN;
}

// The (id, name, kind, faculty) digest of every program, sorted by name — the
// client picker's data instead of full trees.
export function getProgramOptions(): ProgramOption[] {
  return Object.entries(PROGRAMS)
    .map(([id, p]) => ({
      id,
      name: p.name,
      kind: p.kind,
      ...(p.faculty ? { faculty: p.faculty } : {}),
    }))
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

const EMPTY_CODE_SET: ReadonlySet<string> = new Set();
const referencedCodesCache = new Map<string, ReadonlySet<string>>();

// Explicit codes a rule tree names (lowercased). `subjectPool` matches by
// prefix/level and `excluded` is forbidden-not-referenced, so both are skipped.
function collectReferenced(root: RuleNode, out: Set<string>): void {
  walkRule(root, (n) => {
    if (n.kind === "courses") {
      for (const c of n.courses) out.add(c.toLowerCase());
    }
  });
}

// Every code the program (+ spec) references, lowercased — broader than
// getRequiredCourses (adds choice options + elective pools). Lets eligibility
// drop a stale restriction a program's own courses would violate. Memoized.
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
  for (const root of programRuleRoots(program)) collectReferenced(root, out);
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

// A plan's identities + all referenced codes — the inputs eligibility needs,
// spanning a double degree's programs.
export function programContext(
  programIds: string[] | undefined,
  specializationIds: Record<string, string> | undefined,
): { programs: ProgramIdentity[]; programReferenced: ReadonlySet<string> } {
  const programs = programIdentities(programIds, specializationIds);
  const programReferenced = new Set<string>();
  for (const id of programIds ?? []) {
    for (const c of programReferencedCodes(id, specializationIds?.[id])) {
      programReferenced.add(c);
    }
  }
  return { programs, programReferenced };
}
