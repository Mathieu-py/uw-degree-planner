import { describe, expect, it } from "vitest";
import type { PlanSlot } from "@/lib/plan/types";
import { parsePrereqs } from "@/lib/prereqs/parse";
import { makeTermId } from "@/lib/terms";
import { alreadyInLabel, computeTermOptions } from "../termOptions";

const FALL_2025 = makeTermId(2025, "Fall"); // → "Fall 2025"
const WINTER_2025 = makeTermId(2025, "Winter"); // → "Winter 2025"

function slot(
  over: Partial<PlanSlot> & Pick<PlanSlot, "id" | "position">,
): PlanSlot {
  return { termId: null, isCoop: false, courses: [], ...over };
}

describe("computeTermOptions", () => {
  it("yields one option per academic term, excluding pre and co-op slots", () => {
    const slots = [
      slot({ id: "p", position: "pre" }),
      slot({ id: "a", position: "1A", termId: FALL_2025 }),
      slot({ id: "w", position: "coop1", termId: WINTER_2025, isCoop: true }),
      slot({ id: "b", position: "1B", termId: WINTER_2025 }),
    ];
    const options = computeTermOptions(slots, null);
    expect(options.map((o) => o.slot.id)).toEqual(["a", "b"]);
    expect(options.map((o) => o.label)).toEqual(["Fall 2025", "Winter 2025"]);
  });

  it("marks every term eligible when the course has no prereqs", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const options = computeTermOptions(slots, parsePrereqs(null));
    expect(options[0].state).toBe("eligible");
  });

  it("marks a term missing when a required course is absent", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const options = computeTermOptions(slots, parsePrereqs("MATH116"));
    expect(options[0].state).toBe("missing");
    expect(options[0].hint).toMatch(/Needs/);
  });

  it("turns missing into eligible once the prereq sits in an earlier term", () => {
    // Winter 2025 sorts before Fall 2025 by term id, so `early` is the
    // genuinely earlier term and `late` the later one.
    const slots = [
      slot({
        id: "early",
        position: "1A",
        termId: WINTER_2025,
        courses: [{ code: "math116" }],
      }),
      slot({ id: "late", position: "1B", termId: FALL_2025 }),
    ];
    const options = computeTermOptions(slots, parsePrereqs("MATH116"));
    const byId = Object.fromEntries(options.map((o) => [o.slot.id, o.state]));
    // The prereq is taken in the early term, so it isn't yet "completed
    // before" that term...
    expect(byId.early).toBe("missing");
    // ...but it is completed before the later term.
    expect(byId.late).toBe("eligible");
  });

  it("flags unparseable prerequisites as a manual check", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const options = computeTermOptions(
      slots,
      parsePrereqs("Honours Mathematics students only"),
    );
    expect(options[0].state).toBe("check");
  });
});

describe("alreadyInLabel", () => {
  it("returns the term label when the course is placed in a dated slot", () => {
    const slots = [
      slot({
        id: "a",
        position: "1A",
        termId: FALL_2025,
        courses: [{ code: "cs246" }],
      }),
    ];
    expect(alreadyInLabel(slots, "cs246")).toBe("Fall 2025");
  });

  it("returns 'your plan' for a course placed in an undated (pre) slot", () => {
    const slots = [
      slot({ id: "p", position: "pre", courses: [{ code: "cs246" }] }),
    ];
    expect(alreadyInLabel(slots, "cs246")).toBe("your plan");
  });

  it("returns null when the course is not placed anywhere", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    expect(alreadyInLabel(slots, "cs246")).toBeNull();
  });
});
