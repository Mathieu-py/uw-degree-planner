"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicEnv } from "./env";

/**
 * Browser-side Supabase client. `@supabase/ssr` keeps an internal singleton, so
 * calling this from multiple components doesn't create competing auth state. Env
 * vars come from `supabasePublicEnv()`, inlined at build time.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createBrowserClient(url, anonKey, {
    // Secure flag in prod — @supabase/ssr defaults omit it.
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
  });
}
