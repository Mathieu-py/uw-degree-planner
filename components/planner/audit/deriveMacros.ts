import {
  type BreadthRequirement,
  nonBreadthConstraints,
} from "@/lib/audit/breadth";
import { deriveCommunicationRequirement } from "@/lib/audit/communication";
import {
  type AuditNode,
  type AuditRoot,
  placementLegalityKey,
} from "@/lib/audit/compile";
import {
  deriveElectiveSections,
  type ElectiveSection,
  subjectPoolEligible as electivePoolEligible,
} from "@/lib/audit/electives";
import { isLevelFloor, type LevelFloor } from "@/lib/audit/levelFloors";
import { fmtUnits, formatCourseCode } from "@/lib/format";
import { type Program, TERM_LETTERS } from "@/lib/programs";
import { nodeProgress } from "./nodeProgress";
import {
  GENERIC_ALL,
  type Macro,
  type MacroBlock,
  type Section,
} from "./types";

/**
 * Flatten a rule-tree root into renderable blocks. The generic "Complete all of
 * the following" wrapper carries no information, so flatten *through* it (render
 * the whole root as one flat node body); only a meaningfully NAMED sub-group
 * ("Core Courses", "Design Project") is kept as a light sub-label.
 */
function flattenRuleRoot(root: AuditNode): MacroBlock[] {
  if (root.ruleNode.kind === "all" && root.children.length > 0) {
    const everyChildGeneric = root.children.every(
      (c) =>
        c.ruleNode.kind !== "all" ||
        c.description == null ||
        c.description === GENERIC_ALL,
    );
    if (everyChildGeneric)
      return [{ subLabel: null, content: { kind: "node", node: root } }];
    return root.children.map((c) => ({
      subLabel:
        c.ruleNode.kind === "all" &&
        c.description != null &&
        c.description !== GENERIC_ALL
          ? c.description
          : null,
      content: { kind: "node", node: c },
    }));
  }
  return [{ subLabel: null, content: { kind: "node", node: root } }];
}

/**
 * Translate the compiled `AuditRoot` (+ the program's elective/degree notes)
 * into the three top-level macro-sections the panel renders:
 *
 *  - Degree requirements — every required core course/choice, flattened out of
 *    the rule tree (engineering: per term; flexible: the rule tree), plus
 *    specialization, communication, and level-floor minimums.
 *  - Electives — `program.electives[]`, faculty breadth/distribution, and the
 *    free-elective volume note.
 *  - Co-op & other — co-op/PD and other informational notes, non-breadth
 *    constraints, and requirements the scraper couldn't structure.
 *
 * The header chip per macro is a course-ish count; the whole-degree unit
 * headline above is computed separately (see computeDegreeProgress) and is not
 * derived here.
 */
export function deriveMacros(
  audit: AuditRoot,
  program: Program | null,
  /** Free-elective units from the unified headline model. */
  freeElectiveUnits: number,
  /** Scored breadth requirements (units) from the unified headline model. */
  breadthRequirements: BreadthRequirement[],
  /** Scored level-floor requirements from the unified headline model. */
  levelFloors: LevelFloor[],
  /** Units of a placed course (catalog-backed; default 0.5). */
  unitsOf: (code: string) => number,
  /** Slot-scoped illegality keys; illegal placements don't credit counts. */
  legality: ReadonlySet<string>,
): { macros: Macro[]; unverifiedCount: number } {
  // Count completion the same way the headline does — illegally-placed courses
  // (unmet prereq / antireq conflict) don't credit. (Degree-requirement rows use
  // nodeProgress, which already drops illegal satisfiers; this keeps the elective
  // and communication counts below consistent with both.)
  const placedCodes = new Set<string>();
  for (const [code, p] of audit.placement)
    if (!legality.has(placementLegalityKey(p))) placedCodes.add(code);

  // ---- Degree requirements: required core, flattened ----
  const degreeBlocks: MacroBlock[] = [];
  let degNeeded = 0;
  let degSatisfied = 0;

  if (audit.byTerm) {
    // Engineering: keep the per-term breakdown (term order is meaningful) as a
    // light sub-label over each term's flattened requirement rows.
    for (const t of TERM_LETTERS) {
      const node = audit.byTerm[t];
      if (!node) continue;
      const summary = nodeProgress(node);
      if (summary.needed === 0) continue;
      degNeeded += summary.needed;
      degSatisfied += summary.satisfied;
      degreeBlocks.push({
        subLabel: `Term ${t}`,
        content: { kind: "node", node },
      });
    }
  }
  if (audit.flexibleRoot) {
    for (const block of flattenRuleRoot(audit.flexibleRoot)) {
      if (block.content.kind === "node") {
        const s = nodeProgress(block.content.node);
        degNeeded += s.needed;
        degSatisfied += s.satisfied;
      }
      degreeBlocks.push(block);
    }
  }
  // Specialization is its own top-level macro (built into specBlocks), not part
  // of the Degree-requirements count.
  const specBlocks: MacroBlock[] = [];
  let specNeeded = 0;
  let specSatisfied = 0;
  if (audit.specializationRoot) {
    for (const block of flattenRuleRoot(audit.specializationRoot)) {
      if (block.content.kind === "node") {
        const s = nodeProgress(block.content.node);
        specNeeded += s.needed;
        specSatisfied += s.satisfied;
      }
      specBlocks.push(block);
    }
  }

  // Communication + level-floor minimums — degree-level course/unit minimums,
  // grouped under a quiet "Degree minimums" sub-label. Each met requirement
  // contributes 1/1 to the macro count (units don't map cleanly to a course
  // count, so floors/breadth are scored as a met boolean here).
  if (program) {
    const minima: Section[] = [];
    const comm = deriveCommunicationRequirement(program, placedCodes);
    if (comm && !comm.alreadyInTree) {
      degNeeded += comm.need;
      degSatisfied += Math.min(comm.placed, comm.need);
      minima.push({
        kind: "electiveFinite",
        key: "deg-comm",
        title: comm.title,
        caption: `${comm.placed} of ${comm.need} done · ${comm.options.map(formatCourseCode).join(" or ")}`,
        need: comm.need,
        placed: comm.placed,
        options: comm.options,
      });
    }
    levelFloors.forEach((f, i) => {
      const done = Math.min(f.placedUnits, f.need);
      const met = f.placedUnits >= f.need - 1e-9;
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
  // These fold into the Degree-requirements macro under an "Electives" sub-label
  // (electives ARE degree requirements). Browse / unit-based electives carry no
  // honest count → surfaced as a "+N to plan" hint on the macro.
  const electiveSections: Section[] = [];
  let elecNeeded = 0;
  let elecSatisfied = 0;
  let untrackedCount = 0;
  if (program) {
    deriveElectiveSections(program)
      .map((e, i) => toElectiveSection(e, i, placedCodes, unitsOf))
      .forEach((s) => {
        if (s.kind === "electiveFinite") {
          elecNeeded += s.need;
          elecSatisfied += Math.min(s.placed, s.need);
        } else if (s.kind === "breadth") {
          elecNeeded += 1;
          elecSatisfied += s.placedUnits >= s.needUnits - 1e-9 ? 1 : 0;
        } else {
          untrackedCount += 1;
        }
        electiveSections.push(s);
      });
    breadthRequirements.forEach((b, i) => {
      elecNeeded += 1;
      elecSatisfied += b.placedUnits >= b.needUnits - 1e-9 ? 1 : 0;
      electiveSections.push(breadthSection(b, i));
    });
    // Free electives — the degree's open volume AFTER the named requirements
    // above. The units live on this row (they describe only the free remainder),
    // never on the macro heading: a program with big named electives (BME's
    // "pick 7" technical electives) has a tiny free remainder, so a heading
    // "≈ 0.5 units" would badly understate the section.
    if (freeElectiveUnits > 0) {
      const u = Math.round(freeElectiveUnits * 100) / 100;
      electiveSections.push({
        kind: "info",
        key: "free-electives",
        title: "Free electives",
        caption: `≈ ${u} unit${u === 1 ? "" : "s"}, any subject — fills the degree beyond the named requirements above.`,
      });
    }
  }

  // ---- Co-op & other: co-op/PD and other informational notes, non-breadth
  // constraints, and requirements the scraper couldn't structure. Purely
  // informational (co-op/PD isn't modelled as trackable courses) → no count.
  const otherSections: Section[] = [];
  if (program) {
    nonBreadthConstraints(program)
      .filter((c) => !isLevelFloor(c))
      .forEach((c, i) => {
        otherSections.push({
          kind: "info",
          key: `constraint-${i}`,
          title: c.label,
          caption:
            c.sourceText && c.sourceText !== c.label
              ? c.sourceText
              : "Verify with your advisor.",
        });
      });
    const items = [
      ...(program.informational ?? []),
      ...(program.degreeRequirements?.informational ?? []),
    ];
    items.forEach((it, i) => {
      otherSections.push({
        kind: "info",
        key: `info-${i}`,
        title: it.label,
        caption: it.text,
      });
    });
  }
  const unverified = program?.unverifiedRequirements ?? [];
  unverified.forEach((text, i) => {
    otherSections.push({
      kind: "info",
      key: `unverified-${i}`,
      title: "Couldn't auto-verify",
      caption: text,
    });
  });

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
  if (electiveSections.length > 0)
    macros.push({
      key: "electives",
      label: "Electives",
      count:
        elecNeeded > 0
          ? { satisfied: elecSatisfied, needed: elecNeeded }
          : null,
      hint:
        untrackedCount > 0
          ? `+ ${untrackedCount} elective requirement${untrackedCount === 1 ? "" : "s"} to plan`
          : null,
      blocks: [
        {
          subLabel: null,
          content: { kind: "sections", sections: electiveSections },
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

  return { macros, unverifiedCount: unverified.length };
}

function toElectiveSection(
  e: ElectiveSection,
  index: number,
  placedCodes: ReadonlySet<string>,
  unitsOf: (code: string) => number,
): Section {
  if (e.kind === "finite") {
    const placed = e.options.filter((c) => placedCodes.has(c)).length;
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
    // tags) in units, counting any in-scope placed course.
    const satisfiers = [...placedCodes].filter((c) =>
      electivePoolEligible(c, e),
    );
    const placedUnits = satisfiers.reduce((sum, c) => sum + unitsOf(c), 0);
    const done = Math.min(placedUnits, e.needUnits);
    const met = placedUnits >= e.needUnits - 1e-9;
    return {
      kind: "breadth",
      key: `elec-${index}`,
      title: e.title,
      caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(e.needUnits)} unit${e.needUnits === 1 ? "" : "s"} · ${e.subjects.length} subjects`,
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
  const met = b.placedUnits >= b.needUnits - 1e-9;
  return {
    kind: "breadth",
    key: `breadth-${index}`,
    title: b.title,
    caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(b.needUnits)} unit${b.needUnits === 1 ? "" : "s"} · ${b.subjects.length} subjects`,
    needUnits: b.needUnits,
    placedUnits: b.placedUnits,
    subjects: b.subjects,
    satisfiers: b.satisfiers,
  };
}
