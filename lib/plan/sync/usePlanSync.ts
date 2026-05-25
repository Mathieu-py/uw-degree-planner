"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadServerPlan, savePlanState } from "../server/actions";
import { toSnapshot } from "../server/serialize";
import type { PlanSnapshot } from "../server/types";
import { clearPlan, loadPlan, savePlan } from "../storage";
import type { LocalPlan } from "../types";
import { serverPlanToLocal } from "./serverPlanToLocal";
import type { PlanSource, SaveStatus } from "./types";

const SAVE_DEBOUNCE_MS = 1500;
const SAVED_DECAY_MS = 3000;

export interface UsePlanSyncArgs {
  isAuthed: boolean;
  /** From `useSearchParams().get("planId")`. Null = no plan selected. */
  planId: string | null;
}

export interface UsePlanSyncResult {
  plan: LocalPlan | null;
  source: PlanSource | null;
  hydrated: boolean;
  saveStatus: SaveStatus;
  /**
   * Update the in-memory plan and persist it. Signed-out: synchronous
   * localStorage write. Signed-in with a planId: schedule a debounced server
   * save (1500ms trailing edge). `saveStatus` flips to `saving` immediately
   * so the badge tells the user there's unsaved state even before the wire
   * call goes out.
   */
  setPlan: (next: LocalPlan) => void;
  /** Drop the localStorage plan. No-op on the server path. */
  clearLocalPlan: () => void;
  /**
   * Force any queued save to drain immediately and resolve once the
   * in-flight save (if any) settles. Used by the plan switcher before
   * changing `?planId` and as the implicit cleanup on unmount / planId
   * change. The drained save always targets the planId baked into the
   * queued snapshot — never the currently-prop planId — so flushing during
   * a plan switch writes to the correct plan.
   */
  flushSave: () => Promise<void>;
}

export function usePlanSync({
  isAuthed,
  planId,
}: UsePlanSyncArgs): UsePlanSyncResult {
  const [plan, setPlanState] = useState<LocalPlan | null>(null);
  const [source, setSource] = useState<PlanSource | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  // All save orchestration runs through refs — mutations during async work
  // would otherwise trigger renders that reset the in-flight state.
  const loadTokenRef = useRef(0);
  const queueRef = useRef<{ planId: string; snapshot: PlanSnapshot } | null>(
    null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // For the local path: the most recent plan written. Used by flushSave's
  // local retry, which otherwise has nothing to do (savePlan is synchronous).
  const lastLocalPlanRef = useRef<LocalPlan | null>(null);

  const retryLocalSave = useCallback(() => {
    const last = lastLocalPlanRef.current;
    if (!last) return;
    const ok = savePlan(last);
    setSaveStatus(
      ok
        ? { kind: "idle" }
        : {
            kind: "error",
            message:
              "Couldn't save to browser storage — quota may be full or blocked.",
          },
    );
  }, []);

  // The single drain pump. Cancels the timer, waits for any in-flight save,
  // then loops: pulls whatever is in the queue, runs it, and re-checks. The
  // re-check is what handles "user edited again while we were saving" — the
  // setPlan call wrote to queueRef during the await, so the next iteration
  // picks it up without an extra debounce delay.
  //
  // Token-protected UI status: each iteration captures loadTokenRef at the
  // top. If the token moves while we're awaiting savePlanState (planId or
  // isAuthed changed underneath us), we still let the save finish — the
  // queued snapshot has the correct planId baked in — but skip the success/
  // error setSaveStatus, because the badge now belongs to a different plan's
  // lifecycle and the effect has already reset it to idle.
  const drain = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;

    while (queueRef.current) {
      const job = queueRef.current;
      queueRef.current = null;
      const token = loadTokenRef.current;
      setSaveStatus({ kind: "saving" });

      const promise = savePlanState(job.planId, job.snapshot);
      // Track the in-flight save as a swallowed promise so concurrent
      // awaiters can hang off it without seeing the resolution value or
      // any rejection.
      inFlightRef.current = promise.then(
        () => undefined,
        () => undefined,
      );
      try {
        const result = await promise;
        if (loadTokenRef.current !== token) continue;
        if (result.ok) setSaveStatus({ kind: "saved", at: Date.now() });
        else setSaveStatus({ kind: "error", message: result.error });
      } finally {
        inFlightRef.current = null;
      }
    }
  }, []);

  const flushSave = useCallback(async () => {
    // Local path: re-run the synchronous savePlan against the last-known
    // good snapshot so the retry button on a quota/permission error has
    // something to do. No-op when there's no recorded plan.
    if (lastLocalPlanRef.current) retryLocalSave();
    await drain();
  }, [drain, retryLocalSave]);

  useEffect(() => {
    const token = ++loadTokenRef.current;
    setHydrated(false);

    if (!isAuthed) {
      const loaded = loadPlan();
      if (loadTokenRef.current !== token) return;
      setPlanState(loaded);
      setSource("local");
      setSaveStatus({ kind: "idle" });
      setHydrated(true);
      return;
    }

    if (planId === null) {
      setPlanState(null);
      setSource(null);
      setSaveStatus({ kind: "idle" });
      setHydrated(true);
      return;
    }

    setSource({ kind: "server", planId });
    setSaveStatus({ kind: "idle" });
    void (async () => {
      const result = await loadServerPlan(planId);
      if (loadTokenRef.current !== token) return;
      setPlanState(
        result.ok && result.data ? serverPlanToLocal(result.data) : null,
      );
      setHydrated(true);
    })();

    // Cleanup: planId is changing or component is unmounting. Drain so the
    // pending save (still targeting the old planId via its queued snapshot)
    // lands before we move on. We can't await from a cleanup; if the user
    // navigates away before the wire call settles, the save is best-effort.
    return () => {
      void drain();
    };
  }, [isAuthed, planId, drain]);

  // Auto-decay 'saved' → 'idle' so the badge doesn't read "Saved" forever.
  useEffect(() => {
    if (saveStatus.kind !== "saved") return;
    const t = setTimeout(() => {
      setSaveStatus((current) =>
        current.kind === "saved" ? { kind: "idle" } : current,
      );
    }, SAVED_DECAY_MS);
    return () => clearTimeout(t);
  }, [saveStatus]);

  const setPlan = useCallback(
    (next: LocalPlan) => {
      setPlanState(next);

      if (!isAuthed) {
        lastLocalPlanRef.current = next;
        const ok = savePlan(next);
        setSaveStatus(
          ok
            ? { kind: "idle" }
            : {
                kind: "error",
                message:
                  "Couldn't save to browser storage — quota may be full or blocked.",
              },
        );
        return;
      }
      // Crossing into the server path: any older local snapshot is no longer
      // relevant to a flushSave retry.
      lastLocalPlanRef.current = null;
      if (planId === null) return;

      queueRef.current = { planId, snapshot: toSnapshot(next) };
      setSaveStatus({ kind: "saving" });

      // If a save is already in flight, the drain loop's while-check will
      // pull this new job when the current save settles — no timer needed.
      if (inFlightRef.current) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void drain();
      }, SAVE_DEBOUNCE_MS);
    },
    [isAuthed, planId, drain],
  );

  const clearLocalPlan = useCallback(() => {
    clearPlan();
    setPlanState(null);
  }, []);

  return {
    plan,
    source,
    hydrated,
    saveStatus,
    setPlan,
    clearLocalPlan,
    flushSave,
  };
}
