// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../../types";

const { loadServerPlanMock, savePlanStateMock } = vi.hoisted(() => ({
  loadServerPlanMock: vi.fn(),
  savePlanStateMock: vi.fn(),
}));
vi.mock("../../server/actions", () => ({
  loadServerPlan: loadServerPlanMock,
  savePlanState: savePlanStateMock,
}));

const { loadPlanMock, savePlanMock, clearPlanMock } = vi.hoisted(() => ({
  loadPlanMock: vi.fn(),
  savePlanMock: vi.fn(),
  clearPlanMock: vi.fn(),
}));
vi.mock("../../storage", () => ({
  loadPlan: loadPlanMock,
  savePlan: savePlanMock,
  clearPlan: clearPlanMock,
}));

import { usePlanSync } from "../usePlanSync";

const SAVE_DEBOUNCE_MS = 1500;

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: ["h-cs"],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: [{ code: "cs115" }],
      },
    ],
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  savePlanMock.mockReturnValue(true);
});

describe("usePlanSync — signed-out (local) path", () => {
  it("loads the local plan from localStorage, never touching the server", () => {
    const local = mkPlan();
    loadPlanMock.mockReturnValue(local);

    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: false, planId: null, initialPlan: null }),
    );

    expect(result.current.plan).toEqual(local);
    expect(result.current.hydrated).toBe(true);
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });

  it("setPlan writes through to localStorage and never touches the server", () => {
    loadPlanMock.mockReturnValue(null);
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: false, planId: null, initialPlan: null }),
    );

    const next = mkPlan({ updatedAt: "2026-05-25T00:00:00.000Z" });
    act(() => result.current.setPlan(next));

    expect(savePlanMock).toHaveBeenCalledWith(next);
    expect(savePlanStateMock).not.toHaveBeenCalled();
    expect(result.current.plan).toEqual(next);
    expect(result.current.saveStatus).toEqual({ kind: "idle" });
  });

  it("clearLocalPlan calls storage.clear and nulls the in-memory plan", () => {
    loadPlanMock.mockReturnValue(mkPlan());
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: false, planId: null, initialPlan: null }),
    );

    act(() => result.current.clearLocalPlan());

    expect(clearPlanMock).toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
  });
});

describe("usePlanSync — signed-in, no planId", () => {
  it("hydrates as empty without reading local storage or the server", () => {
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: null, initialPlan: null }),
    );

    expect(result.current.hydrated).toBe(true);
    expect(result.current.plan).toBeNull();
    expect(loadServerPlanMock).not.toHaveBeenCalled();
    expect(loadPlanMock).not.toHaveBeenCalled();
  });

  it("setPlan is a no-op when there's no planId to save against", () => {
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: null, initialPlan: null }),
    );

    act(() => result.current.setPlan(mkPlan()));

    expect(savePlanStateMock).not.toHaveBeenCalled();
    expect(savePlanMock).not.toHaveBeenCalled();
  });
});

describe("usePlanSync — signed-in, seeded from initialPlan", () => {
  it("shows the server-provided plan on the first render, no client fetch", () => {
    const initialPlan = mkPlan({ programIds: ["h-se"] });
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: "p1", initialPlan }),
    );

    expect(result.current.plan).toEqual(initialPlan);
    expect(result.current.hydrated).toBe(true);
    expect(loadServerPlanMock).not.toHaveBeenCalled();
    expect(loadPlanMock).not.toHaveBeenCalled();
  });

  it("a null initialPlan (missing / failed on the server) yields a null plan", () => {
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: "missing", initialPlan: null }),
    );

    expect(result.current.plan).toBeNull();
    expect(result.current.hydrated).toBe(true);
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });
});

describe("usePlanSync — debounce + save lifecycle (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(planId = "p1") {
    return renderHook(() =>
      usePlanSync({ isAuthed: true, planId, initialPlan: mkPlan() }),
    );
  }

  it("setPlan flips saveStatus to 'saving' immediately, defers the wire call by 1500ms", async () => {
    const { result } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    expect(result.current.saveStatus).toEqual({ kind: "saving" });
    expect(savePlanStateMock).not.toHaveBeenCalled();

    // Just under the threshold — still nothing on the wire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    });
    expect(savePlanStateMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus.kind).toBe("saved");
  });

  it("coalesces rapid edits inside the debounce window into a single save with the latest snapshot", async () => {
    const { result } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "se" } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() =>
      result.current.setPlan(
        mkPlan({ specializationIds: { "h-cs": "stats" } }),
      ),
    );
    // Advance the full window from the last setPlan.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });

    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(savePlanStateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ specializationIds: { "h-cs": "stats" } }),
    );
  });

  it("a new edit during an in-flight save fires a second save immediately after settle", async () => {
    let resolveSave!: () => void;
    savePlanStateMock.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: undefined }>((res) => {
          resolveSave = () => res({ ok: true, data: undefined });
        }),
    );
    savePlanStateMock.mockResolvedValueOnce({ ok: true, data: undefined });

    const { result } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    // First save is now in-flight (not yet resolved). Drop a new edit.
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "se" } })),
    );
    // No new timer should have been queued — second save waits on in-flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);

    // Settle the first save; the second should fire with no extra wait.
    await act(async () => {
      resolveSave();
      await vi.runAllTimersAsync();
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(2);
    expect(savePlanStateMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ specializationIds: { "h-cs": "se" } }),
    );
  });

  it("surfaces a save failure on saveStatus", async () => {
    savePlanStateMock.mockReset();
    savePlanStateMock.mockResolvedValue({ ok: false, error: "rls denied" });

    const { result } = setup();

    act(() => result.current.setPlan(mkPlan()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toEqual({
      kind: "error",
      message: "rls denied",
    });
  });

  it("re-sends the failed snapshot when the retry (flushSave) fires", async () => {
    savePlanStateMock.mockReset();
    savePlanStateMock
      .mockResolvedValueOnce({ ok: false, error: "rls denied" })
      .mockResolvedValueOnce({ ok: true, data: undefined });

    const { result } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(result.current.saveStatus.kind).toBe("error");

    // SaveStatusBadge → handleRetrySave → flushSave must re-attempt the same
    // snapshot, not no-op against an emptied queue.
    await act(async () => {
      await result.current.flushSave();
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(2);
    expect(savePlanStateMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ specializationIds: { "h-cs": "ai" } }),
    );
    expect(result.current.saveStatus.kind).toBe("saved");
  });

  it("flushSave drains the queued save without waiting for the debounce window", async () => {
    const { result } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    expect(savePlanStateMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flushSave();
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(savePlanStateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ specializationIds: { "h-cs": "ai" } }),
    );
  });

  it("drains the pending save on unmount (a plan switch is a keyed remount)", async () => {
    const { result, unmount } = setup();

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    expect(savePlanStateMock).not.toHaveBeenCalled();

    // Switching plans remounts the shell (keyed by planId upstream); the cleanup
    // drain flushes the pending save against the plan it was queued for.
    await act(async () => {
      unmount();
      await vi.runAllTimersAsync();
    });

    expect(savePlanStateMock).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ specializationIds: { "h-cs": "ai" } }),
    );
  });

  it("does not flash 'saved' after a sign-out settles a pending save (epoch guard)", async () => {
    // Sign-out flips isAuthed under the same instance (not a remount): the seed
    // effect bumps the epoch and resets the badge, and drain must suppress the
    // late 'saved' write from the pre-sign-out save.
    let resolveSave!: () => void;
    savePlanStateMock.mockReset();
    savePlanStateMock.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: undefined }>((res) => {
          resolveSave = () => res({ ok: true, data: undefined });
        }),
    );
    savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });

    const { result, rerender } = renderHook(
      ({ isAuthed }: { isAuthed: boolean }) =>
        usePlanSync({ isAuthed, planId: "p1", initialPlan: mkPlan() }),
      { initialProps: { isAuthed: true } },
    );

    act(() =>
      result.current.setPlan(mkPlan({ specializationIds: { "h-cs": "ai" } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus.kind).toBe("saving");

    // Sign out mid-flight → seed effect resets the badge to idle.
    loadPlanMock.mockReturnValue(null);
    rerender({ isAuthed: false });
    expect(result.current.saveStatus).toEqual({ kind: "idle" });

    // Settle the pre-sign-out save; its 'saved' write is epoch-suppressed.
    await act(async () => {
      resolveSave();
      await vi.runAllTimersAsync();
    });
    expect(result.current.saveStatus.kind).not.toBe("saved");
  });

  it("auto-decays 'saved' back to 'idle' after 3000ms", async () => {
    const { result } = setup();

    act(() => result.current.setPlan(mkPlan()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(result.current.saveStatus.kind).toBe("saved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.saveStatus).toEqual({ kind: "idle" });
  });
});
