"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

// Per-session dismissal (survives in-session nav, returns on a new tab), like
// the handoff convention in useAnonHandoff.ts.
const DISMISS_KEY = "uwfinder.demoBanner.dismissed";

/**
 * Slim banner for anonymous ("Demo mode") planner users, pointing to sign-in to
 * save. Rendered by PlannerLayout only when `!isAuthed`. Dismissible per session.
 */
export function DemoModeBanner() {
  // Lazy initializer reads sessionStorage browser-side only. The planner page's
  // AuthGate holds this subtree until auth resolves, so this never mounts during
  // SSR/hydration — no flash.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  if (dismissed) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private-mode / storage-disabled: just hide for this render.
    }
    setDismissed(true);
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200"
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">Demo mode</span> — your plan lives only in
        this browser.{" "}
        <Link
          href="/login?next=/plan"
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Sign in to save
        </Link>
        .
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss demo mode notice"
        className="shrink-0 text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-900 dark:hover:text-emerald-100"
      >
        <Icon name="close" size="sm" aria-hidden="true" />
      </button>
    </div>
  );
}
