// Rule-shape regexes matched against a Kuali leaf-rule's prefix (the text before
// the first colon) or full text, to classify it into a RuleNode. Kept together
// so the grammar the parser recognizes is reviewable in one place. Consumed by
// `tree.ts`.

export const COMPLETE_ALL_RE = /^Complete all (the|of the) following/i;
export const COMPLETE_N_OF_RE = /^Complete (\d+) of (the )?following/i;
export const CHOOSE_ANY_RE = /^Choose any (?:of|course from) the following/i;
export const COMPLETE_NO_MORE_THAN_RE =
  /^Complete no more than (\d+) from (the )?following/i;
export const COMPLETE_N_FROM_CHOICES_RE =
  /^Complete (\d+) courses? from the following choices/i;
export const EXCLUDED_RE =
  /^The following cannot be used towards (?:this )?(?:academic )?plan/i;
// Prose that fits no rule shape (notes, preambles, unit-bound electives handled
// by parseElectives). "Choose" is omitted so Kuali drift on it surfaces as a warning.
export const DEFERRED_PROSE_RE =
  /^(?:Complete|The following|Note|If\b|Subject concentration)/i;

// A grade-gated wrapper ("Complete the following courses with a minimum cumulative
// Economics average of 70.0%") is a sibling of the actual "Complete all: <courses>"
// rule — the courses are captured there, and we drop grade thresholds (no grading),
// so this leaf is a phantom. R4.
export const COMPLETE_ALL_GRADED_RE =
  /^Complete the following courses with a minimum cumulative .* average of [\d.]+%/i;
// Count word dropped by Kuali ("Complete of the following: COMMST193 … ENGL193 …").
// The codes are inline; read it as a pick of 1. R4.
export const COMPLETE_OF_RE = /^Complete of (?:the )?following/i;
// A unit quota over an inline "following list" ("Complete 2.5 units from the
// following list of courses") whose courses live in a sibling "Choose any" open
// pick. walkUl binds the count (units ÷ 0.5) onto that pick. R4.
export const COMPLETE_N_UNITS_FROM_LIST_RE =
  /^Complete\s+(\d+(?:\.\d+)?)\s+units?\s+(?:of\s+courses\s+)?from the following list\b/i;

// Rules whose real constraint we can't encode faithfully — a course-type filter
// ("seminars", "field courses", "lecture or labs"), a cross-subject-diversity rule
// ("same/different/distinct subject(s)/discipline(s)/area(s)", with or without the
// word "code"), or a conditional ("associated labs if …"). Structuring these
// against subject+level alone would over-count, so short-circuit them to verbatim
// before any widening tries. R6.
export const KEEP_UNVERIFIED_RE =
  /\bseminars?\b|\bfield\s+courses?\b|\blectures?\s+or\s+labs?\b|\b(?:same|different|distinct|separate)\s+(?:subject|discipline|area)s?\b|\bassociated\s+lab/i;

// Genuinely-open free electives with NO enumerable scope and no real constraint
// ("Complete 4 approved electives", "Complete 2 additional courses", "N units of
// elective courses", "additional units at any level"). Their VOLUME is already the
// free-unit remainder in the units headline (lib/audit/progress.ts), so surfacing
// them ALSO as "confirm with your advisor" rows is redundant and double-gates
// 100%. Drop them from the rule tree, but record each (droppedFreeElectives) so
// the assembler can re-surface it for a program with no totalUnits denominator —
// there the headline has no free remainder to gate it. A level floor or a
// subject/list scope keeps the rule OUT of here — those aren't tracked by units.
export const FREE_ELECTIVE_RE =
  /\bapproved electives?\b|^Complete\s+[\d.]+\s+additional courses?\.?$|\bunits of (?:elective|additional) courses\b|\badditional units at any level\b/i;

// Fallback prefix slice for a colon-less rule: long enough for every ^-anchored
// rule regex, short enough to keep warnings readable.
export const MAX_PREFIX_LEN = 200;

// "Complete N …" where N leads the rule, even when a non-"course" word follows
// ("Complete 3 additional CS courses …" — LEADING_COUNT_RE needs "courses"/"of"
// right after the count, so it misses this shape).
export const LEAD_COUNT_RE =
  /^Complete\s+(?:a\s+total\s+of\s+)?(\d+|an|a|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
