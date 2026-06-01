"use client";

import Link from "next/link";
import { useAuthState } from "@/lib/auth/store";

/**
 * The auth-dependent slice of the footer links row. Mirrors SiteNav: the demo
 * link becomes "Go to my plans" once signed in, and the "Sign in" link drops.
 * Anchors inherit `.foot-links` styling from SiteFooter, so no className here.
 * No `ready` gating — SSR renders the signed-out branch, hydration swaps it.
 */
export function FooterAuthLinks() {
  const { isAuthed } = useAuthState();
  return (
    <>
      <Link href={isAuthed ? "/plans" : "/plan"}>
        {isAuthed ? "Go to my plans" : "Try the demo"}
      </Link>
      {!isAuthed ? <Link href="/login">Sign in</Link> : null}
    </>
  );
}
