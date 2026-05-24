/**
 * Path-aware view of the program rule tree for the variant-picker UI.
 *
 * Each pickable `pick` node (one whose children are all `kind: "courses"`
 * leaves AND that isn't functionally mandatory) gets a canonical AST path
 * the variant-picker modal uses to key `StudentPassage.choiceGroupSelections`.
 *
 * Path scheme:
 *  - Engineering: `<term>.<idx>.<idx>...` — term letter (`"1A".."4B"`) followed by
 *    zero or more dot-separated DFS child-indices into that term's rule tree.
 *    E.g. `"2A.3.1"` = `program.terms["2A"].children[3].children[1]`.
 *  - Flexible: `<idx>.<idx>...` — DFS child-indices starting from `program.rules`.
 *    E.g. `"5.2"` = `program.rules.children[5].children[2]`. The root itself is
 *    the empty string `""`.
 *  - Decoder disambiguates by testing whether the first segment matches a term
 *    letter; flexible-program paths never start with one.
 *
 * Paths are fragile to scrape reorders. They survive scrape reruns when the
 * upstream rule order is stable (Kuali's `requirements` array is — confirmed
 * across the diagnostic spike); they would shift if the scraper restructures
 * children. That fragility is documented and accepted (ADR 0001 line 85).
 */

import {
  describeRule,
  functionallyMandatoryCourses,
  isTermLetter,
  PROGRAMS,
  type Program,
  type RuleNode,
  TERM_LETTERS,
  type TermLetter,
} from "./programs";

type PickRuleNode = Extract<RuleNode, { kind: "pick" }>;

export interface ChoiceGroupEntry {
  path: string;
  node: PickRuleNode;
  termLabel: TermLetter | null;
  options: string[];
  selectMin: number | undefined;
  selectMax: number | undefined;
  description: string;
}

/**
 * One entry per pickable `pick` in the program, in DFS pre-order. Engineering
 * walks term-by-term in `TERM_LETTERS` order. Functionally-mandatory picks
 * (a pick whose `selectMin` equals its total unique option count) are
 * excluded — the student has no real choice there.
 */
export function enumerateChoiceGroups(program: Program): ChoiceGroupEntry[] {
  const out: ChoiceGroupEntry[] = [];
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS) {
      collect(program.terms[t], t, t, out);
    }
  } else {
    collect(program.rules, "", null, out);
  }
  return out;
}

function collect(
  node: RuleNode,
  prefix: string,
  termLabel: TermLetter | null,
  out: ChoiceGroupEntry[],
): void {
  if (node.kind === "pick") {
    if (isPickable(node)) {
      const options = [
        ...new Set(
          node.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
        ),
      ].sort();
      out.push({
        path: prefix,
        node,
        termLabel,
        options,
        selectMin: node.selectMin,
        selectMax: node.selectMax,
        description: describeRule(node) ?? "Pick from the following",
      });
      return;
    }
    node.children.forEach((c, i) => {
      collect(c, joinPath(prefix, i), termLabel, out);
    });
    return;
  }
  if (node.kind === "all") {
    node.children.forEach((c, i) => {
      collect(c, joinPath(prefix, i), termLabel, out);
    });
  }
  // courses / subjectPool / excluded — no descendants to surface as picks.
}

function joinPath(prefix: string, i: number): string {
  return prefix === "" ? String(i) : `${prefix}.${i}`;
}

function isPickable(node: PickRuleNode): boolean {
  if (node.children.length === 0) return false;
  if (!node.children.every((c) => c.kind === "courses")) return false;
  const total = node.children.flatMap((c) =>
    c.kind === "courses" ? c.courses : [],
  ).length;
  if (total === 0) return false;
  // pick(N,N) whose option count equals N is mandatory — the student must
  // take every listed course, so there's no choice to record.
  return functionallyMandatoryCourses(node) === null;
}

/**
 * Resolve a path key back to the `RuleNode` it identifies in the program's
 * AST. Returns `null` if the path is malformed, the engineering term letter
 * doesn't match this program shape, or any index walks past the children
 * array. Used to validate stored selections against the current program
 * (stale selections from an older scrape silently drop).
 */
export function resolveChoiceGroupPath(
  program: Program,
  path: string,
): RuleNode | null {
  const segs = path === "" ? [] : path.split(".");
  let node: RuleNode;
  if (program.kind === "engineering") {
    const head = segs[0];
    if (!isTermLetter(head)) return null;
    node = program.terms[head];
    segs.shift();
  } else {
    // Flexible paths must not carry a term-letter prefix; if the first
    // segment looks like a term letter the path was authored against an
    // engineering program — refuse it.
    if (segs.length > 0 && isTermLetter(segs[0])) return null;
    node = program.rules;
  }
  for (const s of segs) {
    if (!/^\d+$/.test(s)) return null;
    if (node.kind !== "all" && node.kind !== "pick") return null;
    const i = parseInt(s, 10);
    const child = node.children[i];
    if (!child) return null;
    node = child;
  }
  return node;
}

/**
 * Union of every selected course code that resolves to a real option in the
 * current program tree. Codes that don't belong to their pick's options are
 * silently dropped (defensive against stale selections after a scrape or a
 * hand-edited URL). Sorted output, deduped.
 *
 * Unknown program → []. Empty selections → [].
 */
export function pickedCoursesFor(
  programId: string,
  choiceGroupSelections: Record<string, string[]>,
): string[] {
  const program = PROGRAMS[programId];
  if (!program) return [];
  const out = new Set<string>();
  for (const [path, codes] of Object.entries(choiceGroupSelections)) {
    const node = resolveChoiceGroupPath(program, path);
    if (!node || node.kind !== "pick") continue;
    const validOptions = new Set(
      node.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
    );
    for (const code of codes) {
      if (validOptions.has(code)) out.add(code);
    }
  }
  return [...out].sort();
}
