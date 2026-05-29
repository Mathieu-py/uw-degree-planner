/**
 * Per-program rule patches for cases where the Kuali catalog source is
 * malformed and the parser cannot recover the requirement on its own.
 *
 * Each entry's nodes are AND-ed onto the program's parsed rule tree, so an
 * override only ever *adds* a requirement that Kuali dropped — it never edits
 * or removes what the parser found.
 *
 * Keep this map as small as possible: prefer fixing the parser when a pattern
 * is general. Use an override only for genuine one-off source typos.
 */
import type { RuleNode } from "../lib/programs";

const RULE_OVERRIDES: Record<string, RuleNode[]> = {
  // Kuali emits the BSc Communication Requirement as
  //   "Complete of the following: COMMST 193, ENGL 193"
  // with the count missing, so the prose matches DEFERRED_PROSE_RE and the
  // whole rule is silently dropped — leaving the program with no comms
  // requirement at all. The intent is "complete 1 of": the UW Science
  // communication requirement is one of ENGL 193 / COMMST 193. See issue #49.
  // (Other Earth Sciences specializations parse their comms rule cleanly; only
  // hydrogeology hits the malformed phrasing.)
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
 * Return `rules` with any per-program override nodes AND-ed in. Programs with
 * no override are returned unchanged (identity).
 *
 * Override nodes are appended to the deepest top-level "all" group so they sit
 * alongside the program's other requirement nodes rather than wrapping the
 * whole tree in an extra layer.
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
