// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
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
    programId: "h-cs",
    specializationId: null,
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

const SERVER_PLAN = {
  id: "p1",
  name: "My plan",
  programId: "h-cs",
  specializationId: null,
  stream: "regular" as const,
  startTermId: 1239,
  programScrapeVersion: null,
  updatedAt: "2026-05-24T00:00:00.000Z",
  slots: [
    {
      id: "s1",
      termId: 1239,
      position: "1A" as const,
      isCoop: false,
      courses: [{ code: "cs115" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  savePlanMock.mockReturnValue(true);
});

describe("usePlanSync — signed-out (local) path", () => {
  it("loads the local plan synchronously and reports source 'local'", () => {
    const local = mkPlan();
    loadPlanMock.mockReturnValue(local);

    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: false, planId: null }),
    );

    expect(result.current.plan).toEqual(local);
    expect(result.current.source).toBe("local");
    expect(result.current.hydrated).toBe(true);
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });

  it("setPlan writes through to localStorage and never touches the server", () => {
    loadPlanMock.mockReturnValue(null);
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: false, planId: null }),
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
      usePlanSync({ isAuthed: false, planId: null }),
    );

    act(() => result.current.clearLocalPlan());

    expect(clearPlanMock).toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
  });
});

describe("usePlanSync — signed-in, no planId", () => {
  it("hydrates as empty without calling the server", async () => {
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: null }),
    );

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.plan).toBeNull();
    expect(result.current.source).toBeNull();
    expect(loadServerPlanMock).not.toHaveBeenCalled();
    expect(loadPlanMock).not.toHaveBeenCalled();
  });

  it("setPlan is a no-op when there's no planId to save against", () => {
    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: null }),
    );

    act(() => result.current.setPlan(mkPlan()));

    expect(savePlanStateMock).not.toHaveBeenCalled();
    expect(savePlanMock).not.toHaveBeenCalled();
  });
});

describe("usePlanSync — signed-in, with planId (load)", () => {
  it("loads from the server and projects through serverPlanToLocal", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: true, data: SERVER_PLAN });

    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: "p1" }),
    );

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.plan).toEqual({
      schemaVersion: PLAN_SCHEMA_VERSION,
      programId: "h-cs",
      specializationId: null,
      stream: "regular",
      startTermId: 1239,
      slots: SERVER_PLAN.slots,
      updatedAt: "2026-05-24T00:00:00.000Z",
    });
    expect(result.current.source).toEqual({ kind: "server", planId: "p1" });
    expect(loadServerPlanMock).toHaveBeenCalledWith("p1");
  });

  it("plan is null when the server returns null (not-found / non-owned)", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: true, data: null });

    const { result } = renderHook(() =>
      usePlanSync({ isAuthed: true, planId: "missing" }),
    );

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.plan).toBeNull();
    expect(result.current.source).toEqual({
      kind: "server",
      planId: "missing",
    });
  });

  it("reloading is true with the stale plan still in state while a switch loads", async () => {
    // Initial load resolves immediately, then a switch holds resolution
    // until we let it go. The invariant under test: between the planId
    // change and the next resolution, `plan` still holds the previous
    // plan and `reloading` is true — that's what lets PlannerShell keep
    // the old content on screen instead of unmounting to a skeleton.
    loadServerPlanMock.mockResolvedValueOnce({ ok: true, data: SERVER_PLAN });
    let resolveSecond!: (v: unknown) => void;
    loadServerPlanMock.mockImplementationOnce(
      () => new Promise((res) => (resolveSecond = res)),
    );

    const { result, rerender } = renderHook(
      ({ planId }: { planId: string }) =>
        usePlanSync({ isAuthed: true, planId }),
      { initialProps: { planId: "p1" } },
    );

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.plan?.programId).toBe("h-cs");
    expect(result.current.reloading).toBe(false);

    rerender({ planId: "p2" });
    await waitFor(() => expect(result.current.reloading).toBe(true));
    // The previous plan is still in state — that's what keeps the UI
    // populated while p2 loads.
    expect(result.current.plan?.programId).toBe("h-cs");
    expect(result.current.hydrated).toBe(false);

    const second = { ...SERVER_PLAN, id: "p2", programId: "h-se" };
    await act(async () => {
      resolveSecond({ ok: true, data: second });
      await Promise.resolve();
    });
    expect(result.current.plan?.programId).toBe("h-se");
    expect(result.current.hydrated).toBe(true);
    expect(result.current.reloading).toBe(false);
  });

  it("rapid planId changes don't let a stale load clobber the new plan", async () => {
    let resolveFirst!: (v: unknown) => void;
    loadServerPlanMock.mockImplementationOnce(
      () => new Promise((res) => (resolveFirst = res)),
    );
    const second = { ...SERVER_PLAN, id: "p2", programId: "h-se" };
    loadServerPlanMock.mockResolvedValueOnce({ ok: true, data: second });

    const { result, rerender } = renderHook(
      ({ planId }: { planId: string }) =>
        usePlanSync({ isAuthed: true, planId }),
      { initialProps: { planId: "p1" } },
    );

    rerender({ planId: "p2" });
    await waitFor(() => expect(result.current.plan?.programId).toBe("h-se"));

    await act(async () => {
      resolveFirst({ ok: true, data: SERVER_PLAN });
      await Promise.resolve();
    });

    expect(result.current.plan?.programId).toBe("h-se");
    expect(result.current.source).toEqual({ kind: "server", planId: "p2" });
  });
});

describe("usePlanSync — debounce + save lifecycle (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadServerPlanMock.mockResolvedValue({ ok: true, data: SERVER_PLAN });
    savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(planId: string = "p1") {
    const hook = renderHook(() => usePlanSync({ isAuthed: true, planId }));
    // Resolve the initial loadServerPlan.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    return hook;
  }

  it("setPlan flips saveStatus to 'saving' immediately, defers the wire call by 1500ms", async () => {
    const { result } = await setup();

    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
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
    const { result } = await setup();

    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => result.current.setPlan(mkPlan({ specializationId: "se" })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => result.current.setPlan(mkPlan({ specializationId: "stats" })));
    // Advance the full window from the last setPlan.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });

    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(savePlanStateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ specializationId: "stats" }),
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

    const { result } = await setup();

    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    // First save is now in-flight (not yet resolved). Drop a new edit.
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);

    act(() => result.current.setPlan(mkPlan({ specializationId: "se" })));
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
      expect.objectContaining({ specializationId: "se" }),
    );
  });

  it("surfaces a save failure on saveStatus", async () => {
    savePlanStateMock.mockReset();
    savePlanStateMock.mockResolvedValue({ ok: false, error: "rls denied" });

    const { result } = await setup();

    act(() => result.current.setPlan(mkPlan()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toEqual({
      kind: "error",
      message: "rls denied",
    });
  });

  it("flushSave drains the queued save without waiting for the debounce window", async () => {
    const { result } = await setup();

    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
    expect(savePlanStateMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flushSave();
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(savePlanStateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ specializationId: "ai" }),
    );
  });

  it("switching planId mid-flight drains the pending save against the OLD planId", async () => {
    const { result, rerender } = renderHook(
      ({ planId }: { planId: string }) =>
        usePlanSync({ isAuthed: true, planId }),
      { initialProps: { planId: "p1" } },
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
    expect(savePlanStateMock).not.toHaveBeenCalled();

    // Switch to p2 — cleanup should drain the pending p1 save.
    rerender({ planId: "p2" });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // p1 received the save, not p2.
    expect(savePlanStateMock).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ specializationId: "ai" }),
    );
  });

  it("does not flash 'saved' on the new plan after the OLD plan's save settles (B2)", async () => {
    // Without token-protection in drain(), the OLD plan's in-flight save
    // resolves AFTER planId has changed and AFTER the new effect has reset
    // saveStatus to idle — and overwrites it to 'saved'. The "Saved" chip
    // would then render next to the new plan's name. Token-checking the
    // setSaveStatus calls inside drain prevents that cross-plan leak.
    let resolveFirstSave!: () => void;
    savePlanStateMock.mockReset();
    savePlanStateMock.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: undefined }>((res) => {
          resolveFirstSave = () => res({ ok: true, data: undefined });
        }),
    );
    savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });

    const { result, rerender } = renderHook(
      ({ planId }: { planId: string }) =>
        usePlanSync({ isAuthed: true, planId }),
      { initialProps: { planId: "p1" } },
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Edit on p1 → debounced save → in-flight (resolveFirstSave still held).
    act(() => result.current.setPlan(mkPlan({ specializationId: "ai" })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(savePlanStateMock).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus.kind).toBe("saving");

    // Switch planId mid-flight. Cleanup drain awaits the p1 save; the new
    // effect resets saveStatus to idle and bumps loadTokenRef.
    rerender({ planId: "p2" });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.saveStatus).toEqual({ kind: "idle" });

    // Settle the p1 save AFTER the planId change. Without B2, drain calls
    // setSaveStatus({saved}) here and the UI flashes "Saved" next to p2.
    await act(async () => {
      resolveFirstSave();
      await vi.runAllTimersAsync();
    });
    expect(result.current.saveStatus.kind).not.toBe("saved");
  });

  it("auto-decays 'saved' back to 'idle' after 3000ms", async () => {
    const { result } = await setup();

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
