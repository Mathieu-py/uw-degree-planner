import type { ElectiveCategory, Program, RuleNode } from "@/lib/programs";
import { classifyElective, consolidateElectives } from "./electives";

/**
 * Turn the "finite" approved-course lists in `electives` (choose N from a fixed
 * set — an "Approved Courses List") into named `all > pick > courses` groups. A
 * finite list is a requirement, so it belongs in the rule tree, not as a
 * separate elective row. Reuses `consolidateElectives`/`classifyElective` so the
 * result matches what `deriveElectiveSections` would have produced (same dedupe,
 * need/options, and duplicate-title disambiguation). Lists titled "…elective(s)…"
 * (engineering's "Technical Electives List") stay electives — they genuinely are.
 */
function foldGroups(electives: ElectiveCategory[]): {
  folded: RuleNode[];
  rest: ElectiveCategory[];
} {
  const folded: RuleNode[] = [];
  const rest: ElectiveCategory[] = [];
  const seenTitle = new Map<string, number>();
  for (const cat of consolidateElectives(electives)) {
    const section = classifyElective(cat);
    if (section.kind !== "finite" || /electives?/i.test(section.title)) {
      rest.push(cat);
      continue;
    }
    const n = (seenTitle.get(section.title) ?? 0) + 1;
    seenTitle.set(section.title, n);
    folded.push({
      kind: "all",
      // Named `all` wrapper → deriveMacros keeps the title as a sub-group label;
      // a bare pick would show "Complete N of the following" instead.
      description: n > 1 ? `${section.title} (${n})` : section.title,
      children: [
        {
          kind: "pick",
          selectMin: section.need,
          selectMax: section.need,
          children: [{ kind: "courses", courses: section.options }],
        },
      ],
    });
  }
  return { folded, rest };
}

/** Append folded groups to a rule root (or create an `all` when there is none). */
function attach(root: RuleNode | undefined, folded: RuleNode[]): RuleNode {
  if (root === undefined) return { kind: "all", children: folded };
  return root.kind === "all"
    ? { ...root, children: [...root.children, ...folded] }
    : { kind: "all", children: [root, ...folded] };
}

/**
 * Move "finite" approved-course lists OUT of `electives[]` and INTO the rule tree
 * as `pick` nodes, so they render and count under Degree requirements (program
 * level) or the Specialization (spec level) — like Chemistry's requirements-parsed
 * list — instead of as a separate Electives row.
 *
 * Scope:
 *  - Program level: only FLEXIBLE programs, which have `program.rules`. Engineering
 *    is modelled as per-term trees with no `rules`, so its top-level lists stay in
 *    the Electives tab.
 *  - Specialization level (any kind): a spec's finite lists fold into `spec.rules`
 *    (created if absent), which `compileAudit` compiles into the specialization
 *    tree only when that spec is selected. Fixes spec-level "Approved Courses List"
 *    requirements that were previously rendered/counted nowhere.
 *
 * Applied LOCALLY per audit (global `PROGRAMS` untouched); the referenced-code set
 * is preserved because the courses now live in a pick instead of an elective.
 */
export function foldFiniteElectivesIntoRules(program: Program): Program {
  let next = program;

  // Program level (flexible only — engineering has no `program.rules`).
  if (program.kind === "flexible" && program.electives?.length) {
    const { folded, rest } = foldGroups(program.electives);
    if (folded.length > 0)
      next = {
        ...program,
        rules: attach(program.rules, folded),
        electives: rest,
      };
  }

  // Specialization level (any kind) — fold each spec's finite lists into its rules.
  const specs = next.specializations;
  if (specs?.length) {
    let specsChanged = false;
    const foldedSpecs = specs.map((spec) => {
      if (!spec.electives?.length) return spec;
      const { folded, rest } = foldGroups(spec.electives);
      if (folded.length === 0) return spec;
      specsChanged = true;
      return { ...spec, rules: attach(spec.rules, folded), electives: rest };
    });
    if (specsChanged) next = { ...next, specializations: foldedSpecs };
  }

  return next;
}
