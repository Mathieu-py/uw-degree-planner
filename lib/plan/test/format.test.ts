import { describe, expect, it } from "vitest";
import { planSubtitle, streamLabel } from "../format";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../types";

function makePlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: ["h-cs"],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("streamLabel", () => {
  it("labels each stream", () => {
    expect(streamLabel("regular")).toBe("Regular (no co-op)");
    expect(streamLabel("stream4")).toBe("Stream 4 co-op");
    expect(streamLabel("stream8")).toBe("Stream 8 co-op");
  });
});

describe("planSubtitle", () => {
  it("joins stream, start term, and slot count", () => {
    expect(planSubtitle(makePlan({ stream: "stream8" }))).toBe(
      "Stream 8 co-op · Fall 2023 · 0 slots",
    );
  });

  it("falls back when there is no start term", () => {
    expect(planSubtitle(makePlan({ startTermId: null }))).toBe(
      "Regular (no co-op) · no start term · 0 slots",
    );
  });
});
