import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "@/lib/plan/types";

// Synthetic PROGRAMS so the spec-owed folding is exercised WITHOUT
// regenerating data/programs.json. Only PROGRAMS is overridden — everything else
// (types, programReferencedCodes, …) stays real; programReferencedCodes returns an
// empty set for these unknown ids, which is fine (no antireqs to exclude).
vi.mock("@/lib/programs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/programs")>();
  const emptyRules = { kind: "all", children: [] };
  const spec = (slug: string, over: object = {}) => ({
    slug,
    name: slug,
    kualiId: slug,
    rules: emptyRules,
    ...over,
  });
  // spec-a carries an unverified rule AND a dropped free elective; spec-b only an
  // unverified rule. Both are attached to the same parent (as in production).
  const base = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: emptyRules,
    specializations: [
      spec("spec-a", {
        unverifiedRequirements: ["REQ A"],
        freeElectives: ["FREE A"],
      }),
      spec("spec-b", { unverifiedRequirements: ["REQ B"] }),
    ],
  };
  return {
    ...actual,
    PROGRAMS: {
      "p-nototal": base,
      "p-total": { ...base, unitPlan: { totalUnits: 5 } },
    } as typeof actual.PROGRAMS,
  };
});

// Import AFTER the mock is registered (vi.mock is hoisted above this).
const { buildProgramAudit } = await import("../buildProgramAudit");

function mkPlan(
  programId: string,
  specSlug: string | null,
  acked?: string[],
): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: [programId],
    specializationIds: specSlug ? { [programId]: specSlug } : {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...(acked ? { acknowledgedRequirements: { [programId]: acked } } : {}),
  } as LocalPlan;
}

const audit = (programId: string, specSlug: string | null, acked?: string[]) =>
  buildProgramAudit(
    mkPlan(programId, specSlug, acked),
    programId,
    new Map<string, Course>(),
    [],
  );
const texts = (r: ReturnType<typeof buildProgramAudit>) =>
  r.unverifiedItems.map((i) => i.text);

describe("buildProgramAudit — specialization owed requirements (#123)", () => {
  it("(a) surfaces the selected spec's owed items under the program's dimension", () => {
    const r = audit("p-nototal", "spec-a");
    expect(texts(r)).toContain("REQ A");
    expect(texts(r)).toContain("FREE A"); // folded — parent has no totalUnits
    expect(r.unverifiedItems.every((i) => !i.acked)).toBe(true);
  });

  it("(b) marks a spec item acked when it's stored on the plan", () => {
    const r = audit("p-nototal", "spec-a", ["REQ A"]);
    expect(r.unverifiedItems.find((i) => i.text === "REQ A")?.acked).toBe(true);
    expect(r.staleAcknowledgements).not.toContain("REQ A");
  });

  it("(c) switching specs drops the prior spec's items without flagging its ack stale", () => {
    // spec-b selected, but REQ A (spec-a's) was previously acknowledged.
    const r = audit("p-nototal", "spec-b", ["REQ A"]);
    expect(texts(r)).toContain("REQ B");
    expect(texts(r)).not.toContain("REQ A"); // spec-a not selected → not shown
    // REQ A still belongs to a known spec of this program, so it is NOT stale.
    expect(r.staleAcknowledgements).not.toContain("REQ A");
  });

  it("(c') same holds when no spec is selected", () => {
    const r = audit("p-nototal", null, ["REQ A"]);
    expect(texts(r)).not.toContain("REQ A");
    expect(r.staleAcknowledgements).not.toContain("REQ A");
  });

  it("(d) folds a spec's free electives only when the program has no totalUnits", () => {
    expect(texts(audit("p-nototal", "spec-a"))).toContain("FREE A");
    const withTotal = texts(audit("p-total", "spec-a"));
    expect(withTotal).toContain("REQ A"); // unverified always surfaces
    expect(withTotal).not.toContain("FREE A"); // redundant with the free remainder
  });
});
