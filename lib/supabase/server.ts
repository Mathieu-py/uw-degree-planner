import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "./env";

/**
 * Server-side Supabase client for Server Components, Route Handlers, and Server
 * Actions. Fresh per request — `cookies()` is a per-request store, so never
 * memoize across requests.
 *
 * `setAll` is try/catch'd because Server Components can't mutate cookies during
 * render (Next throws). Swallow it here and rely on `proxy.ts` to refresh the
 * session per navigation, where setting cookies IS allowed.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabasePublicEnv();

  return createServerClient(url, anonKey, {
    // @supabase/ssr's cookie defaults omit Secure; require it over HTTPS in prod.
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
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
          // Cookies are read-only during Server Component render; the proxy
          // handles refresh-on-navigation, so ignore.
        }
      },
    },
  });
}
