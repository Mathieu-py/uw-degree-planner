import { describe, expect, it } from "vitest";
import { type AuditNode, compileAudit, isSatisfied } from "@/lib/audit/compile";
import { PROGRAMS } from "@/lib/programs";
import { enumerateVariantGroups } from "@/lib/requirements/variantGroups";
import { addCourseToSlot } from "../mutateSlots";
import { buildEmptySlots } from "../sequence";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../types";
import { resolveVariantPlacements } from "../variantPlacement";

const START = 1239; // Fall 2023.

function emptyManualPlan(programId: string): LocalPlan {
  let n = 0;
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: [programId],
    specializationIds: {},
    stream: "regular",
    startTermId: START,
    slots: buildEmptySlots(START, "regular", () => `s${n++}`, 8),
    acknowledgedRequirements: {},
    updatedAt: "",
  };
}

/** The compiled pick node whose option list names `code`, or null. */
function findPick(node: AuditNode, code: string): AuditNode | null {
  if (
    node.ruleNode.kind === "pick" &&
    node.ruleNode.children.some(
      (c) => c.kind === "courses" && c.courses.includes(code),
    )
  ) {
    return node;
  }
  for (const child of node.children) {
    const found = findPick(child, code);
    if (found) return found;
  }
  return null;
}

// End-to-end guarantee that the manual-onboarding variant picker resolves
// choices the degree audit actually credits — the two must never drift.
describe("variant picker ↔ audit sync", () => {
  it("a picked flexible variant is credited by the audit", () => {
    const programId = "h-computer-science-bcs";
    const program = PROGRAMS[programId];
    const intro = enumerateVariantGroups(program, programId).find((g) =>
      g.options.includes("cs135"),
    );
    expect(intro).toBeDefined();

    // Baseline: the intro-CS pick is undecided on an empty plan.
    const before = compileAudit(
      program,
      emptyManualPlan(programId),
      null,
      new Set(),
      programId,
    );
    const introBefore = findPick(before.flexibleRoot as AuditNode, "cs135");
    expect(introBefore && isSatisfied(introBefore)).toBe(false);

    // Simulate the picker: choose cs135, resolve its placement, apply it.
    const placements = resolveVariantPlacements(
      {
        programIds: [programId],
        startTermId: START,
        stream: "regular",
        selections: [{ code: "cs135", termLabel: intro?.termLabel ?? null }],
      },
      [],
    );
    let plan = emptyManualPlan(programId);
    const slotByPosition = new Map(plan.slots.map((s) => [s.position, s.id]));
    for (const p of placements) {
      const slotId = slotByPosition.get(p.position);
      if (slotId) plan = addCourseToSlot(plan, slotId, { code: p.code });
    }

    // After: the same pick reads satisfied, credited to cs135.
    const after = compileAudit(program, plan, null, new Set(), programId);
    const introAfter = findPick(after.flexibleRoot as AuditNode, "cs135");
    expect(introAfter).not.toBeNull();
    expect(isSatisfied(introAfter as AuditNode)).toBe(true);
    expect((introAfter as AuditNode).satisfiers.map((s) => s.code)).toContain(
      "cs135",
    );
  });

  it("an engineering pick placed in its rule term is credited", () => {
    const programId = "computer-engineering";
    const program = PROGRAMS[programId];
    const group = enumerateVariantGroups(program, programId).find(
      (g) => g.options.includes("commst192") && g.options.includes("engl192"),
    );
    expect(group?.termLabel).toBe("1A");

    const placements = resolveVariantPlacements(
      {
        programIds: [programId],
        startTermId: START,
        stream: "regular",
        selections: [
          { code: "commst192", termLabel: group?.termLabel ?? null },
        ],
      },
      [],
    );
    let plan = emptyManualPlan(programId);
    const slotByPosition = new Map(plan.slots.map((s) => [s.position, s.id]));
    for (const p of placements) {
      const slotId = slotByPosition.get(p.position);
      if (slotId) plan = addCourseToSlot(plan, slotId, { code: p.code });
    }

    const after = compileAudit(program, plan, null, new Set(), programId);
    // Engineering audits per term; the pick lives in 1A's tree.
    const pick = findPick(after.byTerm?.["1A"] as AuditNode, "commst192");
    expect(pick).not.toBeNull();
    expect(isSatisfied(pick as AuditNode)).toBe(true);
  });
});
