"use client";

import Link from "next/link";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";

/**
 * Hero call-to-action row. Reads the shared auth store so the primary button
 * adapts to sign-in state (mirrors SiteNav): signed-out visitors are invited
 * into the demo, signed-in ones jump to their plans dashboard. The "Sign in"
 * outline button is dropped once authed. No `ready` gating — the store's first
 * snapshot is signed-out, so SSR emits that branch and hydration swaps in the
 * authed copy without a mismatch.
 */
export function HeroCta() {
  const { isAuthed } = useAuthState();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={isAuthed ? "/plans" : "/plan"}
        className={buttonClasses({ variant: "primary", size: "lg" })}
      >
        {isAuthed ? "Go to my plans" : "Try the demo"}
        <Icon name="arrow" size="sm" aria-hidden="true" />
      </Link>
      {!isAuthed ? (
        <Link
          href="/login"
          className={buttonClasses({ variant: "outline", size: "lg" })}
        >
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
