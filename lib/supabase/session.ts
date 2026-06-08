import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabasePublicEnv } from "./env";

/**
 * Refresh the Supabase auth session for an incoming request and return the
 * `NextResponse` for `proxy.ts` to return. Called from proxy.ts on every nav.
 *
 * Without it, a Server Component's `getUser()` races the cookie refresh during
 * render and occasionally logs users out (see @supabase/ssr README's
 * "concurrent requests with the same expired session"). Returning the response
 * matters: its cookies are how the browser learns the refreshed access token.
 */
export async function updateSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Skip refresh when Supabase isn't configured (no .env.local, or NODE_ENV=test
  // where Next skips it for deterministic e2e). The signed-out path is fully
  // functional; the UI just degrades to "Sign in".
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }
  const { url, anonKey } = supabasePublicEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() verifies the access token and, if expired, exchanges the refresh
  // token; new cookies land via the setAll callback above.
  await supabase.auth.getUser();

  return response;
}
