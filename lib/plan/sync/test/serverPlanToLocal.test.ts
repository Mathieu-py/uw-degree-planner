import { describe, expect, it } from "vitest";
import { toSnapshot } from "../../server/serialize";
import type { ServerPlan } from "../../server/types";
import { PLAN_SCHEMA_VERSION } from "../../types";
import { serverPlanToLocal } from "../serverPlanToLocal";

const SERVER_PLAN: ServerPlan = {
  id: "plan-1",
  name: "My plan",
  programId: "h-cs",
  specializationId: "ai",
  stream: "stream8",
  startTermId: 1239,
  programScrapeVersion: "2026-05-01",
  updatedAt: "2026-05-24T12:00:00.000Z",
  slots: [
    {
      id: "s1",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "cs115", grade: "87" }],
    },
  ],
};

describe("serverPlanToLocal", () => {
  it("drops id, name, programScrapeVersion and stamps schemaVersion", () => {
    const local = serverPlanToLocal(SERVER_PLAN);
    expect(local).toEqual({
      schemaVersion: PLAN_SCHEMA_VERSION,
      programId: "h-cs",
      specializationId: "ai",
      stream: "stream8",
      startTermId: 1239,
      slots: SERVER_PLAN.slots,
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
    expect("id" in local).toBe(false);
    expect("name" in local).toBe(false);
    expect("programScrapeVersion" in local).toBe(false);
  });

  it("defaults a null server stream to 'regular'", () => {
    const local = serverPlanToLocal({ ...SERVER_PLAN, stream: null });
    expect(local.stream).toBe("regular");
  });

  it("preserves a null startTermId", () => {
    const local = serverPlanToLocal({ ...SERVER_PLAN, startTermId: null });
    expect(local.startTermId).toBeNull();
  });

  it("round-trips through toSnapshot without losing slot data", () => {
    const local = serverPlanToLocal(SERVER_PLAN);
    const snap = toSnapshot(local);
    expect(snap.slots).toEqual(SERVER_PLAN.slots);
    expect(snap.programId).toBe(SERVER_PLAN.programId);
    expect(snap.specializationId).toBe(SERVER_PLAN.specializationId);
    expect(snap.stream).toBe(SERVER_PLAN.stream);
    expect(snap.startTermId).toBe(SERVER_PLAN.startTermId);
  });
});
