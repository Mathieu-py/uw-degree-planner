import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabasePublicEnv } from "./env";

/**
 * Refresh the Supabase auth session for an incoming request and return the
 * `NextResponse` that should be returned from `proxy.ts`. Designed to be
 * called from the root proxy.ts on every navigation.
 *
 * Without this, `getUser()` from a Server Component would race the cookie
 * refresh during render and occasionally log users out — see the
 * "concurrent requests with the same expired session" note in
 * node_modules/@supabase/ssr/README.md.
 *
 * Returning the response is important: the cookies written here are how the
 * browser learns about a refreshed access token.
 */
export async function updateSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Skip session refresh when Supabase isn't configured. Reasons this happens:
  //   - Contributor hasn't created .env.local yet
  //   - NODE_ENV=test, which makes Next.js intentionally skip .env.local
  //     (so e2e tests are deterministic across machines)
  // Either way, the planner's signed-out path is fully functional — the only
  // thing missing is auth, which the UI degrades to "Sign in" gracefully.
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

  // Calling getUser() forces the SDK to verify the current access token and,
  // if it has expired, exchange the refresh token. The new cookies land via
  // the setAll callback above.
  await supabase.auth.getUser();

  return response;
}
