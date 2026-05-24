"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Header sign-in / sign-out button. Shows the user's email when signed in,
 * a "Sign in with Google" link otherwise. Subscribes to auth-state changes
 * so the UI flips immediately after the OAuth callback redirects back.
 */
export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data.user ?? null);
      })
      .catch((err) => {
        console.warn("UserMenu: getUser failed", err);
      })
      .finally(() => {
        if (cancelled) return;
        setReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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
    await supabase.auth.signOut();
    setBusy(false);
  }

  if (!ready) {
    return <span className="text-xs text-zinc-400">…</span>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span
          className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[12rem]"
          title={user.email ?? undefined}
        >
          {user.email ?? "Signed in"}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="hover:text-zinc-950 dark:hover:text-zinc-50 disabled:opacity-50"
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
      className="hover:text-zinc-950 dark:hover:text-zinc-50 disabled:opacity-50"
    >
      Sign in
    </button>
  );
}
