"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/server/actions";

export type KeyedAsync<T> =
  | { status: "idle" } // key === null
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

export interface UseKeyedAsyncResult<T> {
  state: KeyedAsync<T>;
  /** Re-run the loader for the current key (shows loading meanwhile). */
  reload: () => void;
  /** Reflect a mutation's result for the current key without a refetch. */
  setData: (data: T) => void;
}

/**
 * Loads data for `key`; `state` always reflects the LATEST key — results are
 * stored tagged with their key and derived during render, so a superseded
 * response is structurally ignored. `key === null` is idle; `loader` returns
 * the house `ActionResult` (branch on `.ok`, not a rejection).
 */
export function useKeyedAsync<T>(
  key: string | null,
  loader: (key: string) => Promise<ActionResult<T>>,
): UseKeyedAsyncResult<T> {
  const [loaded, setLoaded] = useState<{
    key: string;
    result: ActionResult<T>;
  } | null>(null);
  // Latest loader in a ref so an inline loader's identity doesn't retrigger loads.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  // Refreshed each effect so reload() re-runs under the active `live` flag.
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (key === null) return;
    let live = true;
    const run = () => {
      loaderRef.current(key).then(
        (result) => {
          if (live) setLoaded({ key, result });
        },
        () => {
          // House loaders return an ActionResult; a rejection is unexpected.
          if (live)
            setLoaded({ key, result: { ok: false, error: "load_failed" } });
        },
      );
    };
    runRef.current = run;
    run();
    return () => {
      live = false;
    };
  }, [key]);

  // A `loaded` for a different key reads as loading — old-key results are ignored.
  const current = loaded && loaded.key === key ? loaded.result : null;
  const state: KeyedAsync<T> =
    key === null
      ? { status: "idle" }
      : current === null
        ? { status: "loading" }
        : current.ok
          ? { status: "success", data: current.data }
          : { status: "error", error: current.error };

  const reload = useCallback(() => {
    setLoaded(null); // drop the current result so `state` shows loading
    runRef.current(); // re-run the current key's load
  }, []);

  const setData = useCallback(
    (data: T) => {
      if (key !== null) setLoaded({ key, result: { ok: true, data } });
    },
    [key],
  );

  return { state, reload, setData };
}
