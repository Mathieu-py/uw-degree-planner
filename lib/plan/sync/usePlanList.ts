"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  listPlans,
  renamePlan,
  setPlanShare,
} from "../server/actions";
import { toSnapshot } from "../server/serialize";
import type { PlanSnapshot, PlanSummary } from "../server/types";
import { savePlan } from "../storage";
import type { LocalPlan } from "../types";

export interface UsePlanListResult {
  /** Null while loading. Empty array means "authed, fetched, zero plans". */
  plans: PlanSummary[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * Pessimistic create: waits for the server insert before prepending to the
   * cache. Returns the new plan id on success, null on failure.
   */
  create: (name: string, seed?: PlanSnapshot) => Promise<string | null>;
  /** Optimistic rename; reverts on server failure. */
  rename: (id: string, name: string) => Promise<boolean>;
  /** Optimistic remove; restored to its original position on failure. */
  remove: (id: string) => Promise<boolean>;
  /**
   * Pessimistic duplicate: like `create`, the new id is only known after the
   * round trip. Returns the new plan id, or null on failure.
   */
  duplicate: (id: string) => Promise<string | null>;
  /**
   * Mint or revoke the plan's share token, optimistically; reverts on failure.
   * Returns the new token (null when disabled), or undefined on failure.
   */
  share: (id: string, enable: boolean) => Promise<string | null | undefined>;
}

/**
 * Module-level store backing usePlanList. State lives here, not in the hook, so
 * every caller shares one copy — a create() in PlannerShell propagates to
 * PlanToolbar's instance via useSyncExternalStore.
 */
interface StoreState {
  plans: PlanSummary[] | null;
  loading: boolean;
  error: string | null;
}

let state: StoreState = { plans: null, loading: false, error: null };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreState {
  return state;
}

// Track the latest fetch and the auth mode it was issued under so we drop
// stale results when isAuthed flips during an in-flight request.
let fetchToken = 0;
let currentIsAuthed: boolean | null = null;

async function refetchInternal(isAuthed: boolean): Promise<void> {
  if (!isAuthed) {
    setState({ plans: null, error: null, loading: false });
    return;
  }
  const token = ++fetchToken;
  setState({ loading: true });
  const result = await listPlans();
  if (fetchToken !== token) return;
  if (result.ok) {
    setState({ plans: result.data, error: null, loading: false });
  } else {
    setState({ plans: [], error: result.error, loading: false });
  }
}

/** Test-only: reset all in-memory state and listeners to defaults. */
export function __resetPlanListStoreForTests(): void {
  state = { plans: null, loading: false, error: null };
  listeners.clear();
  fetchToken = 0;
  currentIsAuthed = null;
}

export function usePlanList({
  isAuthed,
}: {
  isAuthed: boolean;
}): UsePlanListResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    // Only the consumer whose isAuthed transitioned drives the fetch — every
    // other subscriber observes the resulting state change via the store.
    if (currentIsAuthed === isAuthed) return;
    currentIsAuthed = isAuthed;
    void refetchInternal(isAuthed);
  }, [isAuthed]);

  const refetch = useCallback(() => refetchInternal(isAuthed), [isAuthed]);

  const create = useCallback(
    async (name: string, seed?: PlanSnapshot): Promise<string | null> => {
      const normalizedName = name.trim();
      const result = await createPlan({ name: normalizedName, seed });
      if (!result.ok) {
        setState({ error: result.error });
        return null;
      }
      const optimistic: PlanSummary = {
        id: result.data.id,
        name: normalizedName,
        programIds: seed?.programIds ?? [],
        specializationIds: seed?.specializationIds ?? {},
        stream: seed?.stream ?? null,
        startTermId: seed?.startTermId ?? null,
        shareToken: null,
        updatedAt: new Date().toISOString(),
      };
      setState({
        plans: state.plans ? [optimistic, ...state.plans] : [optimistic],
        error: null,
      });
      return result.data.id;
    },
    [],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) {
        setState({ error: "name_required" });
        return false;
      }

      let previousName: string | undefined;
      if (state.plans) {
        setState({
          plans: state.plans.map((p) => {
            if (p.id !== id) return p;
            previousName = p.name;
            return { ...p, name: trimmed };
          }),
        });
      }

      const result = await renamePlan(id, trimmed);
      if (!result.ok) {
        if (state.plans && previousName !== undefined) {
          const restoreName = previousName;
          setState({
            plans: state.plans.map((p) =>
              p.id === id ? { ...p, name: restoreName } : p,
            ),
            error: result.error,
          });
        } else {
          setState({ error: result.error });
        }
        return false;
      }
      setState({ error: null });
      return true;
    },
    [],
  );

  const duplicate = useCallback(async (id: string): Promise<string | null> => {
    // Source from cache so the optimistic row matches what lands on the server.
    // The button only renders in the populated sidebar, so a cache miss is
    // defensive (mid-refetch) — fall back to a refetch then.
    const source = state.plans?.find((p) => p.id === id);
    const name = source ? `${source.name} (copy)` : undefined;

    const result = await duplicatePlan(id, name);
    if (!result.ok) {
      setState({ error: result.error });
      return null;
    }

    if (!source) {
      await refetchInternal(currentIsAuthed ?? true);
      return result.data.id;
    }

    const optimistic: PlanSummary = {
      id: result.data.id,
      name: name ?? source.name,
      programIds: source.programIds,
      specializationIds: source.specializationIds,
      stream: source.stream,
      startTermId: source.startTermId,
      shareToken: null,
      updatedAt: new Date().toISOString(),
    };
    setState({
      plans: state.plans ? [optimistic, ...state.plans] : [optimistic],
      error: null,
    });
    return result.data.id;
  }, []);

  const share = useCallback(
    async (id: string, enable: boolean): Promise<string | null | undefined> => {
      let previousToken: string | null | undefined;
      if (state.plans) {
        setState({
          plans: state.plans.map((p) => {
            if (p.id !== id) return p;
            previousToken = p.shareToken;
            // Clear when disabling; when enabling we don't know the token yet,
            // so leave the previous value and patch once the server replies.
            return enable ? p : { ...p, shareToken: null };
          }),
        });
      }

      const result = await setPlanShare(id, enable);
      if (!result.ok) {
        if (state.plans && previousToken !== undefined) {
          const restore = previousToken;
          setState({
            plans: state.plans.map((p) =>
              p.id === id ? { ...p, shareToken: restore } : p,
            ),
            error: result.error,
          });
        } else {
          setState({ error: result.error });
        }
        return undefined;
      }

      const newToken = result.data.shareToken;
      if (state.plans) {
        setState({
          plans: state.plans.map((p) =>
            p.id === id ? { ...p, shareToken: newToken } : p,
          ),
          error: null,
        });
      } else {
        setState({ error: null });
      }
      return newToken;
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    let removed: { row: PlanSummary; index: number } | null = null;
    if (state.plans) {
      const index = state.plans.findIndex((p) => p.id === id);
      if (index !== -1) {
        removed = { row: state.plans[index], index };
        setState({
          plans: state.plans.filter((_, i) => i !== index),
        });
      }
    }

    const result = await deletePlan(id);
    if (!result.ok) {
      if (state.plans && removed) {
        const next = [...state.plans];
        next.splice(removed.index, 0, removed.row);
        setState({ plans: next, error: result.error });
      } else {
        setState({ error: result.error });
      }
      return false;
    }
    setState({ error: null });
    return true;
  }, []);

  return {
    plans: snapshot.plans,
    loading: snapshot.loading,
    error: snapshot.error,
    refetch,
    create,
    rename,
    remove,
    duplicate,
    share,
  };
}

/**
 * Persist a brand-new plan and return the route to it: authed → server row via
 * `create` (null when that fails), anon → the localStorage demo slot. The fork
 * shared by onboarding's "Build my plan" and the shared-view duplicate; callers
 * own busy/error UI and reseed slot ids first when cloning an existing plan.
 */
export async function saveNewPlan(opts: {
  isAuthed: boolean;
  plan: LocalPlan;
  name: string;
  create: UsePlanListResult["create"];
}): Promise<string | null> {
  if (opts.isAuthed) {
    const id = await opts.create(opts.name, toSnapshot(opts.plan));
    return id ? `/plan/${id}` : null;
  }
  savePlan(opts.plan);
  return "/plan";
}
