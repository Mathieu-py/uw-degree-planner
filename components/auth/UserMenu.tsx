"use client";

import Link from "next/link";
import { useState } from "react";
import { SUPABASE_CONFIGURED, useAuthState } from "@/lib/auth/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Header sign-in / sign-out control. Shows the user's display name (username,
 * falling back to email) when signed in, and a link to the /login page
 * otherwise. The auth state is read from the shared store
 * ([lib/auth/store.ts](../../lib/auth/store.ts)) so this and PlannerShell
 * observe the same subscription — no duplicate getUser() round trip at mount.
 */
export function UserMenu() {
  if (!SUPABASE_CONFIGURED) return null;
  return <UserMenuInner />;
}

function UserMenuInner() {
  const { user, displayName, ready } = useAuthState();
  const [busy, setBusy] = useState(false);

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
          {displayName ?? "Signed in"}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="cursor-pointer hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="hover:text-zinc-50">
      Sign in
    </Link>
  );
}
