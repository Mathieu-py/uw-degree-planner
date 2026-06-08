/**
 * Typed view of the free-form `SlotCourse.grade` string (a Quest row's last
 * token or a hand-typed value), so {@link earnsCredit} can decide pass/fail.
 *
 * Waterloo grades are PERCENTAGES, not a 4.0 GPA. Credit/transfer/in-progress
 * carry no number; non-graded outcomes (withdrawn, audit, incomplete) are
 * `other`. Vocabulary mirrors the parser's `NON_NUMERIC_GRADES`
 * (`lib/transcript/parse.ts`) so the two can't drift.
 */

export type GradeValue =
  /** A percentage grade — checked against the pass floor for credit. */
  | { kind: "numeric"; percent: number }
  /** Credit-granted with no numeric grade (CR / P). */
  | { kind: "credit" }
  /** Transfer credit (TR) — earned elsewhere. */
  | { kind: "transfer" }
  /** In progress (IP) or no grade yet (empty) — not yet gradable. */
  | { kind: "inProgress" }
  /** Any other outcome (W, WD, NCR, AU, INC, DNW, F, or unrecognized text). */
  | { kind: "other"; raw: string };

/** Non-numeric tokens that aren't a counted grade but aren't "other" either. */
const SPECIAL: Record<string, GradeValue["kind"]> = {
  CR: "credit",
  P: "credit",
  TR: "transfer",
  IP: "inProgress",
};

/** Parse a free-form grade string into a typed {@link GradeValue}. */
export function parseGrade(grade: string | null | undefined): GradeValue {
  const raw = (grade ?? "").trim();
  if (raw === "") return { kind: "inProgress" };
  if (/^\d+(?:\.\d+)?$/.test(raw))
    return { kind: "numeric", percent: Number(raw) };
  const special = SPECIAL[raw.toUpperCase()];
  if (special === "credit") return { kind: "credit" };
  if (special === "transfer") return { kind: "transfer" };
  if (special === "inProgress") return { kind: "inProgress" };
  return { kind: "other", raw };
}

/**
 * Waterloo's general pass floor — a numeric grade below this earns no credit.
 * Single source of truth; the transcript parser imports it.
 */
export const PASS_THRESHOLD = 50;

/**
 * Does a placed course earn credit toward a requirement / the headline? Numeric
 * grades must clear {@link PASS_THRESHOLD}; CR/P, TR, and not-yet-graded
 * (IP/blank) count; `other` outcomes (F, W, WD, NCR, AU, INC, …) don't.
 */
export function earnsCredit(grade: string | null | undefined): boolean {
  const v = parseGrade(grade);
  switch (v.kind) {
    case "numeric":
      return v.percent >= PASS_THRESHOLD;
    case "credit":
    case "transfer":
    case "inProgress":
      return true;
    case "other":
      return false;
  }
}
