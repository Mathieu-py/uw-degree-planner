"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { savePlanState } from "../server/actions";
import { toSnapshot } from "../server/serialize";
import type { PlanSnapshot } from "../server/types";
import { clearPlan, loadPlan, savePlan } from "../storage";
import type { LocalPlan } from "../types";
import type { SaveStatus } from "./serverPlan";

const SAVE_DEBOUNCE_MS = 1500;
const SAVED_DECAY_MS = 3000;

export interface UsePlanSyncArgs {
  isAuthed: boolean;
  /** From the `/plan/[planId]` route param. Null = no plan selected. */
  planId: string | null;
  /**
   * Signed-in plan from the server component; null signed-out (localStorage is
   * used instead) or when the row is missing. Keyed remount per planId, no race.
   */
  initialPlan: LocalPlan | null;
}

export interface UsePlanSyncResult {
  plan: LocalPlan | null;
  hydrated: boolean;
  saveStatus: SaveStatus;
  /**
   * Update the in-memory plan and persist it. Signed-out: synchronous
   * localStorage write. Signed-in with a planId: debounced server save (1500ms
   * trailing). `saveStatus` flips to `saving` immediately so the badge shows
   * unsaved state before the wire call.
   */
  setPlan: (next: LocalPlan) => void;
  /** Drop the localStorage plan. No-op on the server path. */
  clearLocalPlan: () => void;
  /**
   * Drain any queued save, resolving once the in-flight save settles. Runs as
   * cleanup on unmount / plan switch (a switch is a keyed remount). The drained
   * save targets the planId baked into the snapshot — never the prop — so a
   * switch writes to the correct plan.
   */
  flushSave: () => Promise<void>;
}

/**
 * Owns the editable plan and its persistence. The plan is *seeded*, not fetched:
 * signed-in from the server-provided `initialPlan`, signed-out from localStorage
 * (client-only, synchronous). No async load lives here, so there is no
 * out-of-order load race — the only async work is the debounced save.
 */
export function usePlanSync({
  isAuthed,
  planId,
  initialPlan,
}: UsePlanSyncArgs): UsePlanSyncResult {
  // Signed-in shows the server plan on the first render (no skeleton). Signed-out
  // starts empty and hydrates from localStorage in the effect below.
  const [plan, setPlanState] = useState<LocalPlan | null>(
    isAuthed ? initialPlan : null,
  );
  const [hydrated, setHydrated] = useState(isAuthed);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  // Latest server plan in a ref so the seed effect can re-read it on an auth flip
  // without initialPlan's per-render identity retriggering it and clobbering edits.
  const initialPlanRef = useRef(initialPlan);
  initialPlanRef.current = initialPlan;

  // Monotonic epoch per plan identity, bumped by the seed effect. `drain` checks
  // it so a save settling after the identity moved (sign-out) can't write status
  // for the wrong plan; the save still targets the planId baked into its job.
  const planEpochRef = useRef(0);

  // Save orchestration runs through refs — mutations during async work would
  // otherwise trigger renders that reset the in-flight state.
  const queueRef = useRef<{ planId: string; snapshot: PlanSnapshot } | null>(
    null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Local path: most recent plan written, for flushSave's local retry.
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

  // The single drain pump: cancel the timer, await any in-flight save, then loop
  // the queue, re-checking each pass so an edit made mid-save is picked up without
  // another debounce. Epoch-guarded: if the epoch moves mid-save (auth changed),
  // the save still finishes but we skip setSaveStatus — the badge is another plan's.
  const drain = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;

    while (queueRef.current) {
      const job = queueRef.current;
      queueRef.current = null;
      const epoch = planEpochRef.current;
      setSaveStatus({ kind: "saving" });

      const promise = savePlanState(job.planId, job.snapshot);
      // Swallowed copy so concurrent awaiters can hang off it without seeing
      // the value or a rejection.
      inFlightRef.current = promise.then(
        () => undefined,
        () => undefined,
      );
      try {
        const result = await promise;
        if (planEpochRef.current !== epoch) continue;
        if (result.ok) {
          setSaveStatus({ kind: "saved", at: Date.now() });
        } else {
          setSaveStatus({ kind: "error", message: result.error });
          // Keep the failed snapshot pending so the retry button (flushSave)
          // can re-send it; a newer edit overwrites it first. Stop draining —
          // a retry or edit re-enters the loop, so no tight failing retry.
          if (!queueRef.current) queueRef.current = job;
          return;
        }
      } finally {
        inFlightRef.current = null;
      }
    }
  }, []);

  const flushSave = useCallback(async () => {
    // Local path: re-run savePlan against the last-known-good snapshot so the
    // retry button on a quota/permission error has something to do.
    if (lastLocalPlanRef.current) retryLocalSave();
    await drain();
  }, [drain, retryLocalSave]);

  // Seed on identity change. Signed-out reads localStorage; signed-in re-seeds from
  // the latest server plan (no-op on mount, a real reset on a sign-in flip). Bumps
  // the epoch, resets the badge, drains the pending save on the way out. planId is
  // NOT a dep: the shell is keyed by planId, so a switch remounts instead.
  useEffect(() => {
    planEpochRef.current++;
    setSaveStatus({ kind: "idle" });
    if (!isAuthed) {
      setPlanState(loadPlan());
    } else {
      setPlanState(initialPlanRef.current);
    }
    setHydrated(true);
    return () => {
      void drain();
    };
  }, [isAuthed, drain]);

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
      // On the server path, an older local snapshot is irrelevant to retries.
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
    hydrated,
    saveStatus,
    setPlan,
    clearLocalPlan,
    flushSave,
  };
}
