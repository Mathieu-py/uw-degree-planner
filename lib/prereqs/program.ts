/**
 * Resolve a UWFlow program-restriction clause (e.g. "Honours Mathematics or
 * Software Engineering students only") against the student's program.
 * Deliberately conservative: only "block" when every named program/faculty is
 * recognized AND the student matches none. Any unrecognized token or odd shape
 * → "unknown", so the UI keeps the amber "check" rather than wrongly hiding a
 * takeable course.
 */

import {
  type Faculty,
  type ProgramIdentity,
  programShortNames,
} from "@/lib/programs";

export interface ProgramConstraint {
  /** Program / faculty tokens the course is open to. */
  allow: string[];
  /** Tokens explicitly carved out of `allow` ("… excluding students in …"). */
  exclude: string[];
}

export type ProgramVerdict = "allow" | "block" | "unknown";

const FACULTY_WORDS: Record<string, Faculty> = {
  engineering: "engineering",
  mathematics: "mathematics",
  math: "mathematics",
  maths: "mathematics",
  science: "science",
  sci: "science",
  arts: "arts",
  environment: "environment",
  "environmental studies": "environment",
  env: "environment",
  health: "health",
  ahs: "health",
  "applied health sciences": "health",
};

/** Strip the modifiers that wrap a bare program/faculty name in restriction prose. */
function normalizeToken(raw: string): string {
  let t = raw.toLowerCase().trim().replace(/\.$/, "").replace(/\s+/g, " ");
  t = t
    .replace(/^(?:or|and)\s+/, "")
    .replace(/^the following faculties:\s*/, "")
    .replace(/^students? in\s+/, "")
    .replace(/^in\s+/, "")
    .replace(/^(?:joint\s+)?honou?rs\s+/, "");
  t = t
    .replace(/\s+students?$/, "")
    .replace(/\s+double degree$/, "")
    .replace(/\s+diploma$/, "")
    .replace(/\s+only$/, "")
    .replace(/\s+eng$/, " engineering");
  return t.trim();
}

/** Split an allow/exclude segment into normalized tokens (split on "or" and commas only). */
function tokenize(segment: string): string[] {
  return segment
    .split(/\s+or\s+|,/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

/**
 * Parse the restriction clause into allow / exclude token lists. Returns empty
 * lists when no recognizable restriction shape is present (→ caller treats as
 * "unknown").
 */
export function parseProgramClause(clause: string): ProgramConstraint {
  // Normalize "&" to "and": UWFlow writes program names both ways, and an
  // unnormalized "&" fails to match → a needless "check".
  const s = clause
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s*&\s*/g, " and ");

  // Extract the body: the part naming the allowed programs/faculties.
  let body: string | null = null;
  const openMatch =
    s.match(/open only to students? in (.+)/) ??
    s.match(/only open to (?:students? in )?(.+)/);
  if (openMatch) {
    body = openMatch[1];
  } else {
    // "… students only" / bare "… students".
    const onlyMatch = s.match(/^(.+?) students?(?:\s+only)?$/);
    if (onlyMatch) body = onlyMatch[1];
    // Bare level-prefixed restriction, no "students" ("1A Civil Engineering").
    else if (/^(?:level\s+)?\d[a-z]/i.test(s)) body = s;
  }
  if (body === null) return { allow: [], exclude: [] };

  // Peel a leading level/year qualifier so it doesn't pollute program tokens
  // (and a "2A or 3A …" prefix isn't split on its own "or"). The inline case
  // where a level directly prefixes the program list.
  body = body
    .replace(/^(?:level\s+)?(?:at least\s+)?\d[a-z](?:\s+or\s+\d[a-z])*\s+/, "")
    .replace(/^(?:first|second|third|fourth)-year\s+/, "");

  // Optional exclusion carve-out.
  let allowPart = body;
  let excludePart = "";
  const exMatch = body.match(
    /(.*?)\b(?:excluding|except)\b(?: students? in)? (.+)/,
  );
  if (exMatch) {
    allowPart = exMatch[1];
    excludePart = exMatch[2];
  }

  return { allow: tokenize(allowPart), exclude: tokenize(excludePart) };
}

/** Does the student's identity match this single allow/exclude token? */
function identityMatchesToken(
  identity: ProgramIdentity,
  token: string,
): boolean {
  const faculty = FACULTY_WORDS[token];
  if (faculty) return identity.faculty === faculty;
  return identity.names.includes(token);
}

/** Is the token something we recognize at all (a known faculty or program)? */
function tokenRecognized(token: string, vocab: ReadonlySet<string>): boolean {
  return token in FACULTY_WORDS || vocab.has(token);
}

/**
 * Resolve the clause against the student's program:
 * - `allow`   — the student is in an allowed program/faculty.
 * - `block`   — confidently not allowed (every named program recognized, none match).
 * - `unknown` — can't decide; the UI should keep showing "check".
 */
export function matchProgram(
  constraint: ProgramConstraint,
  identity: ProgramIdentity | null,
): ProgramVerdict {
  if (!identity) return "unknown";
  const { allow, exclude } = constraint;
  if (allow.length === 0) return "unknown";

  const vocab = programShortNames();

  // Excluded outright. Tests the student's identity directly, so an
  // unrecognized synonym in the exclude list can't hide them.
  if (exclude.some((t) => identityMatchesToken(identity, t))) return "block";

  if (allow.some((t) => identityMatchesToken(identity, t))) return "allow";

  // Student matches nothing — but a faculty token is only decidable when we
  // know the student's faculty. If the clause names a faculty and we couldn't
  // derive the student's, stay "unknown" rather than wrongly block.
  if (identity.faculty === null && allow.some((t) => t in FACULTY_WORDS)) {
    return "unknown";
  }

  // Block when ≥1 allowed token is a recognized program/faculty (proving this
  // is a real restriction; other tokens are just programs the student isn't
  // in). If NONE is recognized it may be universal prose, so stay "unknown".
  if (allow.some((t) => tokenRecognized(t, vocab))) return "block";
  return "unknown";
}
