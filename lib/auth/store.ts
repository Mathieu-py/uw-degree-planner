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
  username: string | null;
  ready: boolean;
}

let state: AuthState = { user: null, username: null, ready: false };
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
function getUsernameSnapshot(): string | null {
  return state.username;
}
function getReadySnapshot(): boolean {
  return state.ready;
}

// Server snapshots — used by useSyncExternalStore for SSR *and* the first
// client hydration render, which must agree byte-for-byte. initAuth only runs
// in an effect (client-only), so the server always renders the pre-init state;
// these constants pin hydration to that same state. Without them, hydration
// reads the live getters above, and a fast getSession() resolution can flip
// `ready` to true before React hydrates this subtree — producing a mismatch
// against the skeleton the server emitted. After hydration React switches to
// the live getters and re-renders if auth has since resolved.
function getUserServerSnapshot(): User | null {
  return null;
}
function getUsernameServerSnapshot(): string | null {
  return null;
}
function getReadyServerSnapshot(): boolean {
  return false;
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

  // Refresh the username from the canonical profiles row. Best-effort and only
  // ever *upgrades* to a non-null DB value — a failed/empty fetch leaves the
  // metadata-seeded username (below) in place rather than clobbering it. Guarded
  // by id so a stale response for a previous user can't win.
  function syncProfile(user: User | null): void {
    if (!user) return;
    supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const dbUsername = data?.username ?? null;
        if (
          dbUsername &&
          state.user?.id === user.id &&
          state.username !== dbUsername
        ) {
          state = { ...state, username: dbUsername };
          notify();
        }
      });
  }

  // getSession() reads the persisted session from local storage (no network
  // round-trip), so `ready` flips almost immediately and the planner can paint
  // the correct branch on first render. getUser() would block first paint on a
  // call to the auth server. This only gates UI — every server action still
  // re-validates the token via RLS, so trusting the stored session here is safe.
  supabase.auth
    .getSession()
    .then(({ data }) => {
      const user = data.session?.user ?? null;
      state = { ...state, user, username: usernameFromMetadata(user) };
      notify();
      syncProfile(user);
    })
    .catch(() => {})
    .finally(() => {
      state = { ...state, ready: true };
      notify();
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    const nextUser = session?.user ?? null;
    const userChanged = state.user?.id !== nextUser?.id;
    state = {
      ...state,
      user: nextUser,
      username: usernameFromMetadata(nextUser),
    };
    notify();
    if (userChanged) syncProfile(nextUser);
  });
}

/**
 * The username is stored in user_metadata at sign-up, so it rides along on the
 * user object and is available synchronously — no profiles round-trip. Seeding
 * from here is what stops the header briefly showing the email before the DB
 * fetch resolves. Returns null for OAuth users (no username set).
 */
function usernameFromMetadata(user: User | null): string | null {
  const raw = user?.user_metadata?.username;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export interface UseAuthStateResult {
  user: User | null;
  /** Profile username, or null when unset / not yet fetched. */
  username: string | null;
  /** Username if set, else the user's email — what the header should show. */
  displayName: string | null;
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
    getUserServerSnapshot,
  );
  const username = useSyncExternalStore(
    subscribe,
    getUsernameSnapshot,
    getUsernameServerSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribe,
    getReadySnapshot,
    getReadyServerSnapshot,
  );
  return {
    user,
    username,
    displayName: username ?? user?.email ?? null,
    ready,
    isAuthed: user !== null,
  };
}

/**
 * Test-only: drops the store back to defaults and clears the init guard so
 * each test starts from a clean slate. The leading underscore signals
 * "don't call this from app code".
 */
export function __resetAuthStoreForTests(): void {
  state = { user: null, username: null, ready: false };
  listeners.clear();
  initialized = false;
}
