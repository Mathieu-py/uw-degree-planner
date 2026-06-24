// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { usePlanEditors } from "../usePlanEditors";

const PROGRAM = "h-cs";
const REQ = "Complete 1 approved elective";

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: [PROGRAM],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build the full `UsePlanEditorsArgs` with inert mocks; only `plan` + `setPlan`
 * matter for the acknowledge handler (it reads the plan off a ref and routes its
 * one write through `setPlan`). Everything else is a no-op stub so the hook
 * renders without exercising the other edit paths.
 */
function mkArgs(plan: LocalPlan | null, setPlan: (next: LocalPlan) => void) {
  return {
    plan,
    picker: null,
    planId: null,
    isAuthed: false,
    setPlan,
    clearLocalPlan: vi.fn(),
    flushSave: vi.fn(async () => {}),
    create: vi.fn(async () => null),
    router: { replace: vi.fn() },
    setPicker: vi.fn(),
    setTranscriptOpen: vi.fn(),
    setImportBanner: vi.fn(),
  };
}

function renderEditors(
  plan: LocalPlan | null,
  setPlan: (next: LocalPlan) => void,
) {
  return renderHook(() => usePlanEditors(mkArgs(plan, setPlan)));
}

describe("usePlanEditors — handleAcknowledgeRequirement", () => {
  it("acked=true adds an absent text and writes once", () => {
    const setPlan = vi.fn();
    const { result } = renderEditors(mkPlan(), setPlan);

    result.current.handleAcknowledgeRequirement(PROGRAM, REQ, true);

    expect(setPlan).toHaveBeenCalledTimes(1);
    expect(setPlan.mock.calls[0][0].acknowledgedRequirements).toEqual({
      [PROGRAM]: [REQ],
    });
  });

  it("acked=true is a no-op when the text is already present", () => {
    const setPlan = vi.fn();
    const { result } = renderEditors(
      mkPlan({ acknowledgedRequirements: { [PROGRAM]: [REQ] } }),
      setPlan,
    );

    result.current.handleAcknowledgeRequirement(PROGRAM, REQ, true);

    expect(setPlan).not.toHaveBeenCalled();
  });

  it("acked=false removes a present text and writes once", () => {
    const setPlan = vi.fn();
    const other = "Complete 3 approved electives";
    const { result } = renderEditors(
      mkPlan({ acknowledgedRequirements: { [PROGRAM]: [REQ, other] } }),
      setPlan,
    );

    result.current.handleAcknowledgeRequirement(PROGRAM, REQ, false);

    expect(setPlan).toHaveBeenCalledTimes(1);
    expect(setPlan.mock.calls[0][0].acknowledgedRequirements).toEqual({
      [PROGRAM]: [other],
    });
  });

  it("acked=false is a no-op when the text was never acknowledged (Fix 1)", () => {
    const setPlan = vi.fn();
    const { result } = renderEditors(
      mkPlan({ acknowledgedRequirements: { [PROGRAM]: [REQ] } }),
      setPlan,
    );

    result.current.handleAcknowledgeRequirement(
      PROGRAM,
      "Some other req",
      false,
    );

    expect(setPlan).not.toHaveBeenCalled();
  });

  it("acked=false on an empty/absent map is a no-op (Fix 1)", () => {
    const setPlan = vi.fn();
    const { result } = renderEditors(mkPlan(), setPlan);

    result.current.handleAcknowledgeRequirement(PROGRAM, REQ, false);

    expect(setPlan).not.toHaveBeenCalled();
  });

  it("acked=false removing the last text deletes the programId key", () => {
    const setPlan = vi.fn();
    const { result } = renderEditors(
      mkPlan({ acknowledgedRequirements: { [PROGRAM]: [REQ] } }),
      setPlan,
    );

    result.current.handleAcknowledgeRequirement(PROGRAM, REQ, false);

    expect(setPlan).toHaveBeenCalledTimes(1);
    const nextMap = setPlan.mock.calls[0][0].acknowledgedRequirements;
    expect(nextMap).toEqual({});
    expect(PROGRAM in nextMap).toBe(false);
  });
});
