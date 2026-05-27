"use client";

import { useState } from "react";
import { SUPABASE_CONFIGURED, useAuthState } from "@/lib/auth/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Header sign-in / sign-out button. Shows the user's email when signed in,
 * a "Sign in with Google" link otherwise. The auth state is read from the
 * shared store ([lib/auth/store.ts](../../lib/auth/store.ts)) so this and
 * PlannerShell observe the same subscription — no duplicate getUser() round
 * trip at mount.
 */
export function UserMenu() {
  if (!SUPABASE_CONFIGURED) return null;
  return <UserMenuInner />;
}

function UserMenuInner() {
  const { user, ready } = useAuthState();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/plan`,
      },
    });
    if (error) {
      setBusy(false);
      window.alert(`Sign in failed: ${error.message}`);
    }
    // On success the browser navigates to Google; no further state to set.
  }

  async function signOut() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) window.alert(`Sign out failed: ${error.message}`);
    setBusy(false);
  }

  if (!ready) {
    return <span className="text-xs text-zinc-500">…</span>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span
          className="truncate max-w-[14rem]"
          title={user.email ?? undefined}
        >
          {user.email ?? "Signed in"}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="hover:text-zinc-50 disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={busy}
      className="hover:text-zinc-50 disabled:opacity-50"
    >
      Sign in
    </button>
  );
}
