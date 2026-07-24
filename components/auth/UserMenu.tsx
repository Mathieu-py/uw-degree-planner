"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDropdown } from "@/components/ui/useDropdown";
import { AuthGate, SUPABASE_CONFIGURED, useAuthState } from "@/lib/auth/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// No in-app help surface yet — point Help & feedback at the tracker.
const FEEDBACK_URL = "https://github.com/Mathieu-py/uw-degree-planner/issues";

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-[11px] rounded-[8px] px-2.5 py-[9px] text-[13px] transition-colors";

/**
 * Header account control ("identity card" design — see the account-dropdown
 * handoff). Signed in: an initials avatar opening a menu that leads with an
 * avatar + email identity card, then Account settings, Help & feedback, and
 * Sign out. Signed out: a link to /login. The auth state is read from the
 * shared store ([lib/auth/store.ts](../../lib/auth/store.ts)) so this and
 * PlannerShell observe the same subscription — no duplicate getUser() round
 * trip at mount.
 */
export function UserMenu() {
  if (!SUPABASE_CONFIGURED) return null;
  return (
    <AuthGate fallback={<Skeleton className="size-10 rounded-full" />}>
      <UserMenuInner />
    </AuthGate>
  );
}

function UserMenuInner() {
  const { user } = useAuthState();
  const { open, toggle, close, containerRef, id } = useDropdown();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut();
      if (error) window.alert(`Sign out failed: ${error.message}`);
    } catch (err) {
      window.alert(
        `Sign out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Always release the button — a thrown error must not strand it disabled.
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium text-ink-2 hover:text-ink"
      >
        Sign in
      </Link>
    );
  }

  // Email-only identity; the OAuth full name is deliberately not shown.
  const email = user.email ?? null;
  const cardName = email ?? "Signed in";
  // First two characters of the email's local part ("goose27@…" → GO).
  const initials = cardName.slice(0, 2).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Account menu, ${cardName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        className="inline-flex cursor-pointer rounded-full p-[3px] transition-colors hover:bg-bg-2"
      >
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-accent-bg font-mono text-sm font-bold text-accent-ink"
        >
          {initials}
        </span>
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label="Account"
          onKeyDown={(e) => {
            // useDropdown closes on Escape; also hand focus back to the trigger.
            if (e.key === "Escape") triggerRef.current?.focus();
          }}
          className="absolute right-0 top-full z-20 mt-2 w-[276px] rounded-[12px] border border-line bg-bg p-1.5 shadow-card-lg motion-safe:animate-menu-pop"
        >
          {/* Beak pointing at the trigger's caret */}
          <span
            aria-hidden="true"
            className="absolute -top-1.5 right-[18px] size-[11px] rotate-45 rounded-tl-[2px] border-l border-t border-line bg-bg"
          />
          <div className="flex items-center gap-[11px] px-2.5 py-[11px]">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-bg font-mono text-sm font-bold text-accent-ink"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">
                {cardName}
              </p>
            </div>
          </div>
          <div className="mx-1 my-1.5 h-px bg-line" />
          <Link
            role="menuitem"
            href="/settings"
            onClick={close}
            className={`${MENU_ITEM_CLASS} text-ink hover:bg-bg-2 focus-visible:bg-bg-2`}
          >
            <Icon
              name="gear"
              size="sm"
              aria-hidden="true"
              className="text-ink-3"
            />
            <span className="flex-1 font-medium">Account settings</span>
          </Link>
          <a
            role="menuitem"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noreferrer"
            onClick={close}
            className={`${MENU_ITEM_CLASS} text-ink hover:bg-bg-2 focus-visible:bg-bg-2`}
          >
            <Icon
              name="help"
              size="sm"
              aria-hidden="true"
              className="text-ink-3"
            />
            <span className="flex-1 font-medium">Help &amp; feedback</span>
          </a>
          <div className="mx-1 my-1.5 h-px bg-line" />
          <button
            role="menuitem"
            type="button"
            onClick={signOut}
            disabled={busy}
            className={`${MENU_ITEM_CLASS} cursor-pointer text-danger hover:bg-danger-soft focus-visible:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Icon name="logout" size="sm" aria-hidden="true" />
            <span className="flex-1 text-left font-medium">
              {busy ? "Signing out…" : "Sign out"}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
