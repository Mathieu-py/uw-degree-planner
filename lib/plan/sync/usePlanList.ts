"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createPlan,
  deletePlan,
  listPlans,
  renamePlan,
} from "../server/actions";
import type { PlanSnapshot, PlanSummary } from "../server/types";

export interface UsePlanListArgs {
  isAuthed: boolean;
}

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
  /**
   * Optimistic rename. The cache reflects the new name immediately; the
   * row reverts on server failure.
   */
  rename: (id: string, name: string) => Promise<boolean>;
  /**
   * Optimistic remove. The row vanishes immediately; restored on server
   * failure (preserving its original position).
   */
  remove: (id: string) => Promise<boolean>;
}

/**
 * Module-level store backing usePlanList. The previous implementation kept
 * state inside the hook itself, which meant every component that called
 * usePlanList got its own independent copy — so a create() in PlannerShell
 * would not propagate to PlansSidebar's instance. Hoisting state here lets
 * useSyncExternalStore broadcast every mutation to every subscriber.
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

/**
 * Test-only: drops all in-memory state and listeners back to defaults so
 * each test starts from a clean slate. The leading underscore signals
 * "don't call this from app code".
 */
export function __resetPlanListStoreForTests(): void {
  state = { plans: null, loading: false, error: null };
  listeners.clear();
  fetchToken = 0;
  currentIsAuthed = null;
}

export function usePlanList({ isAuthed }: UsePlanListArgs): UsePlanListResult {
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
        programId: seed?.programId ?? null,
        specializationId: seed?.specializationId ?? null,
        stream: seed?.stream ?? null,
        startTermId: seed?.startTermId ?? null,
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
  };
}
