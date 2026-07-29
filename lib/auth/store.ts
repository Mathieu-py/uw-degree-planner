"use client";

import type { User } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * NEXT_PUBLIC_* vars are inlined at build time, so this is a per-build constant.
 * When unset (fresh clone, no .env.local), the store stays empty and `ready`
 * flips true immediately — sign-in UI hides and the planner uses the anon path.
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

// Snapshot getters return PRIMITIVES so useSyncExternalStore's reference check
// is trivially correct. Returning a fresh object from one getter would loop
// renders forever — the canonical foot-gun of this pattern.
function getUserSnapshot(): User | null {
  return state.user;
}
function getReadySnapshot(): boolean {
  return state.ready;
}

// Server snapshots — used for SSR and the first hydration render, which must
// match byte-for-byte. initAuth runs only in an effect, so the server renders
// pre-init state; these pin hydration to it. Without them a fast getSession()
// could flip `ready` before hydration and mismatch the server's skeleton. React
// switches to the live getters after hydration.
function getUserServerSnapshot(): User | null {
  return null;
}
function getReadyServerSnapshot(): boolean {
  return false;
}

// Module-level guard. The Supabase listener is never torn down — it lives for
// the page's lifetime alongside the @supabase/ssr browser singleton. Tearing
// down on unmount would let the last consumer sever auth for future mounts.
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

  // getSession() reads the persisted session from local storage (no network),
  // so `ready` flips almost immediately and the planner paints the right branch
  // on first render; getUser() would block on the auth server. UI-only — server
  // actions re-validate the token via RLS, so trusting the stored session here
  // is safe.
  supabase.auth
    .getSession()
    .then(({ data }) => {
      state = { ...state, user: data.session?.user ?? null };
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
 * Subscribe to the shared auth store. The first mount kicks off `initAuth`;
 * later mounts are no-ops. Separate `useSyncExternalStore` calls keep snapshots
 * primitive — the returned object is assembled in the hook body.
 */
export function useAuthState(): UseAuthStateResult {
  useEffect(() => {
    initAuth();
  }, []);
  const user = useSyncExternalStore(
    subscribe,
    getUserSnapshot,
    getUserServerSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribe,
    getReadySnapshot,
    getReadyServerSnapshot,
  );
  return { user, ready, isAuthed: user !== null };
}

/**
 * Mounts children only after auth resolves (fallback until then, including
 * SSR/hydration), so no data hook under the gate ever reads an unresolved
 * `isAuthed`. Boots the store itself, so a gate-only page still resolves.
 */
export function AuthGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}): ReactNode {
  useEffect(() => {
    initAuth();
  }, []);
  // Subscribe to `ready` alone — user notifies don't concern the gate.
  const ready = useSyncExternalStore(
    subscribe,
    getReadySnapshot,
    getReadyServerSnapshot,
  );
  return ready ? children : fallback;
}

/** Test-only: reset the store to defaults and clear the init guard. */
export function __resetAuthStoreForTests(): void {
  state = { user: null, ready: false };
  listeners.clear();
  initialized = false;
}
