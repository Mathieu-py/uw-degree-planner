// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the server-only actions so the hook loads under jsdom and we control the reject.
vi.mock("@/lib/onboarding/server/actions", () => ({
  fetchVariantGroups: vi.fn(async () => []),
  placeVariantSelections: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { logError } from "@/lib/log";
import {
  fetchVariantGroups,
  placeVariantSelections,
} from "@/lib/onboarding/server/actions";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { useVariantPicker } from "../useVariantPicker";

// Stable ref — an inline literal re-fires the reset effect each render, wiping selections.
const PROGRAM_IDS = ["p"];

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: PROGRAM_IDS,
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    acknowledgedRequirements: {},
    updatedAt: "",
    ...overrides,
  };
}

describe("useVariantPicker.applyTo", () => {
  beforeEach(() => {
    vi.mocked(fetchVariantGroups).mockReset().mockResolvedValue([]);
    vi.mocked(placeVariantSelections).mockReset();
    vi.mocked(logError).mockReset();
  });

  it("returns the original plan unchanged when placement rejects", async () => {
    // A placement failure must not block onboarding — swallow it, return plan as-is.
    vi.mocked(placeVariantSelections).mockRejectedValue(new Error("rpc down"));

    const { result } = renderHook(() =>
      useVariantPicker({
        programIds: PROGRAM_IDS,
        stream: "regular",
        enabled: true,
      }),
    );
    // Flush the mount effect's fetch before driving applyTo.
    await act(async () => {});

    // Register a selection so applyTo actually invokes the server action.
    act(() => {
      result.current.onChange("k1", ["cs135"]);
    });

    const plan = mkPlan();
    let out: LocalPlan | undefined;
    await act(async () => {
      out = await result.current.applyTo(plan);
    });

    expect(placeVariantSelections).toHaveBeenCalledTimes(1);
    expect(out).toBe(plan); // same reference — no placement applied
    expect(logError).toHaveBeenCalled(); // rejection was logged, not thrown
  });
});
