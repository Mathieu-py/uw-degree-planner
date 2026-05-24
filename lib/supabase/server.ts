import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "./env";

/**
 * Server-side Supabase client for use in Server Components, Route Handlers,
 * and Server Actions. A fresh client per request: `cookies()` is a per-request
 * store, so we must not memoize this across requests.
 *
 * `setAll` is wrapped in try/catch because Server Components cannot mutate
 * cookies during render — Next.js throws when you try. The Supabase SSR
 * pattern is to swallow that error here and rely on the root `proxy.ts` to
 * refresh the session on every navigation, which sets cookies in a context
 * where it IS allowed.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabasePublicEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render: cookies are read-only here. The proxy
          // handles refresh-on-navigation, so this is safe to ignore.
        }
      },
    },
  });
}
