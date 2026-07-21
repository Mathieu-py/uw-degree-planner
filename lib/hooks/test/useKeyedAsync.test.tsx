// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/server/actions";
import { useKeyedAsync } from "../useKeyedAsync";

type Row = { id: string };
const ok = (id: string): ActionResult<Row> => ({ ok: true, data: { id } });
const fail = (error: string): ActionResult<Row> => ({ ok: false, error });
type Loader = (key: string) => Promise<ActionResult<Row>>;

describe("useKeyedAsync", () => {
  it("is idle when key is null and never calls the loader", () => {
    const loader = vi.fn<Loader>();
    const { result } = renderHook(() => useKeyedAsync<Row>(null, loader));
    expect(result.current.state).toEqual({ status: "idle" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads and returns success for a key", async () => {
    const loader = vi.fn<Loader>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useKeyedAsync<Row>("a", loader));

    expect(result.current.state.status).toBe("loading");
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "success",
        data: { id: "a" },
      }),
    );
    expect(loader).toHaveBeenCalledWith("a");
  });

  it("surfaces a loader error result", async () => {
    const loader = vi.fn<Loader>().mockResolvedValue(fail("not_found"));
    const { result } = renderHook(() => useKeyedAsync<Row>("a", loader));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "not_found",
      }),
    );
  });

  it("a stale response for the previous key never overwrites the newer key", async () => {
    let resolveA!: (v: ActionResult<Row>) => void;
    const loader = vi
      .fn<Loader>()
      .mockImplementationOnce(
        () => new Promise<ActionResult<Row>>((res) => (resolveA = res)),
      )
      .mockResolvedValueOnce(ok("b"));

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useKeyedAsync<Row>(key, loader),
      { initialProps: { key: "a" } },
    );

    // Switch to b before a resolves; b lands first.
    rerender({ key: "b" });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "success",
        data: { id: "b" },
      }),
    );

    // a resolves last — must be discarded.
    await act(async () => {
      resolveA(ok("a"));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({
      status: "success",
      data: { id: "b" },
    });
  });

  it("clearing the key to null discards an in-flight load", async () => {
    let resolveA!: (v: ActionResult<Row>) => void;
    const loader = vi
      .fn<Loader>()
      .mockImplementationOnce(
        () => new Promise<ActionResult<Row>>((res) => (resolveA = res)),
      );

    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useKeyedAsync<Row>(key, loader),
      { initialProps: { key: "a" as string | null } },
    );

    expect(result.current.state.status).toBe("loading");
    rerender({ key: null });
    expect(result.current.state).toEqual({ status: "idle" });

    await act(async () => {
      resolveA(ok("a"));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("reload re-runs the loader and shows loading meanwhile", async () => {
    const loader = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok("a1"))
      .mockResolvedValueOnce(ok("a2"));
    const { result } = renderHook(() => useKeyedAsync<Row>("a", loader));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "success",
        data: { id: "a1" },
      }),
    );

    act(() => result.current.reload());
    expect(result.current.state.status).toBe("loading");
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "success",
        data: { id: "a2" },
      }),
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("setData reflects a mutation for the current key without a refetch", async () => {
    const loader = vi.fn<Loader>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useKeyedAsync<Row>("a", loader));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => result.current.setData({ id: "a-edited" }));
    expect(result.current.state).toEqual({
      status: "success",
      data: { id: "a-edited" },
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not retrigger the load when only the loader identity changes", async () => {
    const load1 = vi.fn<Loader>().mockResolvedValue(ok("a"));
    const { result, rerender } = renderHook(
      ({ loader }: { loader: Loader }) => useKeyedAsync<Row>("a", loader),
      { initialProps: { loader: load1 } },
    );
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    const load2 = vi.fn<Loader>().mockResolvedValue(ok("a2"));
    rerender({ loader: load2 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(load2).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: "success",
      data: { id: "a" },
    });
  });
});
