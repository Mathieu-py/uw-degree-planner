// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Program } from "../index";
import { usePlanProgramContext, useProgramsDetail } from "../usePlanPrograms";

// The hooks close over the module-level `programDetail` singleton, so each test
// uses slugs of its own — state primed or 404'd by one test never collides with
// another's.
function mkProgram(codes: string[]): Program {
  return {
    kind: "flexible",
    name: "Testing (Bachelor of Testing)",
    asOf: "2026-01-01",
    rules: { kind: "courses", courses: codes },
  };
}

function okResponse(program: Program): Response {
  return { ok: true, status: 200, json: async () => program } as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useProgramsDetail", () => {
  it("reports unloaded ids as false and fetches their detail", async () => {
    fetchMock.mockResolvedValue(okResponse(mkProgram(["CS 115"])));
    const { result } = renderHook(() => useProgramsDetail(["upd-basic"]));

    expect(result.current).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/programs/upd-basic");

    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it("retries failed loads with 2s/4s/8s/16s backoff capped at 30s", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderHook(() => useProgramsDetail(["upd-backoff"]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const [gap, calls] of [
      [2_000, 2],
      [4_000, 3],
      [8_000, 4],
      [16_000, 5],
    ] as const) {
      await act(() => vi.advanceTimersByTimeAsync(gap - 1));
      expect(fetchMock).toHaveBeenCalledTimes(calls - 1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    }

    // min(16s * 2, cap) = 30s, not 32s.
    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stops retrying when unmounted mid-backoff", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { unmount } = renderHook(() => useProgramsDetail(["upd-unmount"]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("usePlanProgramContext", () => {
  it("returns an empty referenced set until detail loads, then the union", async () => {
    const responses = new Map([
      ["/api/programs/upc-a", okResponse(mkProgram(["CS 115"]))],
      ["/api/programs/upc-b", okResponse(mkProgram(["MATH 135"]))],
    ]);
    fetchMock.mockImplementation(async (input) => {
      const r = responses.get(String(input));
      if (!r) throw new Error(`unexpected fetch: ${String(input)}`);
      return r;
    });
    const { result } = renderHook(() =>
      usePlanProgramContext({ programIds: ["upc-a", "upc-b"] }),
    );

    // The fetches are still microtasks away from resolving.
    expect(result.current.programReferenced.size).toBe(0);

    await act(async () => {});
    expect(result.current.programReferenced).toEqual(
      new Set(["cs 115", "math 135"]),
    );
  });
});
