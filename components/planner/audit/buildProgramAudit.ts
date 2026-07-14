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
import { referencedCodesOf } from "@/lib/programReferenced";
import type { Program, Specialization } from "@/lib/programs";
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
  program: Program | null,
  catalogByCode: Map<string, Course>,
  issues: readonly ValidationIssue[],
): ProgramAuditData {
  const specId = plan.specializationIds[programId] ?? null;
  // The selected specialization (heavy: its own rules/electives), resolved once
  // from the loaded detail and reused for referenced codes + owed requirements.
  const selectedSpec = specId
    ? (program?.specializations?.find((s) => s.slug === specId) ?? null)
    : null;
  // Fold finite "choose N of a list" requirements (e.g. an "Approved Courses
  // List") into the rule tree as picks, so they render/count under Degree
  // requirements — not as a separate Electives row. Local to this audit; the
  // un-folded `program` still feeds `referencedCodesOf`, so codes are unaffected.
  const auditedProgram = program ? foldFiniteElectivesIntoRules(program) : null;
  const unitsOf = (code: string) => catalogByCode.get(code)?.units ?? 0.5;

  // Credit one member of each antireq conflict (program-required, else higher
  // units); hold out prereq-misplaced courses. Per-program: "required" is
  // program-specific.
  const referenced = program
    ? referencedCodesOf(program, selectedSpec)
    : new Set<string>();
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
  // its required courses wherever they are placed (replaces the span gate).

  // One index for BOTH passes: the audit tree and the progress headline must
  // agree on what a placed cross-listed twin satisfies.
  const equiv = equivalenceForCatalog(catalogByCode);
  const audit = compileAudit(
    auditedProgram,
    plan,
    specId,
    legality,
    programId,
    equiv,
    unitsOf,
  );
  const acknowledged = new Set(
    plan.acknowledgedRequirements?.[programId] ?? [],
  );
  // A selected specialization's owed requirements are folded into this program's
  // acknowledgment dimension (same programId + verbatim text), so they gate the
  // headline and are acknowledgeable exactly like the program's own.
  // Resolved here, not at scrape time: a spec is shared by reference across parents
  // that may differ in whether they have a totalUnits denominator.
  const noTotal = program?.unitPlan?.totalUnits == null;
  // A spec's owed requirements: its unstructurable rules, plus its dropped free
  // electives ONLY when the parent has no total to absorb them (else they're
  // redundant with the free remainder — mirrors foldFreeElectivesIntoUnverified).
  const specOwed = (spec: Specialization): string[] => [
    ...(spec.unverifiedRequirements ?? []),
    ...(noTotal ? (spec.freeElectives ?? []) : []),
  ];
  // Merge the program's own owed requirements with the selected spec's ONCE
  // (deduped): this single list drives both the acknowledgeable UI rows and the
  // headline gate, so computeDegreeProgress no longer re-merges internally.
  const effectiveUnverified = [
    ...new Set([
      ...(program?.unverifiedRequirements ?? []),
      ...(selectedSpec ? specOwed(selectedSpec) : []),
    ]),
  ];
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
    effectiveUnverified,
  );
  const { macros } = deriveMacros(audit, auditedProgram, unitsOf, legality, {
    progress,
    electiveSections,
  });

  // Unverified requirements, surfaced near the headline (not buried in a macro)
  // so "confirm with your advisor" is actionable. Each carries its acked state;
  // the still-owed ones (progress.owedUnverified) hold the headline below 100%.
  // Reuses the single merged list also fed to the headline gate above.
  const unverifiedItems = effectiveUnverified.map((text) => ({
    text,
    acked: acknowledged.has(text),
  }));
  // Acked text matching no current requirement → the rule changed on re-scrape.
  // The known set spans ALL specs (not just the selected one) so switching specs
  // doesn't flag the prior spec's confirmations as a stale calendar regression;
  // they persist quietly and are remembered if that spec is re-selected.
  const unverifiedSet = new Set([
    ...(program?.unverifiedRequirements ?? []),
    ...(program?.specializations ?? []).flatMap(specOwed),
  ]);
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
