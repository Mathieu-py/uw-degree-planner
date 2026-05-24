"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicEnv } from "./env";

/**
 * Browser-side Supabase client. `@supabase/ssr` keeps a singleton internally
 * (`isSingleton` defaults to true), so calling this from multiple components
 * doesn't create competing auth state.
 *
 * Env vars are read via `supabasePublicEnv()`, which Next.js inlines at
 * build time from the `NEXT_PUBLIC_*` prefix — no runtime fetch needed.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
