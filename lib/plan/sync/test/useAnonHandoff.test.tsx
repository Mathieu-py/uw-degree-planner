// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "../../types";

const { listPlansMock } = vi.hoisted(() => ({
  listPlansMock: vi.fn(),
}));
vi.mock("../../server/actions", () => ({
  listPlans: listPlansMock,
}));

const { loadPlanMock, clearPlanMock } = vi.hoisted(() => ({
  loadPlanMock: vi.fn(),
  clearPlanMock: vi.fn(),
}));
vi.mock("../../storage", () => ({
  loadPlan: loadPlanMock,
  clearPlan: clearPlanMock,
}));

import { useAnonHandoff } from "../useAnonHandoff";

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: "h-cs",
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

interface HookArgs {
  isAuthed: boolean;
  createPlanWithSeed: (
    name: string,
    snapshot: unknown,
  ) => Promise<string | null>;
  onImported: (newPlanId: string) => void;
}

function mount(initial: HookArgs) {
  return renderHook((args: HookArgs) => useAnonHandoff(args), {
    initialProps: initial,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("useAnonHandoff — silent import (zero server plans)", () => {
  it("calls createPlanWithSeed, clears local, and notifies caller", async () => {
    const local = mkPlan();
    loadPlanMock.mockReturnValue(local);
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn().mockResolvedValue("new-id");
    const onImported = vi.fn();

    const { result } = mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });

    await waitFor(() => expect(onImported).toHaveBeenCalledWith("new-id"));
    expect(create).toHaveBeenCalledWith(
      "Imported plan",
      expect.objectContaining({ programId: "h-cs" }),
    );
    expect(clearPlanMock).toHaveBeenCalled();
    expect(result.current.conflict).toBeNull();
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBe("1");
  });

  it("does nothing when there is no local plan", async () => {
    loadPlanMock.mockReturnValue(null);
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn();
    const onImported = vi.fn();

    mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });

    // Give any pending microtasks a chance to flush.
    await act(async () => {
      await Promise.resolve();
    });

    expect(create).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    // No local plan to import → skip the wasted listPlans round trip.
    expect(listPlansMock).not.toHaveBeenCalled();
  });

  it("does nothing while isAuthed is false (anon mount)", async () => {
    loadPlanMock.mockReturnValue(mkPlan());
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn();
    const onImported = vi.fn();

    mount({
      isAuthed: false,
      createPlanWithSeed: create,
      onImported,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(create).not.toHaveBeenCalled();
    expect(listPlansMock).not.toHaveBeenCalled();
  });
});

describe("useAnonHandoff — conflict (≥1 server plan)", () => {
  it("exposes the local plan via the conflict state without auto-importing", async () => {
    const local = mkPlan({ programId: "h-se" });
    loadPlanMock.mockReturnValue(local);
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "existing",
          name: "existing",
          programId: null,
          specializationId: null,
          stream: null,
          startTermId: null,
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
    const create = vi.fn();
    const onImported = vi.fn();

    const { result } = mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });

    await waitFor(() =>
      expect(result.current.conflict?.localPlan).toEqual(local),
    );
    expect(create).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    // No flag yet — user hasn't decided.
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBeNull();
  });
});

describe("useAnonHandoff — resolveConflict", () => {
  async function arrangeConflict() {
    const local = mkPlan();
    loadPlanMock.mockReturnValue(local);
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "p1",
          name: "p1",
          programId: null,
          specializationId: null,
          stream: null,
          startTermId: null,
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
    const create = vi.fn().mockResolvedValue("imported-id");
    const onImported = vi.fn();
    const { result } = mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    return { result, create, onImported };
  }

  it("import: creates, clears, notifies, sets the guard", async () => {
    const { result, create, onImported } = await arrangeConflict();
    await act(async () => {
      await result.current.resolveConflict("import");
    });

    expect(create).toHaveBeenCalledOnce();
    expect(clearPlanMock).toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledWith("imported-id");
    expect(result.current.conflict).toBeNull();
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBe("1");
  });

  it("discard: clears local, sets guard, never calls create", async () => {
    const { result, create, onImported } = await arrangeConflict();
    await act(async () => {
      await result.current.resolveConflict("discard");
    });

    expect(create).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(clearPlanMock).toHaveBeenCalled();
    expect(result.current.conflict).toBeNull();
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBe("1");
  });

  it("cancel: closes the modal without setting the guard", async () => {
    const { result, create, onImported } = await arrangeConflict();
    await act(async () => {
      await result.current.resolveConflict("cancel");
    });

    expect(create).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(clearPlanMock).not.toHaveBeenCalled();
    expect(result.current.conflict).toBeNull();
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBeNull();
  });
});

describe("useAnonHandoff — double-fire guards", () => {
  it("only runs once per mount even when isAuthed remains true across re-renders", async () => {
    loadPlanMock.mockReturnValue(mkPlan());
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn().mockResolvedValue("id");
    const onImported = vi.fn();

    const { rerender } = mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());

    // Re-render with the same isAuthed value — handoff must not re-run.
    rerender({ isAuthed: true, createPlanWithSeed: create, onImported });
    rerender({ isAuthed: true, createPlanWithSeed: create, onImported });

    expect(create).toHaveBeenCalledOnce();
  });

  it("respects the sessionStorage flag across remounts", async () => {
    window.sessionStorage.setItem("uwfinder.handoff.done", "1");
    loadPlanMock.mockReturnValue(mkPlan());
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn().mockResolvedValue("id");

    mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(create).not.toHaveBeenCalled();
    expect(listPlansMock).not.toHaveBeenCalled();
  });

  it("re-runs the handoff after a sign-out + sign-in cycle", async () => {
    // Regression: previously the sessionStorage flag set by the first
    // import survived sign-out, so the user's next sign-in (in the same
    // tab) silently aborted the handoff even when they'd built a fresh
    // local plan. Sign-out must now clear that flag.
    loadPlanMock.mockReturnValue(mkPlan());
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    const create = vi.fn().mockResolvedValue("id-1");
    const onImported = vi.fn();

    const { rerender } = mount({
      isAuthed: true,
      createPlanWithSeed: create,
      onImported,
    });
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBe("1");

    // Sign-out must clear the flag.
    rerender({ isAuthed: false, createPlanWithSeed: create, onImported });
    expect(window.sessionStorage.getItem("uwfinder.handoff.done")).toBeNull();

    // Second sign-in fires a fresh handoff against a newly-built local plan.
    create.mockResolvedValueOnce("id-2");
    rerender({ isAuthed: true, createPlanWithSeed: create, onImported });

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });
});
