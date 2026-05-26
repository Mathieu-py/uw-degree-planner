"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * NEXT_PUBLIC_* vars are inlined at build time, so this is a true constant
 * per build. When unset (fresh clone with no .env.local), the auth store
 * stays empty and `ready` flips to true immediately — consumers can hide
 * sign-in UI and the planner falls back to its anon localStorage path.
 */
export const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface AuthState {
  user: User | null;
  ready: boolean;
}

let state: AuthState = { user: null, ready: false };
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Two snapshot getters returning PRIMITIVES so useSyncExternalStore's
// reference-equality check is trivially correct. Returning a fresh object
// (e.g. `{ user, ready }`) from a single getter would trigger an infinite
// render loop — this is the canonical foot-gun of the pattern.
function getUserSnapshot(): User | null {
  return state.user;
}
function getReadySnapshot(): boolean {
  return state.ready;
}

// Module-level guard. We never tear down the Supabase listener — it lives
// for the page's lifetime alongside the underlying @supabase/ssr browser
// singleton. Tearing down on hook unmount would mean the last unmounted
// consumer severs auth tracking for any future mounts.
let initialized = false;

function initAuth(): void {
  if (initialized) return;
  initialized = true;

  if (!SUPABASE_CONFIGURED) {
    state = { ...state, ready: true };
    notify();
    return;
  }

  const supabase = createSupabaseBrowserClient();

  supabase.auth
    .getUser()
    .then(({ data }) => {
      state = { ...state, user: data.user ?? null };
      notify();
    })
    .catch(() => {})
    .finally(() => {
      state = { ...state, ready: true };
      notify();
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    state = { ...state, user: session?.user ?? null };
    notify();
  });
}

export interface UseAuthStateResult {
  user: User | null;
  ready: boolean;
  isAuthed: boolean;
}

/**
 * Subscribe to the shared auth store. The first hook to mount kicks off
 * `initAuth`; subsequent mounts are no-ops. Two separate `useSyncExternalStore`
 * calls keep snapshots primitive — the returned object is assembled in the
 * hook body, which React doesn't compare across renders.
 */
export function useAuthState(): UseAuthStateResult {
  useEffect(() => {
    initAuth();
  }, []);
  const user = useSyncExternalStore(
    subscribe,
    getUserSnapshot,
    getUserSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribe,
    getReadySnapshot,
    getReadySnapshot,
  );
  return { user, ready, isAuthed: user !== null };
}

/**
 * Test-only: drops the store back to defaults and clears the init guard so
 * each test starts from a clean slate. The leading underscore signals
 * "don't call this from app code".
 */
export function __resetAuthStoreForTests(): void {
  state = { user: null, ready: false };
  listeners.clear();
  initialized = false;
}
