import type { AuditRoot } from "@/lib/audit/compile";
import {
  compileAudit,
  creditExclusionKeys,
  placementLegalityKey,
} from "@/lib/audit/compile";
import { deriveElectiveSections } from "@/lib/audit/electives";
import { foldFiniteElectivesIntoRules } from "@/lib/audit/foldElectives";
import type { DegreeProgress } from "@/lib/audit/progress";
import { computeDegreeProgress } from "@/lib/audit/progress";
import { equivalenceForCatalog } from "@/lib/courses/equivalence";
import type { Course } from "@/lib/courses/types";
import { fmtUnits } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import type { Program } from "@/lib/programs";
import { PROGRAMS, programReferencedCodes } from "@/lib/programs";
import { deriveMacros } from "./deriveMacros";
import type { Macro } from "./types";

export interface ProgramAuditData {
  /** Resolved program, or null when `programId` is unknown. */
  program: Program | null;
  audit: AuditRoot;
  progress: DegreeProgress;
  macros: Macro[];
  /**
   * Requirements the scraper couldn't auto-verify, each with whether the student
   * has manually confirmed it on the plan. Rendered near the headline as
   * "confirm manually" rows; acknowledging one lets the headline reach 100%.
   */
  unverifiedItems: { text: string; acked: boolean }[];
  /**
   * Acknowledgements no longer matching any current `unverifiedRequirements` text
   * (a re-scrape reworded/removed the rule). Surfaced so a headline that slipped
   * 100%→99% is explained, not a silent regression.
   */
  staleAcknowledgements: string[];
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
  // Fold finite "choose N of a list" requirements (e.g. an "Approved Courses
  // List") into the rule tree as picks, so they render/count under Degree
  // requirements — not as a separate Electives row. Local to this audit; global
  // PROGRAMS is untouched, so `programReferencedCodes` still sees the same codes.
  const auditedProgram = program ? foldFiniteElectivesIntoRules(program) : null;
  const unitsOf = (code: string) => catalogByCode.get(code)?.units ?? 0.5;

  // Credit one member of each antireq conflict (program-required, else higher
  // units); hold out prereq-misplaced courses. Per-program: "required" is
  // program-specific.
  const referenced = programReferencedCodes(
    programId,
    plan.specializationIds[programId] ?? null,
  );
  const legality = creditExclusionKeys(issues, { referenced, unitsOf });

  // Credit follows the calendar's requirements, NOT the term a course is taken
  // in. An academic plan is "a defined set of requirements that leads to a
  // particular credential" (UW Undergraduate Calendar, Glossary of Terms), with
  // no provision tying degree credit to term of completion — so we audit the full
  // plan. Overlap between credentials is instead governed by the double-counting
  // cap: "a course can be used to satisfy requirements for a maximum of two
  // credentials (degrees, diplomas, or certificates)" (UW Undergraduate Calendar,
  // Academic Regulations → Double Counting of Courses). That cap is satisfied
  // structurally here — within a program maxBipartiteMatch binds each course to a
  // single requirement, and hand-picked programs are audited independently
  // (AuditPanel), never summed into a shared denominator — so no term partition
  // is needed. A 3-year leg on an 8-term double-degree grid now correctly credits
  // its required courses wherever they are placed (replaces the #105 span gate).

  // One index for BOTH passes: the audit tree and the progress headline must
  // agree on what a placed cross-listed twin satisfies (#21).
  const equiv = equivalenceForCatalog(catalogByCode);
  const audit = compileAudit(
    auditedProgram,
    plan,
    plan.specializationIds[programId] ?? null,
    legality,
    programId,
    equiv,
    unitsOf,
  );
  const acknowledged = new Set(
    plan.acknowledgedRequirements?.[programId] ?? [],
  );
  // Derive the elective sections ONCE and thread them to both consumers, so the
  // headline's `electiveCredit[i]` maps to the same i-th elective the panel
  // renders (and the parse/classify/consolidate isn't run twice).
  const electiveSections = auditedProgram
    ? deriveElectiveSections(auditedProgram)
    : undefined;
  const progress = computeDegreeProgress(
    audit,
    auditedProgram,
    unitsOf,
    legality,
    equiv,
    acknowledged,
    electiveSections,
  );
  const { macros } = deriveMacros(
    audit,
    auditedProgram,
    progress.freeUnits,
    progress.breadthRequirements,
    progress.levelFloors,
    unitsOf,
    legality,
    progress.nodeFill,
    progress.electiveCredit,
    electiveSections,
  );

  // Unverified requirements, surfaced near the headline (not buried in a macro)
  // so "confirm with your advisor" is actionable. Each carries its acked state;
  // the still-owed ones (progress.owedUnverified) hold the headline below 100%.
  const unverifiedRequirements = program?.unverifiedRequirements ?? [];
  const unverifiedItems = unverifiedRequirements.map((text) => ({
    text,
    acked: acknowledged.has(text),
  }));
  // Acked text matching no current requirement → the rule changed on re-scrape.
  const unverifiedSet = new Set(unverifiedRequirements);
  const staleAcknowledgements = [...acknowledged].filter(
    (text) => !unverifiedSet.has(text),
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
    unverifiedItems,
    staleAcknowledgements,
    placedCodes,
    illegalCodes,
    headlinePct,
    estimatedDenom,
    headlineFraction,
  };
}
