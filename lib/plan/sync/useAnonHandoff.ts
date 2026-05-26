"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listPlans } from "../server/actions";
import { toSnapshot } from "../server/serialize";
import type { PlanSnapshot } from "../server/types";
import { clearPlan, loadPlan } from "../storage";
import type { LocalPlan } from "../types";

const HANDOFF_DONE_KEY = "uwfinder.handoff.done";
const IMPORTED_PLAN_NAME = "Imported plan";

export type HandoffResolution = "import" | "discard" | "cancel";

export interface UseAnonHandoffArgs {
  isAuthed: boolean;
  /**
   * Performs the actual server create with the supplied snapshot. Caller
   * provides this so the hook stays decoupled from the plan-list cache —
   * usePlanList's `create` is what gets injected in the planner.
   */
  createPlanWithSeed: (
    name: string,
    snapshot: PlanSnapshot,
  ) => Promise<string | null>;
  /**
   * Called after a successful import (silent OR via the conflict modal). The
   * caller navigates to `?planId=newId` and renders the user-facing toast.
   */
  onImported: (newPlanId: string) => void;
}

export interface UseAnonHandoffResult {
  /** Non-null when the user must choose how to resolve a multi-plan handoff. */
  conflict: { localPlan: LocalPlan } | null;
  /** Caller invokes this from the HandoffModal's three buttons. */
  resolveConflict: (choice: HandoffResolution) => Promise<void>;
}

/**
 * Detect the first sign-in event after the user built an anonymous plan, and
 * decide whether to silently import it or prompt for a merge choice.
 *
 * Trigger: the `isAuthed` prop transitioning from false to true. Earlier
 * versions listened for `SIGNED_IN` directly on supabase auth, but Supabase
 * fires `INITIAL_SESSION` (not `SIGNED_IN`) when the page mounts with a
 * pre-existing session cookie — the exact case produced by this app's
 * server-side OAuth code-exchange route. And `INITIAL_SESSION` is dispatched
 * synchronously during client construction, often before this hook's effect
 * has registered its listener. Driving off `isAuthed` instead sidesteps both
 * problems: `useAuthedFlag` upstream already aggregates getUser() + every
 * auth event into one boolean, so we just react to its transition.
 *
 * Re-prompt prevention (three layers):
 *   1. `loadPlan()` early-returns when no local plan exists — returning
 *      authed users with no orphan local plan never see the modal.
 *   2. `handoffRanRef` blocks a second trigger within one mount.
 *   3. `sessionStorage` flag set by Import/Discard blocks re-entry across
 *      remounts (StrictMode dev double-mount, hard reload within the tab).
 * "Decide later" intentionally does NOT set the sessionStorage flag and does
 * NOT clear the local plan, so the prompt returns on the next sign-in or
 * page reload — which is the documented semantics for that branch.
 */
export function useAnonHandoff({
  isAuthed,
  createPlanWithSeed,
  onImported,
}: UseAnonHandoffArgs): UseAnonHandoffResult {
  const [conflict, setConflict] = useState<{ localPlan: LocalPlan } | null>(
    null,
  );
  const handoffRanRef = useRef(false);

  // Keep latest callback refs so the auth listener doesn't tear down/re-run
  // whenever PlannerShell re-renders with a new closure.
  const createRef = useRef(createPlanWithSeed);
  const onImportedRef = useRef(onImported);
  useEffect(() => {
    createRef.current = createPlanWithSeed;
    onImportedRef.current = onImported;
  }, [createPlanWithSeed, onImported]);

  const runHandoff = useCallback(async () => {
    if (handoffRanRef.current) return;
    if (typeof window !== "undefined") {
      if (window.sessionStorage.getItem(HANDOFF_DONE_KEY)) return;
    }
    handoffRanRef.current = true;

    const local = loadPlan();
    if (!local) return;

    const list = await listPlans();
    if (!list.ok) {
      // Network or auth error — leave the local plan in place and unset the
      // guard so the next sign-in retries.
      handoffRanRef.current = false;
      return;
    }

    if (list.data.length === 0) {
      const newId = await createRef.current(
        IMPORTED_PLAN_NAME,
        toSnapshot(local),
      );
      if (newId === null) {
        handoffRanRef.current = false;
        return;
      }
      clearPlan();
      markHandoffDone();
      onImportedRef.current(newId);
      return;
    }

    setConflict({ localPlan: local });
  }, []);

  useEffect(() => {
    if (isAuthed) {
      void runHandoff();
    } else {
      // Reset BOTH guards on sign-out: the ref so a subsequent sign-in
      // re-runs the handoff, and the sessionStorage flag so a previously
      // resolved handoff doesn't block the next sign-in's fresh local plan.
      // The flag's purpose is to suppress StrictMode/hard-reload re-prompts
      // within one sign-in session — not to permanently silence the handoff
      // for the lifetime of the tab.
      handoffRanRef.current = false;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(HANDOFF_DONE_KEY);
      }
    }
  }, [isAuthed, runHandoff]);

  const resolveConflict = useCallback(
    async (choice: HandoffResolution): Promise<void> => {
      const current = conflict;
      if (!current) return;

      if (choice === "cancel") {
        setConflict(null);
        // Intentionally no sessionStorage flag: the prompt should return on
        // the next sign-in.
        return;
      }

      if (choice === "discard") {
        clearPlan();
        markHandoffDone();
        setConflict(null);
        return;
      }

      // choice === "import"
      const newId = await createRef.current(
        IMPORTED_PLAN_NAME,
        toSnapshot(current.localPlan),
      );
      if (newId === null) {
        // Leave conflict open so the user can retry.
        return;
      }
      clearPlan();
      markHandoffDone();
      setConflict(null);
      onImportedRef.current(newId);
    },
    [conflict],
  );

  return { conflict, resolveConflict };
}

function markHandoffDone() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(HANDOFF_DONE_KEY, "1");
}
