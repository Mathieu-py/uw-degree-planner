import {
  type BreadthRequirement,
  nonBreadthConstraints,
} from "@/lib/audit/breadth";
import { deriveCommunicationRequirement } from "@/lib/audit/communication";
import {
  type AuditNode,
  type AuditRoot,
  splitPlacementByLegality,
} from "@/lib/audit/compile";
import {
  deriveElectiveSections,
  type ElectiveSection,
  subjectPoolFilter,
} from "@/lib/audit/electives";
import { isLevelFloor } from "@/lib/audit/levelFloors";
import type { DegreeProgress } from "@/lib/audit/progress";
import { type ScoredNode, scoreAudit } from "@/lib/audit/score";
import { poolMatch } from "@/lib/courses/code";
import {
  countNoun,
  fmtUnits,
  formatCourseCode,
  pluralize,
  unitsMet,
} from "@/lib/format";
import { type Program, requiredCoursesIn, TERM_LETTERS } from "@/lib/programs";
import {
  GENERIC_ALL,
  type Macro,
  type MacroBlock,
  type Section,
} from "./types";

/**
 * A child's heading iff it's a distinct *selection* list ("Approved Courses
 * List", "List 1") worth its own collapsible sub-group. A named `all` that
 * carries its OWN required courses (e.g. Kuali's "Required Courses" bucket) is
 * the mandatory core — the "Degree requirements" macro already names it — so it
 * renders flat, not behind a redundant dropdown. `requiredCoursesIn` is empty
 * only when every course sits inside a pick (a pure choice list). Null for a
 * leaf, an unlabeled group, or the generic wrapper.
 */
export function namedGroupLabel(node: AuditNode): string | null {
  if (node.ruleNode.kind !== "all" || node.description == null) return null;
  if (node.description === GENERIC_ALL) return null;
  return requiredCoursesIn(node.ruleNode).length > 0 ? null : node.description;
}

/**
 * Flatten a rule-tree root into renderable blocks. Unwrap the generic "Complete
 * all of the following" wrapper; keep only a NAMED sub-group ("Core Courses")
 * as a light sub-label.
 */
function flattenRuleRoot(root: ScoredNode): MacroBlock[] {
  const wholeRoot: MacroBlock[] = [
    { subLabel: null, content: { kind: "node", scored: root } },
  ];
  if (root.node.ruleNode.kind !== "all" || root.children.length === 0)
    return wholeRoot;

  // Nothing worth labeling → render the wrapper as one block, don't unwrap.
  if (!root.children.some((c) => namedGroupLabel(c.node))) return wholeRoot;

  return root.children.map((c) => ({
    subLabel: namedGroupLabel(c.node),
    content: { kind: "node", scored: c },
  }));
}

/**
 * Translate the compiled `AuditRoot` (+ program elective/degree notes) into the
 * panel's top-level macro-sections:
 *  - Degree requirements — required core (per term for engineering, else the
 *    rule tree), plus specialization, communication, level-floor minimums.
 *  - Electives — `program.electives[]`, faculty breadth, free-elective volume.
 *  - Co-op & other — informational notes, non-breadth constraints, unstructured.
 *
 * Each macro's header chip is a course-ish count; the unit headline is computed
 * separately (computeDegreeProgress).
 */
export function deriveMacros(
  audit: AuditRoot,
  program: Program | null,
  /** Units of a placed course (catalog-backed; default 0.5). */
  unitsOf: (code: string) => number,
  /** Slot-scoped illegality keys; illegal placements don't credit counts. */
  legality: ReadonlySet<string>,
  opts: {
    /**
     * The headline model computed on this exact `audit` instance — rows then
     * reflect its one-course-per-slot assignment, and free-elective/breadth/
     * level-floor rows are emitted. Omitted (tests) → compiled-tree counts.
     */
    progress?: DegreeProgress;
    /**
     * MUST be the same array `computeDegreeProgress` received so
     * `progress.electiveCredit[i]` maps to the i-th elective; buildProgramAudit
     * threads one instance to both. Omit to derive locally.
     */
    electiveSections?: ElectiveSection[];
  } = {},
): { macros: Macro[] } {
  const { progress, electiveSections } = opts;
  const freeElectiveUnits = progress?.freeUnits ?? 0;
  const breadthRequirements = progress?.breadthRequirements ?? [];
  const levelFloors = progress?.levelFloors ?? [];
  const electiveCredit = progress?.electiveCredit;
  // Every row count/recede below reads the scored tree — the one merge point
  // between compiled satisfaction and match credit.
  const scored = scoreAudit(audit, progress);

  // Count like the headline: illegally-placed courses don't credit, keeping the
  // elective/communication counts consistent with the degree rows.
  const { legalCodes: placedCodes } = splitPlacementByLegality(
    audit.placement,
    legality,
  );

  // ---- Degree requirements: required core, flattened ----
  // Headers sum the rendered blocks' capped credits (what the sub-rings show),
  // not a root-level cap — deliberate: the header tracks what the cards render,
  // even though splitting a labeled root can shift the total.
  const degreeBlocks: MacroBlock[] = [];
  let degNeeded = 0;
  let degSatisfied = 0;

  if (scored.byTerm) {
    // Engineering: keep the per-term breakdown (term order is meaningful) as a
    // sub-label over each term's rows.
    for (const t of TERM_LETTERS) {
      const term = scored.byTerm[t];
      if (!term || term.needed === 0) continue;
      degNeeded += term.needed;
      degSatisfied += term.credit;
      degreeBlocks.push({
        subLabel: `Term ${t}`,
        content: { kind: "node", scored: term },
      });
    }
  }
  if (scored.flexible) {
    for (const block of flattenRuleRoot(scored.flexible)) {
      if (block.content.kind === "node") {
        degNeeded += block.content.scored.needed;
        degSatisfied += block.content.scored.credit;
      }
      degreeBlocks.push(block);
    }
  }
  // Specialization is its own top-level macro, not part of the degree count.
  const specBlocks: MacroBlock[] = [];
  let specNeeded = 0;
  let specSatisfied = 0;
  if (scored.specialization) {
    for (const block of flattenRuleRoot(scored.specialization)) {
      if (block.content.kind === "node") {
        specNeeded += block.content.scored.needed;
        specSatisfied += block.content.scored.credit;
      }
      specBlocks.push(block);
    }
  }

  // Communication + level-floor minimums under a "Degree minimums" sub-label.
  // Each met requirement contributes 1/1 (units don't map to a course count, so
  // floors/breadth score as a met boolean).
  if (program) {
    const minima: Section[] = [];
    const comm = deriveCommunicationRequirement(program, placedCodes);
    if (comm && !comm.alreadyInTree) {
      // Match credit when available: a comm option claimed by another bucket
      // must not read done here while the headline's comm slot sits unfilled.
      const done = Math.min(progress?.commCredit ?? comm.placed, comm.need);
      degNeeded += comm.need;
      degSatisfied += done;
      minima.push({
        kind: "electiveFinite",
        key: "deg-comm",
        title: comm.title,
        caption: `${done} of ${comm.need} done · ${comm.options.map(formatCourseCode).join(" or ")}`,
        need: comm.need,
        placed: done,
        options: comm.options,
      });
    }
    levelFloors.forEach((f, i) => {
      const done = Math.min(f.placedUnits, f.need);
      const met = unitsMet(f.placedUnits, f.need);
      degNeeded += 1;
      degSatisfied += met ? 1 : 0;
      const subjects = (f.subjects ?? []).map((s) => s.toUpperCase());
      minima.push({
        kind: "levelFloor",
        key: `floor-${i}`,
        title: f.title,
        caption: `${fmtUnits(done)} of ${fmtUnits(f.need)} units${subjects.length ? ` · ${subjects.length} subjects` : ""}`,
        needUnits: f.need,
        placedUnits: f.placedUnits,
        subjects,
        satisfiers: f.satisfiers,
        sourceText: f.sourceText,
      });
    });
    if (minima.length > 0)
      degreeBlocks.push({
        subLabel: "Degree minimums",
        content: { kind: "sections", sections: minima },
      });
  }

  // ---- Electives: program electives + faculty breadth + free-elective volume.
  // Browse / unit-based electives carry no honest count → surfaced as a
  // "+N to plan" hint on the macro.
  const electiveRows: Section[] = [];
  let elecNeeded = 0;
  let elecSatisfied = 0;
  let untrackedCount = 0;
  if (program) {
    (electiveSections ?? deriveElectiveSections(program))
      .map((e, i) =>
        toElectiveSection(e, i, placedCodes, unitsOf, electiveCredit?.[i]),
      )
      .forEach((s) => {
        if (s.kind === "electiveFinite") {
          elecNeeded += s.need;
          elecSatisfied += Math.min(s.placed, s.need);
        } else if (s.kind === "breadth") {
          elecNeeded += 1;
          elecSatisfied += unitsMet(s.placedUnits, s.needUnits) ? 1 : 0;
        } else {
          untrackedCount += 1;
        }
        electiveRows.push(s);
      });
    breadthRequirements.forEach((b, i) => {
      elecNeeded += 1;
      elecSatisfied += unitsMet(b.placedUnits, b.needUnits) ? 1 : 0;
      electiveRows.push(breadthSection(b, i));
    });
    // Free electives — open volume after the named requirements. Units live on
    // this row, not the macro heading (a program with big named electives has a
    // tiny free remainder a heading would understate).
    if (freeElectiveUnits > 0) {
      const u = Math.round(freeElectiveUnits * 100) / 100;
      electiveRows.push({
        kind: "info",
        key: "free-electives",
        title: "Free electives",
        caption: `≈ ${countNoun(u, "unit")}, any subject — fills the degree beyond the named requirements above.`,
      });
    }
  }

  // ---- Co-op & other: informational notes, non-breadth constraints, and
  // unstructured requirements. Purely informational (not trackable) → no count.
  const otherSections: Section[] = [];
  if (program) {
    // Fold notes by title so 7 identical "Additional constraint" labels collapse
    // into one "Additional constraints · 7" row instead of a wall. Map preserves
    // first-seen order.
    const byTitle = new Map<string, string[]>();
    const addNote = (title: string, text: string) => {
      const list = byTitle.get(title);
      // Skip a note already folded under this title: two constraints that both
      // fall back to "Verify with your advisor." must not render (or key) twice.
      if (list) {
        if (!list.includes(text)) list.push(text);
      } else byTitle.set(title, [text]);
    };
    for (const c of nonBreadthConstraints(program).filter(
      (c) => !isLevelFloor(c),
    ))
      addNote(
        c.label,
        c.sourceText && c.sourceText !== c.label
          ? c.sourceText
          : "Verify with your advisor.",
      );
    for (const it of [
      ...(program.informational ?? []),
      ...(program.degreeRequirements?.informational ?? []),
    ])
      addNote(it.label, it.text);

    let i = 0;
    for (const [title, notes] of byTitle) {
      otherSections.push({
        kind: "infoGroup",
        key: `info-${i++}`,
        title,
        items: notes,
      });
    }
  }
  // `unverifiedRequirements` are NOT emitted here — they're surfaced near the
  // headline as acknowledgeable "confirm manually" rows (buildProgramAudit →
  // UnverifiedRequirements), not buried in this collapsed macro.

  const macros: Macro[] = [];
  if (degreeBlocks.length > 0)
    macros.push({
      key: "degree",
      label: "Degree requirements",
      count:
        degNeeded > 0 ? { satisfied: degSatisfied, needed: degNeeded } : null,
      hint: null,
      blocks: degreeBlocks,
      defaultOpen: true,
    });
  if (specBlocks.length > 0)
    macros.push({
      key: "specialization",
      label: "Specialization",
      count:
        specNeeded > 0
          ? { satisfied: specSatisfied, needed: specNeeded }
          : null,
      hint: null,
      blocks: specBlocks,
      defaultOpen: true,
    });
  if (electiveRows.length > 0)
    macros.push({
      key: "electives",
      label: "Electives",
      count:
        elecNeeded > 0
          ? { satisfied: elecSatisfied, needed: elecNeeded }
          : null,
      hint:
        untrackedCount > 0
          ? `+ ${countNoun(untrackedCount, "elective requirement")} to plan`
          : null,
      blocks: [
        {
          subLabel: null,
          content: { kind: "sections", sections: electiveRows },
        },
      ],
      defaultOpen: false,
    });
  if (otherSections.length > 0)
    macros.push({
      key: "other",
      label: "Co-op & other",
      count: null,
      hint: null,
      blocks: [
        {
          subLabel: null,
          content: { kind: "sections", sections: otherSections },
        },
      ],
      defaultOpen: false,
    });

  return { macros };
}

function toElectiveSection(
  e: ElectiveSection,
  index: number,
  placedCodes: ReadonlySet<string>,
  unitsOf: (code: string) => number,
  /** Headline match credit for this elective (filled count / credited units). */
  credit?: number,
): Section {
  if (e.kind === "finite") {
    // Match credit when available (so a claimed course isn't re-counted here);
    // else a raw placed-option count.
    const placed = credit ?? e.options.filter((c) => placedCodes.has(c)).length;
    return {
      kind: "electiveFinite",
      key: `elec-${index}`,
      title: e.title,
      caption: `${Math.min(placed, e.need)} of ${e.need} done · ${e.options.length} approved courses`,
      need: e.need,
      placed,
      options: e.options,
    };
  }
  if (e.kind === "subjectPool") {
    // A trackable unit-based subject filter → render like breadth (ring + subject
    // tags), counting any in-scope placed course. Build the pool filter once and
    // reuse it across every code — don't rebuild the subject Set per iteration.
    const filter = subjectPoolFilter(e);
    const satisfiers = [...placedCodes].filter((c) => poolMatch(c, filter));
    // Match credit (post-match units) when available, else the raw eligible sum.
    const placedUnits =
      credit ?? satisfiers.reduce((sum, c) => sum + unitsOf(c), 0);
    const done = Math.min(placedUnits, e.needUnits);
    const met = unitsMet(placedUnits, e.needUnits);
    return {
      kind: "breadth",
      key: `elec-${index}`,
      title: e.title,
      caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(e.needUnits)} ${pluralize(e.needUnits, "unit")} · ${e.subjects.length} subjects`,
      needUnits: e.needUnits,
      placedUnits,
      subjects: e.subjects.map((s) => s.toUpperCase()),
      satisfiers,
    };
  }
  return {
    kind: "electiveBrowse",
    key: `elec-${index}`,
    title: e.title,
    caption: e.unitBased
      ? "Measured in units — plan manually"
      : e.eligibleCodes.length > 0
        ? `Choose from ${e.eligibleCodes.length} eligible courses`
        : "Choose from this list",
    eligibleCodes: e.eligibleCodes,
    unitBased: e.unitBased,
  };
}

/** A tracked breadth requirement → renderable section (in units). */
function breadthSection(b: BreadthRequirement, index: number): Section {
  const done = Math.min(b.placedUnits, b.needUnits);
  const met = unitsMet(b.placedUnits, b.needUnits);
  return {
    kind: "breadth",
    key: `breadth-${index}`,
    title: b.title,
    caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(b.needUnits)} ${pluralize(b.needUnits, "unit")} · ${b.subjects.length} subjects`,
    needUnits: b.needUnits,
    placedUnits: b.placedUnits,
    subjects: b.subjects,
    satisfiers: b.satisfiers,
  };
}
