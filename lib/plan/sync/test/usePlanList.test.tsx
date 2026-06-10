// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSummary } from "../../server/types";

const {
  listPlansMock,
  createPlanMock,
  renamePlanMock,
  deletePlanMock,
  duplicatePlanMock,
} = vi.hoisted(() => ({
  listPlansMock: vi.fn(),
  createPlanMock: vi.fn(),
  renamePlanMock: vi.fn(),
  deletePlanMock: vi.fn(),
  duplicatePlanMock: vi.fn(),
}));

vi.mock("../../server/actions", () => ({
  listPlans: listPlansMock,
  createPlan: createPlanMock,
  renamePlan: renamePlanMock,
  deletePlan: deletePlanMock,
  duplicatePlan: duplicatePlanMock,
}));

import { __resetPlanListStoreForTests, usePlanList } from "../usePlanList";

function mkSummary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "p1",
    name: "Plan one",
    programId: "h-cs",
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    shareToken: null,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPlanListStoreForTests();
});

describe("usePlanList — initial fetch", () => {
  it("loads the plan list on mount when authed", async () => {
    const rows = [mkSummary({ id: "a" }), mkSummary({ id: "b" })];
    listPlansMock.mockResolvedValue({ ok: true, data: rows });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toEqual(rows));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when not authed and exposes plans as null", () => {
    const { result } = renderHook(() => usePlanList({ isAuthed: false }));
    expect(listPlansMock).not.toHaveBeenCalled();
    expect(result.current.plans).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("surfaces a list error and clears plans to an empty array", async () => {
    listPlansMock.mockResolvedValue({ ok: false, error: "list failed" });
    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.error).toBe("list failed"));
    expect(result.current.plans).toEqual([]);
  });
});

describe("usePlanList — create", () => {
  it("optimistically prepends a summary after a successful create", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "a" })],
    });
    createPlanMock.mockResolvedValue({ ok: true, data: { id: "new" } });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.create("Fresh");
    });

    expect(newId).toBe("new");
    expect(result.current.plans).toHaveLength(2);
    expect(result.current.plans?.[0]?.id).toBe("new");
    expect(result.current.plans?.[0]?.name).toBe("Fresh");
  });

  it("returns null and surfaces error when create fails", async () => {
    listPlansMock.mockResolvedValue({ ok: true, data: [] });
    createPlanMock.mockResolvedValue({ ok: false, error: "name_required" });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toEqual([]));

    let newId: string | null = "untouched";
    await act(async () => {
      newId = await result.current.create("");
    });

    expect(newId).toBeNull();
    expect(result.current.plans).toEqual([]);
    expect(result.current.error).toBe("name_required");
  });
});

describe("usePlanList — rename", () => {
  it("updates the row name optimistically and confirms on success", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "a", name: "Old" })],
    });
    renamePlanMock.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans?.[0]?.name).toBe("Old"));

    await act(async () => {
      await result.current.rename("a", "New name");
    });

    expect(result.current.plans?.[0]?.name).toBe("New name");
    expect(renamePlanMock).toHaveBeenCalledWith("a", "New name");
  });

  it("reverts the row name when the server rejects", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "a", name: "Old" })],
    });
    renamePlanMock.mockResolvedValue({
      ok: false,
      error: "not_found_or_unauthorized",
    });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans?.[0]?.name).toBe("Old"));

    let ok: boolean = true;
    await act(async () => {
      ok = await result.current.rename("a", "Attempted");
    });

    expect(ok).toBe(false);
    expect(result.current.plans?.[0]?.name).toBe("Old");
    expect(result.current.error).toBe("not_found_or_unauthorized");
  });

  it("short-circuits on whitespace-only name without calling the server", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "a", name: "Old" })],
    });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans?.[0]?.name).toBe("Old"));

    let ok: boolean = true;
    await act(async () => {
      ok = await result.current.rename("a", "   ");
    });

    expect(ok).toBe(false);
    expect(renamePlanMock).not.toHaveBeenCalled();
    expect(result.current.plans?.[0]?.name).toBe("Old");
  });
});

describe("usePlanList — remove", () => {
  it("removes the row optimistically and confirms on success", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "a" }), mkSummary({ id: "b" })],
    });
    deletePlanMock.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    expect(result.current.plans?.map((p) => p.id)).toEqual(["b"]);
  });

  it("restores the row at its original index on failure", async () => {
    const rows = [
      mkSummary({ id: "a" }),
      mkSummary({ id: "b" }),
      mkSummary({ id: "c" }),
    ];
    listPlansMock.mockResolvedValue({ ok: true, data: rows });
    deletePlanMock.mockResolvedValue({
      ok: false,
      error: "not_found_or_unauthorized",
    });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(3));

    let ok: boolean = true;
    await act(async () => {
      ok = await result.current.remove("b");
    });

    expect(ok).toBe(false);
    expect(result.current.plans?.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(result.current.error).toBe("not_found_or_unauthorized");
  });
});

describe("usePlanList — duplicate", () => {
  it("prepends a `(copy)`-suffixed summary mirroring the source on success", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [
        mkSummary({
          id: "src",
          name: "Original",
          programId: "h-cs",
          specializationId: "ai",
          stream: "stream8",
          startTermId: 1239,
        }),
      ],
    });
    duplicatePlanMock.mockResolvedValue({ ok: true, data: { id: "copy-1" } });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.duplicate("src");
    });

    expect(newId).toBe("copy-1");
    // Name override flows server-side so the optimistic + server names match.
    expect(duplicatePlanMock).toHaveBeenCalledWith("src", "Original (copy)");
    expect(result.current.plans).toHaveLength(2);
    expect(result.current.plans?.[0]).toEqual(
      expect.objectContaining({
        id: "copy-1",
        name: "Original (copy)",
        programId: "h-cs",
        specializationId: "ai",
        stream: "stream8",
        startTermId: 1239,
      }),
    );
  });

  it("returns null and surfaces error when the server rejects", async () => {
    listPlansMock.mockResolvedValue({
      ok: true,
      data: [mkSummary({ id: "src" })],
    });
    duplicatePlanMock.mockResolvedValue({ ok: false, error: "not_found" });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let newId: string | null = "untouched";
    await act(async () => {
      newId = await result.current.duplicate("src");
    });

    expect(newId).toBeNull();
    expect(result.current.plans).toHaveLength(1);
    expect(result.current.error).toBe("not_found");
  });

  it("falls back to refetch when the source isn't in the cache", async () => {
    // Empty cache: simulates duplicate called before the list landed (or for
    // an id that's not in this client's view).
    listPlansMock.mockResolvedValueOnce({ ok: true, data: [] });
    duplicatePlanMock.mockResolvedValue({
      ok: true,
      data: { id: "copy-1" },
    });
    // After the refetch the row appears.
    listPlansMock.mockResolvedValueOnce({
      ok: true,
      data: [mkSummary({ id: "copy-1", name: "Original (copy)" })],
    });

    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toEqual([]));

    await act(async () => {
      await result.current.duplicate("missing");
    });

    // No nameOverride when the source name isn't known — the server falls
    // back to its own "(copy)" suffix.
    expect(duplicatePlanMock).toHaveBeenCalledWith("missing", undefined);
    expect(result.current.plans).toEqual([
      expect.objectContaining({ id: "copy-1" }),
    ]);
  });
});

describe("usePlanList — refetch", () => {
  it("reloads the list on demand", async () => {
    listPlansMock.mockResolvedValueOnce({
      ok: true,
      data: [mkSummary({ id: "a" })],
    });
    const { result } = renderHook(() => usePlanList({ isAuthed: true }));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    listPlansMock.mockResolvedValueOnce({
      ok: true,
      data: [mkSummary({ id: "a" }), mkSummary({ id: "b" })],
    });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.plans).toHaveLength(2);
  });
});
