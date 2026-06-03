// @vitest-environment jsdom
//
// Cross-program mapping audit. For EVERY program in the catalog, render the
// real AuditPanel and assert that no requirement is silently dropped:
//   1. every course code in a (non-excluded) `courses` leaf of the rule tree,
//      plus every finite-elective approved course, is rendered somewhere; and
//   2. no "choose one" row renders zero options.
// These are the invariants a presentation rewrite can quietly violate (e.g. a
// pick branch that drops its non-`courses` siblings).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveElectiveSections } from "@/lib/audit/electives";
import { formatCourseCode } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import {
  PROGRAMS,
  type Program,
  type RuleNode,
  type Specialization,
} from "@/lib/programs";
import { AuditPanel } from "../AuditPanel";

afterEach(cleanup);

function emptyPlan(
  programId: string,
  specializationId: string | null,
): LocalPlan {
  return {
    schemaVersion: 1,
    programId,
    specializationId,
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

// Codes the panel is expected to surface as draggable rows/chips: every
// `courses` leaf anywhere in the tree (picks render their options; mixed picks
// recurse into their course leaves). `excluded` leaves are deliberately not
// rendered. `subjectPool` carries no fixed codes (it's Browse-only).
function collectCourseLeafCodes(node: RuleNode, out: Set<string>): void {
  if (node.kind === "courses") {
    for (const c of node.courses) out.add(c);
    return;
  }
  if (node.kind === "all" || node.kind === "pick") {
    for (const child of node.children) collectCourseLeafCodes(child, out);
  }
  // subjectPool / excluded: nothing to add.
}

function expectedCodes(program: Program): Set<string> {
  const out = new Set<string>();
  if (program.kind === "engineering") {
    for (const term of Object.values(program.terms))
      collectCourseLeafCodes(term, out);
  } else {
    collectCourseLeafCodes(program.rules, out);
  }
  // Finite electives ("Complete N of the following") render their options.
  for (const e of deriveElectiveSections(program)) {
    if (e.kind === "finite") for (const c of e.options) out.add(c);
  }
  return out;
}

// "CS 246" / "cs246" → "CS246" so source codes and rendered labels compare.
function normalize(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

describe("AuditPanel cross-program mapping audit", () => {
  const programIds = Object.keys(PROGRAMS);

  it("covers a large, representative set of programs", () => {
    // Guard against the fixture silently shrinking; the audit is only as good
    // as its breadth.
    expect(programIds.length).toBeGreaterThan(150);
  });

  it.each(
    programIds,
  )("renders every required course and no empty choose-one row: %s", (programId) => {
    const program = PROGRAMS[programId];
    const { container } = render(
      <AuditPanel
        plan={emptyPlan(programId, null)}
        onDrillToRequirement={() => {}}
      />,
    );

    // No "choose one" row may render without options.
    for (const choose of container.querySelectorAll(".av-choose")) {
      expect(
        choose.querySelectorAll(".av-chip").length,
        `empty choose-one row in ${programId}`,
      ).toBeGreaterThan(0);
    }

    // Every expected code must appear somewhere in the panel.
    const rendered = new Set<string>();
    for (const el of container.querySelectorAll(".av-item-code, .av-chip")) {
      rendered.add(normalize(el.textContent ?? ""));
    }
    const missing: string[] = [];
    for (const code of expectedCodes(program)) {
      if (!rendered.has(normalize(formatCourseCode(code)))) missing.push(code);
    }
    expect(
      missing,
      `${programId}: ${missing.length} requirement code(s) not rendered (e.g. ${missing.slice(0, 8).join(", ")})`,
    ).toEqual([]);
  });

  // Every (program, specialization) pair with inline rules.
  const specPairs: Array<{ programId: string; spec: Specialization }> = [];
  for (const [programId, program] of Object.entries(PROGRAMS)) {
    for (const spec of program.specializations ?? []) {
      if (spec.rules) specPairs.push({ programId, spec });
    }
  }

  it("audits a broad set of specializations", () => {
    expect(specPairs.length).toBeGreaterThan(150);
  });

  it.each(
    specPairs.map((p) => [`${p.programId} · ${p.spec.slug}`, p] as const),
  )("renders specialization requirements without dropping any: %s", (_label, {
    programId,
    spec,
  }) => {
    const { container } = render(
      <AuditPanel
        plan={emptyPlan(programId, spec.slug)}
        onDrillToRequirement={() => {}}
      />,
    );

    for (const choose of container.querySelectorAll(".av-choose")) {
      expect(
        choose.querySelectorAll(".av-chip").length,
        `empty choose-one row in ${programId}/${spec.slug}`,
      ).toBeGreaterThan(0);
    }

    const rendered = new Set<string>();
    for (const el of container.querySelectorAll(".av-item-code, .av-chip")) {
      rendered.add(normalize(el.textContent ?? ""));
    }
    const expected = new Set<string>();
    if (spec.rules) collectCourseLeafCodes(spec.rules, expected);
    const missing = [...expected].filter(
      (code) => !rendered.has(normalize(formatCourseCode(code))),
    );
    expect(
      missing,
      `${programId}/${spec.slug}: ${missing.length} spec code(s) not rendered (e.g. ${missing.slice(0, 8).join(", ")})`,
    ).toEqual([]);
  });
});
