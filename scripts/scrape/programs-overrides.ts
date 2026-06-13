/**
 * Per-program rule patches for malformed Kuali source the parser can't recover.
 * Each entry's nodes are AND-ed onto the parsed tree, so an override only *adds*
 * a dropped requirement — never edits or removes what the parser found. Keep
 * this map tiny: fix the parser for general patterns; override only one-off typos.
 */
import type { RuleNode } from "../../lib/programs";

const RULE_OVERRIDES: Record<string, RuleNode[]> = {
  // Kuali emits the BSc Communication Requirement as "Complete of the following:
  // COMMST 193, ENGL 193" — count missing, so it matches DEFERRED_PROSE_RE and is
  // silently dropped. Intent is "complete 1 of" (issue #49). Only hydrogeology
  // hits the malformed phrasing.
  "earth-sciences-hydrogeology": [
    {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["commst193", "engl193"] }],
    },
  ],
};

/**
 * Return `rules` with any per-program override nodes AND-ed in (identity when
 * none). Nodes append into the top-level "all" group so they sit alongside the
 * existing requirements rather than wrapping the tree in an extra layer.
 */
export function applyRuleOverrides(slug: string, rules: RuleNode): RuleNode {
  const extra = RULE_OVERRIDES[slug];
  if (!extra || extra.length === 0) return rules;

  // Common shape: { all: [ { all: [...real rules...] } ] } — append into the
  // inner group so the patch reads as a sibling of the existing requirements.
  if (rules.kind === "all" && rules.children[0]?.kind === "all") {
    const [inner, ...rest] = rules.children;
    return {
      ...rules,
      children: [
        { ...inner, children: [...inner.children, ...extra] },
        ...rest,
      ],
    };
  }

  if (rules.kind === "all") {
    return { ...rules, children: [...rules.children, ...extra] };
  }

  // Non-"all" root: wrap so the override is required alongside it.
  return { kind: "all", children: [rules, ...extra] };
}
