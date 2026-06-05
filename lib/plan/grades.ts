/**
 * Interpreting a `SlotCourse.grade` string. The field is free-form (it carries
 * whatever a Quest transcript row's last token was, or a hand-typed value), so
 * a typed view lets the averages engine decide what counts.
 *
 * Waterloo grades are PERCENTAGES, not a 4.0 GPA — averages are unit-weighted
 * means of the numeric grades. Only `numeric` grades contribute to an average;
 * credit/transfer/in-progress carry no number, and non-graded outcomes
 * (withdrawn, audit, incomplete) are `other`.
 *
 * Vocabulary mirrors the transcript parser's `NON_NUMERIC_GRADES`
 * (`lib/transcript/parse.ts`) so the two can't drift.
 */

export type GradeValue =
  /** A percentage grade — the only kind that counts toward an average. */
  | { kind: "numeric"; percent: number }
  /** Credit-granted with no numeric grade (CR / P). */
  | { kind: "credit" }
  /** Transfer credit (TR) — earned elsewhere, excluded from averages. */
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

/** The numeric percentage of a grade, or null when it carries no number. */
export function numericPercent(
  grade: string | null | undefined,
): number | null {
  const v = parseGrade(grade);
  return v.kind === "numeric" ? v.percent : null;
}
