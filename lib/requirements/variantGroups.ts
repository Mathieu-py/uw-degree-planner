/**
 * Pickable variant groups of a program's rule tree, for the manual-onboarding
 * variant picker (#84). A group is a `pick` whose children are all `courses`
 * leaves and that isn't functionally mandatory — i.e. a real "Complete N of
 * these course numbers" choice (CS115 / CS135 / CS145, CS240 / CS240E, …).
 *
 * Unlike the removed `lib/courses/choiceGroups.ts`, this carries NO AST-path
 * selection scheme (ADR 0001 flagged those as fragile to scraper reorders):
 * the picker resolves each choice straight into a placed slot course — the
 * durable representation — so `key` is only an in-memory React/selection id.
 */

import type { Program, TermLetter } from "@/lib/programs";
import { TERM_LETTERS } from "@/lib/programs";
import { describeRule } from "./describe";
import type { RuleNode } from "./types";
import { functionallyMandatoryCourses } from "./walk";

export interface VariantGroup {
  programId: string;
  /** In-memory React + selection key (NOT persisted). Unique per program/term/node. */
  key: string;
  /** Engineering term the pick belongs to; null for flexible programs. */
  termLabel: TermLetter | null;
  /** Verbatim rule prose, e.g. "Complete 1 of the following". */
  description: string;
  /** `pick` bounds, null when the rule omits them ("Choose any"). */
  selectMin: number | null;
  selectMax: number | null;
  /** Deduped, sorted option course codes. */
  options: string[];
}

type PickNode = Extract<RuleNode, { kind: "pick" }>;

/** Flat course options of an all-`courses` pick, deduped and sorted. */
function optionsOf(node: PickNode): string[] {
  return [
    ...new Set(
      node.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
    ),
  ].sort();
}

/** A pick the student genuinely decides: all-`courses` children, not mandatory. */
function isPickable(node: PickNode): boolean {
  if (node.children.length === 0) return false;
  if (!node.children.every((c) => c.kind === "courses")) return false;
  if (optionsOf(node).length === 0) return false;
  // pick(N,N) whose option count equals N is mandatory — no choice to record.
  return functionallyMandatoryCourses(node) === null;
}

function joinPath(prefix: string, i: number): string {
  return prefix === "" ? String(i) : `${prefix}.${i}`;
}

function collect(
  node: RuleNode,
  programId: string,
  termLabel: TermLetter | null,
  path: string,
  out: VariantGroup[],
): void {
  if (node.kind === "pick") {
    if (isPickable(node)) {
      out.push({
        programId,
        key: `${programId}:${termLabel ?? "flex"}:${path}`,
        termLabel,
        description: describeRule(node) ?? "Choose from the following",
        selectMin: node.selectMin ?? null,
        selectMax: node.selectMax ?? null,
        options: optionsOf(node),
      });
      return;
    }
    recurse(node, programId, termLabel, path, out);
    return;
  }
  if (node.kind === "all") {
    recurse(node, programId, termLabel, path, out);
  }
  // courses / subjectPool / excluded — no pickable descendants.
}

/** DFS into a container node's children, extending the index path per child. */
function recurse(
  node: Extract<RuleNode, { kind: "all" | "pick" }>,
  programId: string,
  termLabel: TermLetter | null,
  path: string,
  out: VariantGroup[],
): void {
  for (let i = 0; i < node.children.length; i++) {
    collect(node.children[i], programId, termLabel, joinPath(path, i), out);
  }
}

/**
 * Pickable variant groups of `program`, in DFS pre-order. Engineering walks
 * term-by-term (each group carries its term); flexible walks the single tree
 * (term null). `programId` (the PROGRAMS map key) is stamped on each group and
 * seeds its `key` so a double degree's two programs never collide.
 */
export function enumerateVariantGroups(
  program: Program,
  programId: string,
): VariantGroup[] {
  const out: VariantGroup[] = [];
  if (program.kind === "engineering") {
    for (const t of TERM_LETTERS)
      collect(program.terms[t], programId, t, "", out);
  } else {
    collect(program.rules, programId, null, "", out);
  }
  return out;
}
