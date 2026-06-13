import type { AuditRoot } from "@/lib/audit/compile";
import {
  compileAudit,
  creditExclusionKeys,
  placementLegalityKey,
} from "@/lib/audit/compile";
import type { DegreeProgress } from "@/lib/audit/progress";
import { computeDegreeProgress } from "@/lib/audit/progress";
import { equivalenceForCatalog } from "@/lib/courses/equivalence";
import type { Course } from "@/lib/courses/types";
import { fmtUnits } from "@/lib/format";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import type { Program } from "@/lib/programs";
import {
  PROGRAMS,
  programReferencedCodes,
  programTermSpan,
  TERM_LETTERS,
} from "@/lib/programs";
import { deriveMacros } from "./deriveMacros";
import type { Macro } from "./types";

export interface ProgramAuditData {
  /** Resolved program, or null when `programId` is unknown. */
  program: Program | null;
  audit: AuditRoot;
  progress: DegreeProgress;
  macros: Macro[];
  /** Structured requirements that couldn't be auto-verified. */
  unverifiedCount: number;
  /** Every code with a placement (shown on its row). */
  placedCodes: Set<string>;
  /** Placed-but-illegal codes — flagged and excluded from ring counts/headline. */
  illegalCodes: Set<string>;
  /** Headline 0–100 for the whole degree (`progress.pct`). */
  headlinePct: number;
  /** True when the calendar states no total units → denominator is estimated. */
  estimatedDenom: boolean;
  /** e.g. "8.0/40.0 units" (a "~" prefixes the denominator when estimated). */
  headlineFraction: string;
}

/**
 * Restrict a plan to slots within a program's span, so a short leg of a
 * multi-program plan doesn't credit courses past its end (3-year ignores 4A/4B).
 * Keeps "pre" + everything up to the span's last term. No-op when that term
 * isn't in the plan (span ≥ plan length).
 */
function scopePlanToSpan(plan: LocalPlan, span: number): LocalPlan {
  const endTerm = TERM_LETTERS[span - 1];
  const endIdx = plan.slots.findIndex((s) => s.position === endTerm);
  if (endIdx === -1) return plan;
  const slots: PlanSlot[] = plan.slots.filter(
    (s, i) => i <= endIdx || s.position === "pre",
  );
  return { ...plan, slots };
}

/**
 * Full audit of one program against a plan: compile → score → macros, plus the
 * panel's derivations (legality split, headline fraction). Pure (no hooks), safe
 * to call once per program in a `useMemo`. The credit-exclusion overlay is built
 * per-program here because the antireq keeper depends on this program's
 * required courses.
 */
export function buildProgramAudit(
  plan: LocalPlan,
  programId: string,
  catalogByCode: Map<string, Course>,
  issues: readonly ValidationIssue[],
): ProgramAuditData {
  const program = PROGRAMS[programId] ?? null;
  const unitsOf = (code: string) => catalogByCode.get(code)?.units ?? 0.5;

  // Credit one member of each antireq conflict (program-required, else higher
  // units); hold out prereq-misplaced courses. Per-program: "required" is
  // program-specific.
  const referenced = programReferencedCodes(
    programId,
    plan.specializationIds[programId] ?? null,
  );
  const legality = creditExclusionKeys(issues, { referenced, unitsOf });

  // Audit only this program's span, so a short leg of a mixed double degree
  // doesn't credit courses in 4A/4B (#105).
  const scopedPlan = program
    ? scopePlanToSpan(plan, programTermSpan(program))
    : plan;

  // One index for BOTH passes: the audit tree and the progress headline must
  // agree on what a placed cross-listed twin satisfies (#21).
  const equiv = equivalenceForCatalog(catalogByCode);
  const audit = compileAudit(
    program,
    scopedPlan,
    plan.specializationIds[programId] ?? null,
    legality,
    programId,
    equiv,
  );
  const progress = computeDegreeProgress(
    audit,
    program,
    unitsOf,
    legality,
    equiv,
  );
  const { macros, unverifiedCount } = deriveMacros(
    audit,
    program,
    progress.freeUnits,
    progress.breadthRequirements,
    progress.levelFloors,
    unitsOf,
    legality,
    progress.nodeFill,
  );

  // Whole-degree completion, not a sum of overlapping slots. See computeDegreeProgress.
  const headlinePct = progress.pct;
  // No calendar total (e.g. Joint Honours) → fall back to summed structured
  // requirements. Mark estimated so it's not read as exact.
  const estimatedDenom = progress.totalUnits == null;
  const headlineFraction = `${fmtUnits(progress.creditedUnits)}/${estimatedDenom ? "~" : ""}${fmtUnits(progress.denom)} units`;

  const placedCodes = new Set(audit.placement.keys());
  // Illegally-placed codes: still in `placedCodes` (shown on their row) but
  // flagged and excluded from ring counts + headline.
  const illegalCodes = new Set<string>();
  for (const [code, p] of audit.placement)
    if (legality.has(placementLegalityKey(p))) illegalCodes.add(code);

  return {
    program,
    audit,
    progress,
    macros,
    unverifiedCount,
    placedCodes,
    illegalCodes,
    headlinePct,
    estimatedDenom,
    headlineFraction,
  };
}
