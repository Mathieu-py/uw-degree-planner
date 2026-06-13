import type { Faculty } from "../../../lib/programs";

/**
 * Subject code → owning UW Faculty, transcribed verbatim from the University of
 * Waterloo Undergraduate Academic Calendar's authoritative "Course Subjects
 * Offered" table (the page programs' `additionalConstraints` point to for
 * "faculty assignment of subject codes").
 *
 * Source (Kuali content node, fetched 2026-06-13):
 *   https://uwaterloocm.kuali.co/api/v1/catalog/content/67e557ed6ed2fe2bd3a38964
 *   (rendered: Undergraduate Calendar → Course Subjects Offered)
 *
 * Per AGENTS.md this is transcribed from the authoritative source, NOT inferred
 * from course data. The table's "Owner" column is mapped onto {@link Faculty}:
 * "Faculty of Arts with <College>" → arts. Subjects whose owner is NOT a single
 * faculty — Interdisciplinary Studies (e.g. SE, PD, STV, AVIA, CFM), Wilfrid
 * Laurier University (BUS), or a standalone affiliated college (Renison: BASE,
 * EMLS, SWREN) — are intentionally OMITTED, so a "Faculty of X" pool never
 * wrongly claims them. A clause naming an unrecognized faculty expands to
 * nothing, so the rule stays unverified rather than being mis-structured.
 */
export const SUBJECT_FACULTY: Record<string, Faculty> = {
  // mathematics
  actsc: "mathematics", // Actuarial Science
  amath: "mathematics", // Applied Mathematics
  co: "mathematics", // Combinatorics and Optimization
  comm: "mathematics", // Commerce
  cs: "mathematics", // Computer Science
  datsc: "mathematics", // Data Science
  matbus: "mathematics", // Mathematical Business
  math: "mathematics", // Mathematics
  mthel: "mathematics", // Mathematics Elective
  pmath: "mathematics", // Pure Mathematics
  stat: "mathematics", // Statistics
  // engineering
  ae: "engineering", // Architectural Engineering
  arch: "engineering", // Architecture
  bet: "engineering", // Business, Entrepreneurship and Technology
  bme: "engineering", // Biomedical Engineering
  che: "engineering", // Chemical Engineering
  cive: "engineering", // Civil Engineering
  ece: "engineering", // Electrical and Computer Engineering
  enve: "engineering", // Environmental Engineering
  gene: "engineering", // General Engineering
  geoe: "engineering", // Geological Engineering
  me: "engineering", // Mechanical Engineering
  mse: "engineering", // Management Science and Engineering
  mte: "engineering", // Mechatronics Engineering
  ne: "engineering", // Nanotechnology Engineering
  pdarch: "engineering", // Professional Development for Architecture Students
  syde: "engineering", // Systems Design Engineering
  // science
  biol: "science", // Biology
  chem: "science", // Chemistry
  earth: "science", // Earth Sciences
  medsci: "science", // Medical Science
  mns: "science", // Materials and Nano-Sciences
  optom: "science", // Optometry
  pdphrm: "science", // Professional Development for Pharmacy Students
  pharm: "science", // Pharmacy
  phys: "science", // Physics
  scbus: "science", // Science and Business
  sci: "science", // Science
  // arts
  afm: "arts", // Accounting and Financial Management
  anth: "arts", // Anthropology
  arabic: "arts", // Arabic
  arbus: "arts", // Arts and Business
  arts: "arts", // Arts
  asl: "arts", // American Sign Language
  blkst: "arts", // Black Studies
  cdnst: "arts", // Canadian Studies
  china: "arts", // Chinese
  ci: "arts", // Cultural Identities
  clas: "arts", // Classical Studies
  cmw: "arts", // Church Music and Worship
  cogsci: "arts", // Cognitive Science
  commst: "arts", // Communication Studies
  croat: "arts", // Croatian
  dac: "arts", // Digital Arts Communication
  dutch: "arts", // Dutch
  easia: "arts", // East Asian Studies
  econ: "arts", // Economics
  engl: "arts", // English
  fine: "arts", // Fine Arts
  fr: "arts", // French Studies
  ga: "arts", // Global Affairs
  gbda: "arts", // Global Business and Digital Arts
  ger: "arts", // German
  grk: "arts", // Greek
  gsj: "arts", // Gender and Social Justice
  hhum: "arts", // Health Humanities
  hist: "arts", // History
  hrm: "arts", // Human Resources Management
  hrts: "arts", // Human Rights
  humsc: "arts", // Human Sciences
  indent: "arts", // Indigenous Entrepreneurship
  indg: "arts", // Indigenous Studies
  innov: "arts", // Innovation
  intst: "arts", // International Studies
  ital: "arts", // Italian
  italst: "arts", // Italian Studies
  japan: "arts", // Japanese
  js: "arts", // Jewish Studies
  korea: "arts", // Korean
  lat: "arts", // Latin
  ls: "arts", // Legal Studies
  medvl: "arts", // Medieval Studies
  menn: "arts", // Mennonite Studies
  mgmt: "arts", // Management
  mohawk: "arts", // Mohawk
  music: "arts", // Music
  pacs: "arts", // Peace and Conflict Studies
  phil: "arts", // Philosophy
  port: "arts", // Portuguese
  psci: "arts", // Political Science
  psych: "arts", // Psychology
  rcs: "arts", // Religion, Culture, and Spirituality
  rees: "arts", // Russian and Eastern European Studies
  russ: "arts", // Russian
  sds: "arts", // Social Development Studies
  si: "arts", // Studies in Islam
  soc: "arts", // Sociology
  socwk: "arts", // Social Work
  span: "arts", // Spanish
  srf: "arts", // Sexualities, Relationships, and Families
  thperf: "arts", // Theatre and Performance
  vcult: "arts", // Visual Culture
  // health
  geron: "health", // Gerontology
  health: "health", // Health
  hlth: "health", // Public Health Sciences
  kin: "health", // Kinesiology
  rec: "health", // Recreation and Leisure Studies
  // environment
  enbus: "environment", // Environment and Business
  envs: "environment", // Environment
  ers: "environment", // Environment, Resources and Sustainability
  gds: "environment", // Geospatial Data Science
  geog: "environment", // Geography and Environmental Management
  indev: "environment", // International Development
  integ: "environment", // Knowledge Integration
  plan: "environment", // Planning
};

/**
 * Every subject code owned by any of the given faculties, lowercased. Turns a
 * faculty-scoped pool ("courses in the Faculty of Arts") into an enumerable
 * subject list the audit can check. Unknown/omitted subjects never appear.
 */
export function subjectsForFaculties(faculties: Faculty[]): string[] {
  const want = new Set(faculties);
  return Object.entries(SUBJECT_FACULTY)
    .filter(([, f]) => want.has(f))
    .map(([code]) => code)
    .sort();
}

// Keyword → Faculty for resolving a faculty NAME as written in rule prose
// ("Arts", "the Faculty of Environment"). Substring-tested, so a longer phrase
// containing the keyword resolves. Order is immaterial — the six keywords are
// mutually exclusive within a faculty name.
const FACULTY_KEYWORDS: ReadonlyArray<readonly [RegExp, Faculty]> = [
  [/\bmath/i, "mathematics"],
  [/\bengineering\b/i, "engineering"],
  [/\bscience\b/i, "science"],
  [/\barts\b/i, "arts"],
  [/\bhealth\b/i, "health"],
  [/\benvironment\b/i, "environment"],
];

/** Resolve a faculty name fragment to a {@link Faculty}, or null if unrecognized. */
export function facultyFromName(name: string): Faculty | null {
  for (const [re, faculty] of FACULTY_KEYWORDS)
    if (re.test(name)) return faculty;
  return null;
}
