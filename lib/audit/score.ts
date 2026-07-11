/**
 * The single reconciliation between the compiled tree (compile.ts) and the
 * global one-course-per-slot match (progress.ts): cards consume a ScoredNode
 * and can't mix the two truths. Presentation (warn chips, a pick's option
 * chips) still reads `scored.node` — chips show plan reality; `credit` and
 * `complete` show what counts.
 */

import { progressPct, unitsMet } from "@/lib/format";
import type { TermLetter } from "@/lib/programs";
import {
  type AuditNode,
  type AuditRoot,
  isLegallyMet,
  type RuleSummary,
  summarizeStep,
} from "./compile";
import type { DegreeProgress, NodeAssigned, NodeFill } from "./progress";

export interface ScoredNode {
  /** The compiled node (shape, satisfiers, illegal, missing, excluded). */
  node: AuditNode;
  /** Slots (units for unit-stated pools) this rule demands — `summarize` semantics. */
  needed: number;
  /** Match credit capped at `needed`; for `local` nodes, `legalSatisfied` (summarize). */
  credit: number;
  /** The match-assigned codes for this subtree; [] for `local` nodes. */
  creditedCodes: string[];
  /** The single recede-gating truth (per-kind rules in `completeOf`). */
  complete: boolean;
  /**
   * `local` = scored from the compiled node alone: a genuinely-compound pick's
   * subtree (the match only buckets its satisfied options — partial options
   * would falsely read 0), or a whole tree scored without `progress`.
   */
  source: "match" | "local";
  /** Index-aligned with `node.children`. */
  children: ScoredNode[];
}

export interface ScoredAudit {
  flexible: ScoredNode | null;
  specialization: ScoredNode | null;
  byTerm: Record<TermLetter, ScoredNode> | null;
}

/** The match maps the scorer consumes; a Pick of DegreeProgress so tests can hand-build them. */
export type ScoreInputs = Pick<DegreeProgress, "nodeFill" | "nodeAssigned">;

/**
 * Flatten a 1-of-1 pick over single courses (even nested) into its option
 * codes; `null` when any option is genuinely compound. Lives here because it
 * decides scoring source (via `pickOptions`/`isCompoundPick`).
 */
function flatChoiceOptions(node: AuditNode): string[] | null {
  const r = node.ruleNode;
  if (r.kind === "courses")
    return r.courses.length === 1 ? [r.courses[0]] : null;
  if (r.kind !== "pick") return null;
  if ((r.selectMin ?? 1) !== 1 || (r.selectMax ?? 1) !== 1) return null;
  const opts: string[] = [];
  if (node.children.length === 0) {
    // Compiler-unioned course leaves: each code is its own option.
    for (const c of r.children) {
      if (c.kind !== "courses") return null;
      opts.push(...c.courses);
    }
  } else {
    for (const child of node.children) {
      const sub = flatChoiceOptions(child);
      if (!sub) return null;
      opts.push(...sub);
    }
  }
  return [...new Set(opts)];
}

/**
 * A non-compound pick's flat "choose one" options (all-`courses` union, else
 * the nested flat choice); `null` ⇒ compound. NodeBody dispatches on this and
 * `isCompoundPick` is defined by it, so rendering and scoring can't disagree.
 */
export function pickOptions(node: AuditNode): string[] | null {
  const r = node.ruleNode;
  if (r.kind !== "pick") return null;
  const allCourses =
    r.children.length > 0 && r.children.every((c) => c.kind === "courses");
  if (allCourses)
    return [
      ...new Set(
        r.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
      ),
    ];
  const flat = flatChoiceOptions(node);
  return flat && flat.length > 0 ? flat : null;
}

/** A pick that renders as CompoundPickBody — neither all-`courses` nor a flat choice. */
export function isCompoundPick(node: AuditNode): boolean {
  return node.ruleNode.kind === "pick" && pickOptions(node) === null;
}

/** A compound-pick option decides its pick iff legally met. The recede gate
 *  and CompoundPickBody's receded list must share this predicate — a split
 *  lets a decided pick recede with an empty or phantom option list. */
export function optionMet(option: AuditNode): boolean {
  return isLegallyMet(option);
}

/** Receded-chip codes for a match-credited node: what credited here, plus
 *  illegal satisfiers — credited codes are always legal (progress.ts filters
 *  them before matching), so without the union the warning vanishes on recede. */
export function creditedChipCodes(
  scored: ScoredNode,
  illegalCodes: ReadonlySet<string>,
): Set<string> {
  return new Set([
    ...scored.creditedCodes,
    ...scored.node.satisfiers
      .map((p) => p.code)
      .filter((c) => illegalCodes.has(c)),
  ]);
}

/**
 * Recede-gating truth per rule kind; each branch reproduces the card behavior:
 *  - `courses`: legality alone — a leaf whose code/twin bucket is owned by
 *    another leaf has zero credit yet is genuinely done.
 *  - flat picks: legality AND credit — a shared option claimed elsewhere
 *    doesn't decide this pick; min-0 still needs a real satisfier.
 *  - `subjectPool` (match): credit alone — pool eligibility is drawn from the
 *    legality-filtered placed set, so credit ≥ need implies enough LEGAL matches.
 *  - compound pick: options legally met vs selectMin ?? 1 (the card's rule,
 *    not compile's `legallyMet`, which differs on min-0/vacuous children).
 */
function completeOf(
  node: AuditNode,
  source: "match" | "local",
  compound: boolean,
  credit: number,
  needed: number,
): boolean {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      return isLegallyMet(node);
    case "pick": {
      if (compound) {
        const met = node.children.filter(optionMet).length;
        return met >= (r.selectMin ?? 1);
      }
      if (source === "match") return isLegallyMet(node) && credit >= needed;
      return isLegallyMet(node);
    }
    case "subjectPool":
      return source === "match" ? unitsMet(credit, needed) : isLegallyMet(node);
    case "all":
      // Informational — no card recedes on an `all`; NodeBody recurses.
      return isLegallyMet(node);
    case "excluded":
      return true;
  }
}

interface ScorePass {
  scored: ScoredNode;
  /** Uncapped match fill for this subtree — accumulates through `local` subtrees too. */
  rawFill: number;
  /** Match-assigned codes for this subtree — likewise uncapped/unfiltered. */
  rawAssigned: string[];
  /** This node's summary, folded from the children's (one summarize pass total). */
  summary: RuleSummary;
}

/**
 * `credit` caps the RAW subtree fill per node — never sum capped children
 * upward: a satisfied compound option's interior fill legitimately overflows
 * its pick's `selectMin` and offsets other unmet leaves in ancestor totals.
 */
function score(
  node: AuditNode,
  fill: NodeFill | undefined,
  assigned: NodeAssigned | undefined,
  forceLocal: boolean,
): ScorePass {
  const compound = isCompoundPick(node);
  const childrenPass = node.children.map((c) =>
    score(c, fill, assigned, forceLocal || compound),
  );

  let rawFill = fill?.get(node) ?? 0;
  const own = assigned?.get(node);
  const rawAssigned: string[] = own ? [...own] : [];
  for (const c of childrenPass) {
    rawFill += c.rawFill;
    rawAssigned.push(...c.rawAssigned);
  }

  const source: "match" | "local" =
    fill === undefined || forceLocal || compound ? "local" : "match";
  const s = summarizeStep(
    node,
    childrenPass.map((c) => c.summary),
  );
  const credit =
    source === "match" ? Math.min(rawFill, s.needed) : s.legalSatisfied;

  return {
    scored: {
      node,
      needed: s.needed,
      credit,
      creditedCodes: source === "match" ? rawAssigned : [],
      complete: completeOf(node, source, compound, credit, s.needed),
      source,
      children: childrenPass.map((c) => c.scored),
    },
    rawFill,
    rawAssigned,
    summary: s,
  };
}

/** Score one compiled node; omitting `progress` scores the subtree `local`. */
export function scoreNode(node: AuditNode, progress?: ScoreInputs): ScoredNode {
  return score(node, progress?.nodeFill, progress?.nodeAssigned, false).scored;
}

/**
 * Score every root of a compiled audit. `progress` MUST come from
 * `computeDegreeProgress` run on this exact `audit` — the fill maps are keyed
 * by node identity, so a mismatched pair silently scores everything zero.
 */
export function scoreAudit(
  audit: AuditRoot,
  progress?: ScoreInputs,
): ScoredAudit {
  const one = (n: AuditNode | null): ScoredNode | null =>
    n ? scoreNode(n, progress) : null;
  let byTerm: Record<TermLetter, ScoredNode> | null = null;
  if (audit.byTerm) {
    byTerm = Object.fromEntries(
      Object.entries(audit.byTerm).map(([t, n]) => [t, scoreNode(n, progress)]),
    ) as Record<TermLetter, ScoredNode>;
  }
  return {
    flexible: one(audit.flexibleRoot),
    specialization: one(audit.specializationRoot),
    byTerm,
  };
}

/** Progress ring for a sub-labeled node block (a term, spec, named sub-group). */
export function ringFor(scored: ScoredNode): {
  pct: number;
  num: number;
  optional: boolean;
} {
  return {
    pct: progressPct(scored.credit, scored.needed, 0),
    num: scored.credit,
    optional: scored.needed === 0,
  };
}
